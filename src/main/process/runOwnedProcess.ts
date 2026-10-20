import { spawn } from 'node:child_process'
import type { ChildProcessWithoutNullStreams, SpawnOptionsWithoutStdio } from 'node:child_process'

const DEFAULT_TIMEOUT_MS = 10 * 60 * 1_000
const DEFAULT_OUTPUT_CAP_BYTES = 1024 * 1024

export interface OwnedProcessRequest {
  command: string
  args: readonly string[]
  cwd: string
  stdin?: string
  timeoutMs?: number
  idleTimeoutMs?: number
  outputCapBytes?: number
  signal?: AbortSignal
}

export type OwnedProcessResult =
  | { status: 'success'; exitCode: 0; stdout: string; stderr: string }
  | { status: 'spawn_error'; code: string }
  | { status: 'timeout' }
  | { status: 'cancelled' }
  | { status: 'output_overflow'; stream: 'stdout' | 'stderr' }
  | { status: 'nonzero_exit'; exitCode: number | null; stdout: string; stderr: string }

export type OwnedChildProcess = Pick<ChildProcessWithoutNullStreams,
  'pid' | 'stdin' | 'stdout' | 'stderr' | 'once' | 'removeListener' | 'kill'>

export type SpawnProcess = (
  command: string,
  args: readonly string[],
  options: SpawnOptionsWithoutStdio & { stdio: ['pipe', 'pipe', 'pipe'] },
) => OwnedChildProcess

export type TerminateOwnedProcessTree = (child: OwnedChildProcess) => Promise<void>

const spawnWithoutShell = spawn as unknown as SpawnProcess

async function terminateOwnedProcessTree(child: OwnedChildProcess): Promise<void> {
  if (child.pid === undefined) return
  if (process.platform === 'win32') {
    await new Promise<void>((resolve) => {
      const killer = spawn('taskkill', ['/pid', String(child.pid), '/t', '/f'], {
        shell: false,
        windowsHide: true,
        stdio: 'ignore',
      })
      killer.once('error', () => resolve())
      killer.once('close', () => resolve())
    })
    return
  }
  try {
    process.kill(-child.pid, 'SIGKILL')
  } catch {
    child.kill('SIGKILL')
  }
}

export function createOwnedProcessRunner(dependencies: {
  spawnProcess?: SpawnProcess
  terminateProcessTree?: TerminateOwnedProcessTree
} = {}) {
  const spawnProcess = dependencies.spawnProcess ?? spawnWithoutShell
  const terminateProcessTree = dependencies.terminateProcessTree ?? terminateOwnedProcessTree

  return async function run(request: OwnedProcessRequest): Promise<OwnedProcessResult> {
    return new Promise((resolve) => {
      let child: OwnedChildProcess
      try {
        child = spawnProcess(request.command, [...request.args], {
          shell: false,
          cwd: request.cwd,
          windowsHide: true,
          stdio: ['pipe', 'pipe', 'pipe'],
          detached: process.platform !== 'win32',
        })
      } catch (error) {
        resolve({ status: 'spawn_error', code: processErrorCode(error) })
        return
      }

      let settled = false
      const stdout: Buffer[] = []
      const stderr: Buffer[] = []
      let stdoutBytes = 0
      let stderrBytes = 0
      const cap = request.outputCapBytes ?? DEFAULT_OUTPUT_CAP_BYTES

      let idleTimeout: ReturnType<typeof setTimeout> | undefined
      const cleanup = () => {
        clearTimeout(idleTimeout)
        clearTimeout(timeout)
        request.signal?.removeEventListener('abort', onAbort)
      }
      const finish = (value: OwnedProcessResult) => {
        if (settled) return
        settled = true
        cleanup()
        resolve(value)
      }
      const terminateAndFinish = (value: OwnedProcessResult) => {
        if (settled) return
        settled = true
        cleanup()
        void terminateProcessTree(child).then(
          () => resolve(value),
          () => resolve(value),
        )
      }
      const resetIdleTimeout = () => {
        if (request.idleTimeoutMs === undefined) return
        clearTimeout(idleTimeout)
        idleTimeout = setTimeout(() => terminateAndFinish({ status: 'timeout' }), request.idleTimeoutMs)
      }
      const collect = (stream: 'stdout' | 'stderr', chunk: Buffer | string) => {
        if (settled) return
        const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)
        if (bytes.length > 0) resetIdleTimeout()
        if (stream === 'stdout') {
          stdoutBytes += bytes.length
          if (stdoutBytes > cap) return terminateAndFinish({ status: 'output_overflow', stream })
          stdout.push(bytes)
        } else {
          stderrBytes += bytes.length
          if (stderrBytes > cap) return terminateAndFinish({ status: 'output_overflow', stream })
          stderr.push(bytes)
        }
      }
      const onAbort = () => terminateAndFinish({ status: 'cancelled' })
      const timeout = setTimeout(
        () => terminateAndFinish({ status: 'timeout' }),
        request.timeoutMs ?? DEFAULT_TIMEOUT_MS,
      )

      child.stdout.on('data', (chunk) => collect('stdout', chunk))
      child.stderr.on('data', (chunk) => collect('stderr', chunk))
      child.stdin.on('error', () => undefined)
      child.once('error', (error) => finish({ status: 'spawn_error', code: processErrorCode(error) }))
      child.once('close', (exitCode) => {
        const output = {
          stdout: Buffer.concat(stdout).toString('utf8'),
          stderr: Buffer.concat(stderr).toString('utf8'),
        }
        if (exitCode === 0) finish({ status: 'success', exitCode: 0, ...output })
        else finish({ status: 'nonzero_exit', exitCode, ...output })
      })
      request.signal?.addEventListener('abort', onAbort, { once: true })
      if (request.signal?.aborted) onAbort()
      if (!settled) {
        resetIdleTimeout()
        child.stdin.end(request.stdin ?? '')
      }
    })
  }
}

function processErrorCode(error: unknown): string {
  if (typeof error === 'object' && error !== null && 'code' in error) {
    const code = (error as { code?: unknown }).code
    if (typeof code === 'string') return code
  }
  return 'UNKNOWN'
}

export const runOwnedProcess = createOwnedProcessRunner()
