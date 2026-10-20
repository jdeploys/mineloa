import { access, lstat, realpath } from 'node:fs/promises'
import { constants } from 'node:fs'
import { isAbsolute, join, relative, resolve, sep } from 'node:path'
import { release } from 'node:os'
import { z } from 'zod'
import type { OwnedProcessRequest, OwnedProcessResult } from '../../process/runOwnedProcess'
import { safeProviderError } from './providerErrors'

export type AppleOperation = 'status' | 'prepare-speech' | 'transcribe' | 'summarize'

const responseSchema = z.object({
  protocolVersion: z.literal(1),
  ok: z.boolean(),
  result: z.unknown().optional(),
  error: z.object({ code: z.string().max(100) }).passthrough().optional(),
}).strict()

export const safeAppleCodes = new Set([
  'APPLE_UNSUPPORTED_DEVICE', 'APPLE_UNSUPPORTED_OS', 'APPLE_SPEECH_UNAVAILABLE',
  'APPLE_SPEECH_LOCALE_UNSUPPORTED', 'APPLE_SPEECH_ASSET_NOT_READY',
  'APPLE_SPEECH_INVALID_AUDIO', 'APPLE_SPEECH_FAILED',
  'APPLE_SUMMARY_UNAVAILABLE', 'APPLE_SUMMARY_INTELLIGENCE_DISABLED',
  'APPLE_SUMMARY_MODEL_NOT_READY', 'APPLE_SUMMARY_LOCALE_UNSUPPORTED',
  'APPLE_SUMMARY_CONTEXT_EXCEEDED', 'APPLE_SUMMARY_TEMPLATE_TOO_LARGE',
  'APPLE_SUMMARY_REFUSED', 'APPLE_SUMMARY_INVALID_OUTPUT',
  'APPLE_AUDIO_INVALID', 'APPLE_TRANSCRIPT_INVALID', 'APPLE_SUMMARY_OUTPUT_INVALID',
  'APPLE_SUMMARY_FAILED', 'APPLE_HELPER_INVALID_REQUEST',
])

function isOwned(root: string, candidate: string): boolean {
  const path = relative(root, candidate)
  return path !== '..' && !path.startsWith(`..${sep}`) && !isAbsolute(path)
}

export interface AppleHelperOptions {
  isPackaged: boolean
  resourcesPath: string
  projectDirectory: string
  platform: NodeJS.Platform
  arch: string
  osRelease?: string
  runProcess(request: OwnedProcessRequest): Promise<OwnedProcessResult>
}

export class AppleHelper {
  private running: Promise<unknown> = Promise.resolve()
  private readonly cancellation = new AbortController()

  get signal(): AbortSignal { return this.cancellation.signal }

  dispose(): void { this.cancellation.abort() }

  constructor(private readonly options: AppleHelperOptions) {}

  private supported(): void {
    if (this.options.platform !== 'darwin' || this.options.arch !== 'arm64') {
      throw safeProviderError('APPLE_UNSUPPORTED_DEVICE', 'Apple on-device processing requires an Apple silicon Mac.', false)
    }
    // Darwin 25 is macOS 26. This check runs before loading the macOS 26 helper.
    const major = Number.parseInt((this.options.osRelease ?? release()).split('.')[0], 10)
    if (!Number.isInteger(major) || major < 25) {
      throw safeProviderError('APPLE_UNSUPPORTED_OS', 'Apple on-device processing requires macOS 26 or later.', false)
    }
  }

  private async executable(): Promise<string> {
    this.supported()
    try {
      const root = this.options.isPackaged
        ? join(this.options.resourcesPath, 'apple-processing')
        : join(this.options.projectDirectory, 'build', 'apple-processing', 'arm64')
      const details = await lstat(root)
      if (!details.isDirectory() || details.isSymbolicLink()) throw new Error()
      const canonicalRoot = await realpath(root)
      if (canonicalRoot !== resolve(root)) throw new Error()
      const candidate = join(canonicalRoot, 'apple-processing-helper')
      const executableDetails = await lstat(candidate)
      if (!executableDetails.isFile() || executableDetails.isSymbolicLink()) throw new Error()
      const canonical = await realpath(candidate)
      if (!isOwned(canonicalRoot, canonical)) throw new Error()
      await access(canonical, constants.X_OK)
      return canonical
    } catch {
      throw safeProviderError('APPLE_HELPER_UNAVAILABLE', 'Apple on-device processing helper is unavailable.', true)
    }
  }

