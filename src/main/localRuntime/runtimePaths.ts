import { lstat, realpath } from 'node:fs/promises'
import { isAbsolute, join, relative, resolve, sep } from 'node:path'
import { safeProviderError } from '../ai/providers/providerErrors'

export interface LocalRuntimePaths {
  ffmpegPath: string
  whisperPath: string
}

export interface LocalRuntimePathOptions {
  isPackaged: boolean
  resourcesPath: string
  platform: NodeJS.Platform
  arch: string
  developmentRuntimeDirectory?: string
  developmentProjectDirectory?: string
}

function unavailable(code = 'LOCAL_WHISPER_RUNTIME_UNAVAILABLE') {
  return safeProviderError(code, 'Local Whisper runtime is unavailable.', true)
}

function isOwned(root: string, candidate: string): boolean {
  const fromRoot = relative(root, candidate)
  return fromRoot !== '..' && !fromRoot.startsWith(`..${sep}`) && !isAbsolute(fromRoot)
}

async function verifiedExecutable(root: string, name: string): Promise<string> {
  const candidate = join(root, name)
  const details = await lstat(candidate)
  if (!details.isFile() || details.isSymbolicLink()) throw unavailable()
  const canonical = await realpath(candidate)
  if (!isOwned(root, canonical)) throw unavailable()
  return canonical
}

export async function resolveLocalRuntimePaths(options: LocalRuntimePathOptions): Promise<LocalRuntimePaths> {
  try {
    const target = `${options.platform}-${options.arch}`
    if (!['win32-x64', 'darwin-x64', 'darwin-arm64'].includes(target)) {
      throw unavailable('LOCAL_WHISPER_UNSUPPORTED_RUNTIME')
    }
    const requestedRoot = options.isPackaged
      ? join(options.resourcesPath, 'local-runtime', target)
      : options.developmentRuntimeDirectory
        ?? (options.developmentProjectDirectory === undefined
          ? undefined
          : join(options.developmentProjectDirectory, 'build', 'local-runtime', target))
    if (requestedRoot === undefined || !isAbsolute(requestedRoot)) throw unavailable()
    const rootDetails = await lstat(requestedRoot)
    if (!rootDetails.isDirectory() || rootDetails.isSymbolicLink()) throw unavailable()
    const ownedRoot = await realpath(requestedRoot)
    if (ownedRoot !== resolve(requestedRoot)) throw unavailable()
    const windows = options.platform === 'win32'
    const [ffmpegPath, whisperPath] = await Promise.all([
      verifiedExecutable(ownedRoot, windows ? 'ffmpeg.exe' : 'ffmpeg'),
      verifiedExecutable(ownedRoot, windows ? 'whisper-cli.exe' : 'whisper-cli'),
    ])
    return { ffmpegPath, whisperPath }
  } catch (error) {
    if (typeof error === 'object' && error !== null && 'code' in error
      && String((error as { code: unknown }).code).startsWith('LOCAL_WHISPER_')) throw error
    throw unavailable()
  }
}

/** Apple Speech only needs the bundled converter, not the Whisper executable. */
export async function resolveBundledFfmpegPath(options: LocalRuntimePathOptions): Promise<string> {
  try {
    const target = `${options.platform}-${options.arch}`
    if (!['darwin-x64', 'darwin-arm64'].includes(target)) throw unavailable()
    const requestedRoot = options.isPackaged
      ? join(options.resourcesPath, 'local-runtime', target)
      : options.developmentRuntimeDirectory
        ?? (options.developmentProjectDirectory === undefined
          ? undefined
          : join(options.developmentProjectDirectory, 'build', 'local-runtime', target))
    if (requestedRoot === undefined || !isAbsolute(requestedRoot)) throw unavailable()
    const details = await lstat(requestedRoot)
    if (!details.isDirectory() || details.isSymbolicLink()) throw unavailable()
    const ownedRoot = await realpath(requestedRoot)
    if (ownedRoot !== resolve(requestedRoot)) throw unavailable()
    return verifiedExecutable(ownedRoot, 'ffmpeg')
  } catch {
    throw safeProviderError('APPLE_SPEECH_AUDIO_CONVERTER_UNAVAILABLE', 'The bundled audio converter is unavailable.', true)
  }
}
