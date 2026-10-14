import { access, lstat, realpath } from 'node:fs/promises'
import { constants } from 'node:fs'
import { isAbsolute, join, resolve } from 'node:path'

export interface CodexCommand {
  readonly command: string
  readonly argsPrefix: readonly string[]
}

export type CodexCommandResolver = () => Promise<readonly CodexCommand[]>

interface CodexCommandResolverOptions {
  readonly platform?: NodeJS.Platform
  readonly pathValue?: string
  readonly posixFallbacks?: readonly string[]
  readonly disabled?: boolean
}

const MACOS_CODEX_FALLBACKS = [
  '/opt/homebrew/bin/codex',
  '/usr/local/bin/codex',
  '/Applications/Codex.app/Contents/Resources/codex',
  '/Applications/ChatGPT.app/Contents/Resources/codex',
] as const

export function createCodexCommandResolver(
  options: CodexCommandResolverOptions = {},
): CodexCommandResolver {
  const platform = options.platform ?? process.platform
  const pathValue = options.pathValue ?? process.env.PATH ?? ''

  if (options.disabled === true) return async () => []

  if (platform !== 'win32') return async () => resolvePosixCommands(
    pathValue,
    options.posixFallbacks ?? (platform === 'darwin' ? MACOS_CODEX_FALLBACKS : []),
  )

  return async () => resolveWindowsCommand(pathValue)
}

async function resolvePosixCommands(
  pathValue: string,
  fallbacks: readonly string[],
): Promise<readonly CodexCommand[]> {
  const pathCandidates = pathValue
    .split(':')
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0 && isAbsolute(entry))
    .map((directory) => join(directory, 'codex'))
  const commands: CodexCommand[] = []
  const seen = new Set<string>()
  for (const candidate of [...pathCandidates, ...fallbacks]) {
    const executable = await verifiedExecutableFile(candidate)
    if (executable === null || seen.has(executable)) continue
    seen.add(executable)
    commands.push({ command: executable, argsPrefix: [] })
  }
  return commands
}

async function resolveWindowsCommand(pathValue: string): Promise<readonly CodexCommand[]> {
  const directories = pathValue
    .split(';')
    .map((entry) => entry.trim().replace(/^"(.*)"$/, '$1'))
    .filter((entry) => entry.length > 0 && isAbsolute(entry))

  const commands: CodexCommand[] = []
  for (const directory of directories) {
    const executable = await verifiedRegularFile(join(directory, 'codex.exe'))
    if (executable !== null) commands.push({ command: executable, argsPrefix: [] })
  }

  const nodeCandidates = [...new Set(directories.map((directory) => join(directory, 'node.exe')))]
  for (const directory of directories) {
    const script = await verifiedRegularFile(
      join(directory, 'node_modules', '@openai', 'codex', 'bin', 'codex.js'),
    )
    if (script === null) continue

    const localNode = join(directory, 'node.exe')
    for (const candidate of [localNode, ...nodeCandidates.filter((value) => value !== localNode)]) {
      const node = await verifiedRegularFile(candidate)
      if (node !== null) {
        commands.push({ command: node, argsPrefix: [script] })
        break
      }
    }
  }
  return commands
}

async function verifiedRegularFile(candidate: string): Promise<string | null> {
  if (!isAbsolute(candidate)) return null
  try {
    const requested = resolve(candidate)
    const before = await lstat(requested, { bigint: true })
    if (!before.isFile() || before.isSymbolicLink()) return null
    const canonical = await realpath(requested)
    if (normalizeWindowsPath(canonical) !== normalizeWindowsPath(requested)) return null
    const after = await lstat(canonical, { bigint: true })
    if (!after.isFile() || after.isSymbolicLink() || before.ino !== after.ino) return null
    return canonical
  } catch {
    return null
  }
}

async function verifiedExecutableFile(candidate: string): Promise<string | null> {
  if (!isAbsolute(candidate)) return null
  try {
    const canonical = await realpath(resolve(candidate))
    const file = await lstat(canonical)
    if (!file.isFile() || file.isSymbolicLink()) return null
    await access(canonical, constants.X_OK)
    return canonical
  } catch {
    return null
  }
}

function normalizeWindowsPath(path: string): string {
  return resolve(path).replace(/[\\/]+$/, '').toLowerCase()
}