  async call(operation: AppleOperation, payload: unknown = {}): Promise<unknown> {
    const next = this.running.then(() => this.invoke(operation, payload))
    this.running = next.then(() => undefined, () => undefined)
    return next
  }

  private async invoke(operation: AppleOperation, payload: unknown): Promise<unknown> {
    if (this.signal.aborted) throw safeProviderError('APPLE_HELPER_CANCELLED', 'Apple processing was interrupted.', true)
    const command = await this.executable()
    const stdin = JSON.stringify({ protocolVersion: 1, operation, payload })
    if (Buffer.byteLength(stdin) > 16 * 1024 * 1024) {
      throw safeProviderError('APPLE_HELPER_REQUEST_TOO_LARGE', 'The Apple processing request is too large.', false)
    }
    const timeoutMs = operation === 'status' ? 15_000
      : operation === 'prepare-speech' ? 20 * 60_000
        : operation === 'transcribe' ? 45 * 60_000 : 30 * 60_000
    const result = await this.options.runProcess({
      command, args: [], cwd: resolve(command, '..'), stdin, timeoutMs,
      outputCapBytes: operation === 'transcribe' ? 16 * 1024 * 1024 : operation === 'summarize' ? 5 * 1024 * 1024 : 256 * 1024,
      signal: this.signal,
    })
    if (result.status === 'timeout') throw safeProviderError('APPLE_HELPER_TIMEOUT', 'Apple on-device processing timed out. Try again.', true)
    if (result.status !== 'success') throw safeProviderError('APPLE_HELPER_FAILED', 'Apple on-device processing failed. Try again.', true)
    let parsed: unknown
    try { parsed = JSON.parse(result.stdout) } catch {
      throw safeProviderError('APPLE_HELPER_INVALID_RESPONSE', 'Apple on-device processing returned an invalid response.', false)
    }
    const response = responseSchema.safeParse(parsed)
    if (!response.success || (response.data.ok && (response.data.result === undefined || response.data.error !== undefined))
      || (!response.data.ok && (response.data.error === undefined || response.data.result !== undefined))) {
      throw safeProviderError('APPLE_HELPER_INVALID_RESPONSE', 'Apple on-device processing returned an invalid response.', false)
    }
    if (!response.data.ok) {
      const code = response.data.error!.code
      throw safeProviderError(
        safeAppleCodes.has(code) ? code : 'APPLE_HELPER_FAILED',
        appleErrorMessage(code),
        code !== 'APPLE_SPEECH_LOCALE_UNSUPPORTED' && code !== 'APPLE_SUMMARY_LOCALE_UNSUPPORTED',
      )
    }
    return response.data.result
  }
}

export function appleErrorMessage(code: string): string {
  if (code === 'APPLE_SPEECH_ASSET_NOT_READY') return '음성 모델이 아직 준비되지 않았습니다. 음성 모델 준비를 실행하세요.'
  if (code === 'APPLE_AUDIO_INVALID') return 'Apple Speech could not process this audio file.'
  if (code === 'APPLE_TRANSCRIPT_INVALID') return 'Apple Speech returned an invalid transcription.'
  if (code === 'APPLE_SPEECH_LOCALE_UNSUPPORTED') return '이 Mac에서 선택된 언어의 Apple 음성 전사를 지원하지 않습니다.'
  if (code === 'APPLE_SUMMARY_INTELLIGENCE_DISABLED') return 'Enable Apple Intelligence in System Settings, then try again.'
  if (code === 'APPLE_SUMMARY_MODEL_NOT_READY') return 'The Apple Intelligence model is not ready. Try again after setup finishes.'
  if (code === 'APPLE_SUMMARY_LOCALE_UNSUPPORTED') return 'Apple Intelligence cannot summarize this language on this Mac.'
  if (code === 'APPLE_SUMMARY_CONTEXT_EXCEEDED') return 'The meeting is too long for the available Apple Intelligence model.'
  if (code === 'APPLE_SUMMARY_TEMPLATE_TOO_LARGE') return 'This template instruction is too large for Apple Intelligence.'
  if (code === 'APPLE_SUMMARY_REFUSED') return 'Apple Intelligence could not generate this summary.'
  if (code === 'APPLE_SUMMARY_OUTPUT_INVALID') return 'Apple Intelligence returned an invalid summary.'
  return 'Apple on-device processing failed. Try again.'
}
