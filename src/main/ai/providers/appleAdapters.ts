import { lstat, mkdtemp, realpath, rm } from 'node:fs/promises'
import { isAbsolute, join, relative, resolve, sep } from 'node:path'
import { z } from 'zod'
import type { OwnedProcessRequest, OwnedProcessResult } from '../../process/runOwnedProcess'
import { OwnedTemporaryFiles } from '../../localRuntime/ownedTemporaryFiles'
import { ProviderError, safeProviderError } from './providerErrors'
import type { NormalizedTranscription, ProviderAvailability, ProviderDescriptor, SummaryProvider, SummaryRequest, TranscriptionProvider, TranscriptionProviderRequest } from './providerPorts'
import { appleErrorMessage, safeAppleCodes, type AppleHelper } from './appleHelper'

const availabilitySchema = z.object({ available: z.boolean(), code: z.string().nullable().optional(), message: z.string().nullable().optional() }).strict()
const statusSchema = z.object({ speech: availabilitySchema, summary: availabilitySchema }).strict()
const segmentSchema = z.object({ speakerLabel: z.null(), startSeconds: z.number().finite().nonnegative(), endSeconds: z.number().finite().nonnegative(), text: z.string() }).strict()
const transcriptSchema = z.object({ durationSeconds: z.number().finite().nonnegative(), segments: z.array(segmentSchema).max(100_000) }).strict()
const summaryContextSchema = z.object({
  sections: z.array(z.object({
    id: z.string().min(1).max(200), title: z.string().max(200),
    kind: z.enum(['paragraph', 'bullet_list', 'action_items']), prompt: z.string().max(2_000),
  }).strict()).min(1).max(8),
  transcript: z.array(z.object({
    sourceIndex: z.number().int().nonnegative(), speakerId: z.string().nullable(), text: z.string().max(100_000),
  }).strict()).max(100_000),
  speakerIds: z.array(z.string().min(1).max(200)).max(100),
}).strict().superRefine((context, issues) => {
  const speakers = new Set(context.speakerIds)
  if (speakers.size !== context.speakerIds.length) issues.addIssue({ code: 'custom', message: 'Duplicate speakers' })
  context.transcript.forEach((line, index) => {
    if (line.sourceIndex !== index || (line.speakerId !== null && !speakers.has(line.speakerId))) {
      issues.addIssue({ code: 'custom', message: 'Invalid transcript context', path: ['transcript', index] })
    }
  })
})

function within(root: string, candidate: string): boolean {
  const path = relative(root, candidate)
  return path !== '..' && !path.startsWith(`..${sep}`) && !isAbsolute(path)
}

async function trustedInput(rootPath: string, input: string): Promise<string> {
  try {
    const root = await realpath(rootPath)
    const absolute = resolve(input)
    if (!within(root, absolute)) throw new Error()
    const details = await lstat(absolute)
    if (!details.isFile() || details.isSymbolicLink()) throw new Error()
    const canonical = await realpath(absolute)
    if (!within(root, canonical)) throw new Error()
    return canonical
  } catch {
    throw safeProviderError('APPLE_SPEECH_INVALID_AUDIO', 'Apple Speech could not process this audio file.', false)
  }
}

async function stageAvailability(helper: AppleHelper, stage: 'speech' | 'summary', operation: 'status' | 'prepare-speech' = 'status'): Promise<ProviderAvailability> {
  try {
    const status = statusSchema.parse(await helper.call(operation))
    const reported = status[stage]
    if (reported.available) {
      if (reported.code != null || reported.message != null) throw new Error('Inconsistent Apple helper status')
      return { available: true, code: null, message: null }
    }
    const code = reported.code !== null && reported.code !== undefined && safeAppleCodes.has(reported.code) ? reported.code : 'APPLE_HELPER_UNAVAILABLE'
    return { available: false, code, message: appleErrorMessage(code) }
  } catch (error) {
    if (error instanceof ProviderError) return { available: false, code: error.code, message: error.message }
    return { available: false, code: 'APPLE_HELPER_INVALID_RESPONSE', message: 'Apple processing status is unavailable.' }
  }
}

function requireAvailable(value: ProviderAvailability): void {
  if (!value.available) throw safeProviderError(value.code ?? 'APPLE_HELPER_UNAVAILABLE', value.message ?? 'Apple on-device processing is unavailable.', true)
}

export class AppleSpeechTranscriptionAdapter implements TranscriptionProvider {
  readonly id = 'apple_speech' as const

  constructor(private readonly options: {
    helper: AppleHelper
    recordingsRoot: string
    temporaryRoot: string
    resolveFfmpeg(): Promise<string>
    runProcess(request: OwnedProcessRequest): Promise<OwnedProcessResult>
  }) {}

  availability(): Promise<ProviderAvailability> { return stageAvailability(this.options.helper, 'speech') }

  async descriptor(): Promise<ProviderDescriptor> {
    return { id: this.id, stage: 'transcription', displayName: 'Apple 음성 전사', availability: await this.availability(), privacy: 'local', capabilities: [] }
  }

  async prepareSpeech(): Promise<ProviderAvailability> {
    return stageAvailability(this.options.helper, 'speech', 'prepare-speech')
  }

  async transcribe(request: TranscriptionProviderRequest): Promise<NormalizedTranscription> {
    requireAvailable(await this.availability())
    const input = await trustedInput(this.options.recordingsRoot, request.filePath)
    const temporaryRoot = await realpath(this.options.temporaryRoot)
    const directory = await mkdtemp(join(temporaryRoot, 'nnote-apple-'))
    try {
      const wav = join(directory, 'input.wav')
      const ffmpeg = await this.options.resolveFfmpeg()
      const conversion = await this.options.runProcess({
        command: ffmpeg, cwd: directory, timeoutMs: 20 * 60_000, outputCapBytes: 256 * 1024,
        signal: this.options.helper.signal,
        args: ['-nostdin', '-hide_banner', '-loglevel', 'error', '-i', input, '-ac', '1', '-ar', '16000', '-c:a', 'pcm_s16le', '-y', wav],
      })
      if (conversion.status !== 'success') throw safeProviderError('APPLE_SPEECH_INVALID_AUDIO', 'Apple Speech could not convert this audio file.', true)
      const owned = await OwnedTemporaryFiles.capture(directory)
      const measured = await owned.pcmDuration(wav)
      const durationSeconds = request.recordingDurationSeconds ?? measured
      if (!Number.isFinite(durationSeconds) || durationSeconds < 0) {
        throw safeProviderError('APPLE_SPEECH_INVALID_AUDIO', 'Apple Speech could not process this audio file.', false)
      }
      const parsed = transcriptSchema.safeParse(await this.options.helper.call('transcribe', { filePath: wav, recordingDurationSeconds: durationSeconds }))
      if (!parsed.success) throw safeProviderError('APPLE_SPEECH_INVALID_OUTPUT', 'Apple Speech returned invalid transcription timing.', false)
      let previousStart = 0
      for (const segment of parsed.data.segments) {
        if (segment.startSeconds < previousStart || segment.endSeconds < segment.startSeconds || segment.endSeconds > durationSeconds + 0.001) {
          throw safeProviderError('APPLE_SPEECH_INVALID_OUTPUT', 'Apple Speech returned invalid transcription timing.', false)
        }
        previousStart = segment.startSeconds
      }
      return { durationSeconds, segments: parsed.data.segments }
    } finally {
      await rm(directory, { recursive: true, force: true })
    }
  }
}

export class AppleFoundationSummaryAdapter implements SummaryProvider {
  readonly id = 'apple_foundation' as const
  constructor(private readonly helper: AppleHelper) {}

  availability(): Promise<ProviderAvailability> { return stageAvailability(this.helper, 'summary') }

  async descriptor(): Promise<ProviderDescriptor> {
    return { id: this.id, stage: 'summary', displayName: 'Apple Intelligence 요약', availability: await this.availability(), privacy: 'local', capabilities: [] }
  }

  async summarize(request: SummaryRequest): Promise<string> {
    const context = summaryContextSchema.safeParse(request.context)
    if (!context.success) throw safeProviderError('APPLE_SUMMARY_INVALID_CONTEXT', 'Apple summary needs valid structured meeting context.', false)
    requireAvailable(await this.availability())
    const result = await this.helper.call('summarize', { context: context.data })
    if (typeof result !== 'object' || result === null || Array.isArray(result)) {
      throw safeProviderError('APPLE_SUMMARY_INVALID_OUTPUT', 'Apple Intelligence returned an invalid summary.', false)
    }
    return JSON.stringify(result)
  }
}
