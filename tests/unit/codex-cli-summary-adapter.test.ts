import { EventEmitter } from 'node:events'
import { mkdir, mkdtemp, readdir, realpath, rm, symlink, writeFile } from 'node:fs/promises'
import { PassThrough, Writable } from 'node:stream'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  createOwnedProcessRunner,
  type OwnedProcessResult,
  type SpawnProcess,
} from '../../src/main/process/runOwnedProcess'
import { CodexCliSummaryAdapter } from '../../src/main/ai/providers/codexCliSummaryAdapter'

const schema = {
  type: 'object',
  additionalProperties: false,
  required: ['title', 'items', 'choice'],
  properties: {
    title: { type: 'string', minLength: 1 },
    items: { type: 'array', minItems: 1, maxItems: 2, items: { type: 'string' } },
    choice: { anyOf: [{ type: 'string', enum: ['yes'] }, { type: 'null' }] },
  },
}

const validSummary = { title: '회의', items: ['결정'], choice: null }
const resolveCodex = async () => [{ command: 'codex', argsPrefix: [] as string[] }]
const temporaryRoots: string[] = []

async function temporaryRoot() {
  const root = await realpath(await mkdtemp(join(tmpdir(), 'nnote-codex-test-')))
  temporaryRoots.push(root)
  return root
}

afterEach(async () => {
  const { rm } = await import('node:fs/promises')
  await Promise.all(temporaryRoots.splice(0).map((path) => rm(path, { recursive: true, force: true })))
})

function result(overrides: Partial<OwnedProcessResult> = {}): OwnedProcessResult {
  return { status: 'success', exitCode: 0, stdout: '', stderr: '', ...overrides } as OwnedProcessResult
}

describe('CodexCliSummaryAdapter', () => {
  it('uses the canonical temporary root when the supplied root is an operating-system alias', async (context) => {
    const parent = await temporaryRoot()
    const target = join(parent, 'target')
    const alias = join(parent, 'alias')
    await mkdir(target)
    try { await symlink(target, alias, process.platform === 'win32' ? 'junction' : 'dir') } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'EPERM') { context.skip(); return }
      throw error
    }
    const adapter = new CodexCliSummaryAdapter(async ({ cwd }) => {
      await writeFile(join(cwd, 'result.json'), JSON.stringify(validSummary), 'utf8')
      return result()
    }, alias, resolveCodex)

    await expect(adapter.summarize({ input: 'transcript', schema }))
      .resolves.toBe(JSON.stringify(validSummary))
    await expect(readdir(target)).resolves.toEqual([])
  })

  it('runs codex in an isolated ephemeral read-only job and returns only schema-valid JSON', async () => {
    const root = await temporaryRoot()
    const run = vi.fn(async (request: { cwd: string }) => {
      await writeFile(join(request.cwd, 'result.json'), JSON.stringify(validSummary), 'utf8')
      return result()
    })
    const adapter = new CodexCliSummaryAdapter(run, root, resolveCodex)

    await expect(adapter.summarize({ input: 'secret meeting transcript', schema }))
      .resolves.toBe(JSON.stringify(validSummary))
    expect(run).toHaveBeenCalledWith({
      command: 'codex',
      args: [
        'exec', '--ephemeral', '--sandbox', 'read-only', '--skip-git-repo-check',
        '--output-schema', 'schema.json', '--output-last-message', 'result.json', '-',
      ],
      cwd: expect.stringContaining('nnote-codex-summary-'),
      stdin: 'secret meeting transcript',
    })
    expect(await readdir(root)).toEqual([])
  })

  it('prepends the resolved command arguments for availability and summary execution', async () => {
    const root = await temporaryRoot()
    const resolveCommand = vi.fn(async () => [{ command: 'C:/safe/node.exe', argsPrefix: ['C:/safe/codex.js'] }])
    const run = vi.fn(async (request: { cwd: string; args: readonly string[] }) => {
      if (request.args.includes('exec')) await writeFile(join(request.cwd, 'result.json'), JSON.stringify(validSummary), 'utf8')
      return result()
    })
    const adapter = new CodexCliSummaryAdapter(run, root, resolveCommand)

    await expect(adapter.availability()).resolves.toMatchObject({ available: true })
    await expect(adapter.summarize({ input: 'transcript', schema })).resolves.toBe(JSON.stringify(validSummary))
    expect(run.mock.calls[0]?.[0]).toMatchObject({
      command: 'C:/safe/node.exe',
      args: ['C:/safe/codex.js', 'login', 'status'],
    })
    expect(run.mock.calls[1]?.[0]).toMatchObject({
      command: 'C:/safe/node.exe',
      args: ['C:/safe/codex.js', 'exec', '--ephemeral', '--sandbox', 'read-only', '--skip-git-repo-check', '--output-schema', 'schema.json', '--output-last-message', 'result.json', '-'],
    })
  })

  it('classifies a missing safe Windows command without invoking a process', async () => {
    const run = vi.fn(async () => result())
    const adapter = new CodexCliSummaryAdapter(run, await temporaryRoot(), async () => [])

    await expect(adapter.availability()).resolves.toEqual({
      available: false,
      code: 'CODEX_NOT_INSTALLED',
      message: 'Codex CLI is not installed.',
    })
    await expect(adapter.summarize({ input: 'transcript', schema })).rejects.toMatchObject({
      code: 'CODEX_NOT_INSTALLED',
      retryable: true,
    })
    expect(run).not.toHaveBeenCalled()
  })

  it.each(['availability', 'summary'] as const)(
    'falls back from an inaccessible executable to npm for %s',
    async (operation) => {
      const root = await temporaryRoot()
      const resolveCommand = async () => [
        { command: 'C:/WindowsApps/codex.exe', argsPrefix: [] },
        { command: 'C:/node.exe', argsPrefix: ['C:/npm/codex.js'] },
      ]
      const run = vi.fn(async (request: { command: string; cwd: string }) => {
        if (request.command.includes('WindowsApps')) return result({ status: 'spawn_error', code: 'EPERM' })
        if (operation === 'summary') await writeFile(join(request.cwd, 'result.json'), JSON.stringify(validSummary), 'utf8')
        return result()
      })
      const adapter = new CodexCliSummaryAdapter(run, root, resolveCommand)

      if (operation === 'availability') await expect(adapter.availability()).resolves.toMatchObject({ available: true })
      else await expect(adapter.summarize({ input: 'transcript', schema })).resolves.toBe(JSON.stringify(validSummary))

      expect(run.mock.calls.map(([request]) => request.command)).toEqual([
        'C:/WindowsApps/codex.exe',
        'C:/node.exe',
      ])
    },
  )

  it.each(['availability', 'summary'] as const)(
    'does not fall back after a launched nonzero %s process',
    async (operation) => {
      const run = vi.fn(async () => result({ status: 'nonzero_exit', exitCode: 1, stdout: '', stderr: 'Not logged in' }))
      const adapter = new CodexCliSummaryAdapter(run, await temporaryRoot(), async () => [
        { command: 'C:/first/codex.exe', argsPrefix: [] },
        { command: 'C:/node.exe', argsPrefix: ['C:/npm/codex.js'] },
      ])

      if (operation === 'availability') {
        await expect(adapter.availability()).resolves.toMatchObject({ code: 'CODEX_NOT_AUTHENTICATED' })
      } else {
        await expect(adapter.summarize({ input: 'transcript', schema })).rejects.toMatchObject({ code: 'CODEX_UNAVAILABLE' })
      }
      expect(run).toHaveBeenCalledTimes(1)
    },
  )

  it('describes cloud text privacy and reports authenticated availability', async () => {
    const adapter = new CodexCliSummaryAdapter(async () => result(), await temporaryRoot(), resolveCodex)
    await expect(adapter.descriptor()).resolves.toEqual({
      id: 'codex_cli',
      stage: 'summary',
      displayName: 'Codex CLI',
      privacy: 'text_cloud',
      capabilities: ['cli_status'],
      availability: { available: true, code: null, message: null },
    })
  })

  it.each([
    ['missing command', { status: 'spawn_error', code: 'ENOENT' }, 'CODEX_NOT_INSTALLED'],
    ['logged out', { status: 'nonzero_exit', exitCode: 1, stdout: '', stderr: 'Not logged in' }, 'CODEX_NOT_AUTHENTICATED'],
    ['invalid config', { status: 'nonzero_exit', exitCode: 1, stdout: '', stderr: 'failed to parse config.toml at C:/secret' }, 'CODEX_CONFIG_INVALID'],
    ['timeout', { status: 'timeout' }, 'CODEX_UNAVAILABLE'],
    ['overflow', { status: 'output_overflow', stream: 'stderr' }, 'CODEX_UNAVAILABLE'],
    ['unknown failure', { status: 'nonzero_exit', exitCode: 2, stdout: 'secret', stderr: 'C:/private' }, 'CODEX_UNAVAILABLE'],
  ] as const)('classifies %s availability without leaking diagnostics', async (_name, processResult, code) => {
    const adapter = new CodexCliSummaryAdapter(async () => processResult, await temporaryRoot(), resolveCodex)
    const availability = await adapter.availability()
    expect(availability).toMatchObject({ available: false, code })
    expect(JSON.stringify(availability)).not.toMatch(/secret|private|config\.toml/i)
  })

  it.each([
    ['object type', []],
    ['array type', { ...validSummary, items: 'wrong' }],
    ['scalar type', { ...validSummary, title: 3 }],
    ['required keys', { items: ['결정'], choice: null }],
    ['enum', { ...validSummary, choice: 'no' }],
    ['additional properties', { ...validSummary, extra: true }],
    ['minItems', { ...validSummary, items: [] }],
    ['maxItems', { ...validSummary, items: ['1', '2', '3'] }],
    ['array item type', { ...validSummary, items: [3] }],
    ['minLength', { ...validSummary, title: '' }],
    ['anyOf', { ...validSummary, choice: 42 }],
  ])('rejects output violating JSON Schema %s', async (_boundary, invalidValue) => {
    const root = await temporaryRoot()
    const adapter = new CodexCliSummaryAdapter(async ({ cwd }) => {
      await writeFile(join(cwd, 'result.json'), JSON.stringify(invalidValue), 'utf8')
      return result()
    }, root, resolveCodex)
    await expect(adapter.summarize({ input: 'transcript', schema })).rejects.toMatchObject({
      code: 'CODEX_INVALID_SUMMARY',
      retryable: false,
    })
  })

  it('maps unexpected runner and filesystem failures without leaking their raw values', async () => {
    const root = await temporaryRoot()
    const runnerAdapter = new CodexCliSummaryAdapter(
      async () => { throw new Error('TOP SECRET PROMPT at C:/private/path') },
      root,
      resolveCodex,
    )
    const runnerError = await runnerAdapter.summarize({ input: 'TOP SECRET PROMPT', schema }).catch((value) => value)
    expect(runnerError).toMatchObject({ code: 'CODEX_UNAVAILABLE', retryable: true })
    expect(runnerError.message).not.toMatch(/TOP SECRET|private/i)
    await expect(runnerAdapter.availability()).resolves.toEqual({
      available: false,
      code: 'CODEX_UNAVAILABLE',
      message: 'Codex CLI is unavailable.',
    })

    const missingRoot = join(root, 'missing', 'private')
    const filesystemAdapter = new CodexCliSummaryAdapter(async () => result(), missingRoot, resolveCodex)
    const filesystemError = await filesystemAdapter.summarize({ input: 'TOP SECRET PROMPT', schema }).catch((value) => value)
    expect(filesystemError).toMatchObject({ code: 'CODEX_UNAVAILABLE', retryable: true })
    expect(filesystemError.message).not.toMatch(/TOP SECRET|private|missing/i)
  })

  it('does not let cleanup failure replace the original safe provider error', async () => {
    const root = await temporaryRoot()
    const adapter = new CodexCliSummaryAdapter(
      async () => ({ status: 'timeout' }),
      root,
      resolveCodex,
      { mkdtemp, writeFile, rm: async () => { throw new Error('C:/private/cleanup') } },
    )
    await expect(adapter.summarize({ input: 'TOP SECRET PROMPT', schema })).rejects.toMatchObject({
      code: 'CODEX_UNAVAILABLE',
      message: 'Codex CLI summary failed.',
      retryable: true,
    })
  })

  it.each([
    ['ENOENT', { status: 'spawn_error', code: 'ENOENT' }],
    ['timeout', { status: 'timeout' }],
    ['overflow', { status: 'output_overflow', stream: 'stdout' }],
    ['nonzero', { status: 'nonzero_exit', exitCode: 3, stdout: 'secret stdout', stderr: 'C:/private/stderr' }],
  ] as const)('maps %s execution failure without exposing paths, prompts, stdout, or stderr', async (_name, processResult) => {
    const root = await temporaryRoot()
    const adapter = new CodexCliSummaryAdapter(async () => processResult, root, resolveCodex)
    const error = await adapter.summarize({ input: 'TOP SECRET PROMPT', schema }).catch((value) => value)
    expect(error).toMatchObject({ retryable: true })
    expect(`${error.code} ${error.message}`).not.toMatch(/TOP SECRET|private|stdout|stderr|nnote-codex-summary/i)
    expect(await readdir(root)).toEqual([])
  })

  it.each([
    ['missing-result', null],
    ['malformed', '{not json'],
    ['schema-mismatch', JSON.stringify({ title: '', items: [], choice: 'no', extra: true })],
  ] as const)('rejects %s output with a stable safe non-retryable error', async (_name, output) => {
    const root = await temporaryRoot()
    const adapter = new CodexCliSummaryAdapter(async ({ cwd }) => {
      if (output !== null) await writeFile(join(cwd, 'result.json'), output, 'utf8')
      return result({ stdout: 'secret stdout', stderr: 'C:/private/stderr' })
    }, root, resolveCodex)
    const error = await adapter.summarize({ input: 'TOP SECRET PROMPT', schema }).catch((value) => value)
    expect(error).toMatchObject({ code: 'CODEX_INVALID_SUMMARY', retryable: false })
    expect(error.message).toBe('Codex CLI returned an invalid summary response.')
    expect(await readdir(root)).toEqual([])
  })

  it.each(['EACCES', 'EMFILE'] as const)(
    'maps %s while reading the result to a retryable safe runtime failure',
    async (code) => {
      const root = await temporaryRoot()
      const adapter = new CodexCliSummaryAdapter(
        async () => result(),
        root,
        resolveCodex,
        { mkdtemp, writeFile, rm },
        async () => { throw Object.assign(new Error(`TOP SECRET at C:/private/result.json`), { code }) },
      )
      const error = await adapter.summarize({ input: 'TOP SECRET PROMPT', schema }).catch((value) => value)
      expect(error).toMatchObject({ code: 'CODEX_UNAVAILABLE', retryable: true })
      expect(error.message).toBe('Codex CLI summary failed.')
      expect(`${error.code} ${error.message}`).not.toMatch(/TOP SECRET|private|result\.json/i)
    },
  )

  it('rejects a result larger than 4 MiB without reading it into memory', async () => {
    const root = await temporaryRoot()
    const adapter = new CodexCliSummaryAdapter(async ({ cwd }) => {
      await writeFile(join(cwd, 'result.json'), Buffer.alloc(4 * 1024 * 1024 + 1, 0x20))
      return result()
    }, root, resolveCodex)

    await expect(adapter.summarize({ input: 'transcript', schema })).rejects.toMatchObject({
      code: 'CODEX_INVALID_SUMMARY',
      retryable: false,
    })
    expect(await readdir(root)).toEqual([])
  })

  it.runIf(process.platform !== 'win32')('rejects a symlinked result without following it', async () => {
    const root = await temporaryRoot()
    const outside = join(root, 'outside.json')
    await writeFile(outside, JSON.stringify(validSummary), 'utf8')
    const adapter = new CodexCliSummaryAdapter(async ({ cwd }) => {
      await symlink(outside, join(cwd, 'result.json'), 'file')
      return result()
    }, root, resolveCodex)

    await expect(adapter.summarize({ input: 'transcript', schema })).rejects.toMatchObject({
      code: 'CODEX_INVALID_SUMMARY',
      retryable: false,
    })
  })
})

function fakeChild() {
  const child = new EventEmitter() as EventEmitter & {
    pid: number
    stdin: Writable
    stdout: PassThrough
    stderr: PassThrough
    kill: () => boolean
  }
  child.pid = 4321
  child.stdin = new PassThrough()
  child.stdout = new PassThrough()
  child.stderr = new PassThrough()
  child.kill = () => true
  return child
}

describe('runOwnedProcess', () => {
  it('classifies a synchronous spawn failure without returning its raw error', async () => {
    const spawnProcess = (() => {
      const error = Object.assign(new Error('C:/private/codex.exe'), { code: 'ENOENT' })
      throw error
    }) as SpawnProcess
    const run = createOwnedProcessRunner({ spawnProcess })
    await expect(run({ command: 'codex', args: [], cwd: 'C:/owned' }))
      .resolves.toEqual({ status: 'spawn_error', code: 'ENOENT' })
  })

  it('uses shell false, forwards exact argv, writes stdin once, and closes it', async () => {
    const child = fakeChild()
    const chunks: Buffer[] = []
    child.stdin.on('data', (chunk) => chunks.push(Buffer.from(chunk)))
    const spawnProcess = vi.fn(() => child) as unknown as SpawnProcess
    const run = createOwnedProcessRunner({ spawnProcess })
    const pending = run({ command: 'codex', args: ['login', 'status'], cwd: 'C:/owned', stdin: 'hello' })
    child.emit('close', 0, null)

    await expect(pending).resolves.toMatchObject({ status: 'success', exitCode: 0 })
    expect(spawnProcess).toHaveBeenCalledWith('codex', ['login', 'status'], expect.objectContaining({
      shell: false,
      cwd: 'C:/owned',
      windowsHide: true,
      stdio: ['pipe', 'pipe', 'pipe'],
    }))
    expect(Buffer.concat(chunks).toString()).toBe('hello')
    expect((child.stdin as PassThrough).writableEnded).toBe(true)
  })

  it('terminates its owned process tree and settles once on timeout', async () => {
    vi.useFakeTimers()
    const child = fakeChild()
    const terminateProcessTree = vi.fn(async () => undefined)
    const run = createOwnedProcessRunner({ spawnProcess: (() => child) as unknown as SpawnProcess, terminateProcessTree })
    const pending = run({ command: 'codex', args: [], cwd: 'C:/owned', timeoutMs: 5 })
    await vi.advanceTimersByTimeAsync(5)
    await expect(pending).resolves.toEqual({ status: 'timeout' })
    expect(terminateProcessTree).toHaveBeenCalledWith(child)
    child.emit('close', 0, null)
    expect(terminateProcessTree).toHaveBeenCalledTimes(1)
    vi.useRealTimers()
  })

  it('independently rejects stdout beyond the default 1 MiB cap', async () => {
    const child = fakeChild()
    const terminateProcessTree = vi.fn(async () => undefined)
    const run = createOwnedProcessRunner({ spawnProcess: (() => child) as unknown as SpawnProcess, terminateProcessTree })
    const pending = run({ command: 'codex', args: [], cwd: 'C:/owned' })
    child.stdout.write(Buffer.alloc(1024 * 1024 + 1))
    await expect(pending).resolves.toEqual({ status: 'output_overflow', stream: 'stdout' })
    expect(terminateProcessTree).toHaveBeenCalledWith(child)
  })

  it('independently rejects stderr beyond the default 1 MiB cap', async () => {
    const child = fakeChild()
    const terminateProcessTree = vi.fn(async () => undefined)
    const run = createOwnedProcessRunner({ spawnProcess: (() => child) as unknown as SpawnProcess, terminateProcessTree })
    const pending = run({ command: 'codex', args: [], cwd: 'C:/owned' })
    child.stderr.write(Buffer.alloc(1024 * 1024 + 1))
    await expect(pending).resolves.toEqual({ status: 'output_overflow', stream: 'stderr' })
    expect(terminateProcessTree).toHaveBeenCalledWith(child)
  })

  it('terminates only its owned tree when cancelled', async () => {
    const child = fakeChild()
    const terminateProcessTree = vi.fn(async () => undefined)
    const controller = new AbortController()
    const run = createOwnedProcessRunner({ spawnProcess: (() => child) as unknown as SpawnProcess, terminateProcessTree })
    const pending = run({ command: 'codex', args: [], cwd: 'C:/owned', signal: controller.signal })
    controller.abort()
    await expect(pending).resolves.toEqual({ status: 'cancelled' })
    expect(terminateProcessTree).toHaveBeenCalledWith(child)
  })

  it('still resolves safely when owned-tree termination rejects', async () => {
    vi.useFakeTimers()
    const child = fakeChild()
    const terminateProcessTree = vi.fn(async () => { throw new Error('termination failed') })
    const run = createOwnedProcessRunner({
      spawnProcess: (() => child) as unknown as SpawnProcess,
      terminateProcessTree,
    })
    const pending = run({ command: 'codex', args: [], cwd: 'C:/owned', timeoutMs: 5 })
    await vi.advanceTimersByTimeAsync(5)
    await expect(pending).resolves.toEqual({ status: 'timeout' })
    await vi.runAllTimersAsync()
    vi.useRealTimers()
  })

  it('returns a classified non-zero result without throwing raw diagnostics', async () => {
    const child = fakeChild()
    const run = createOwnedProcessRunner({ spawnProcess: (() => child) as unknown as SpawnProcess })
    const pending = run({ command: 'codex', args: [], cwd: 'C:/owned' })
    child.stderr.write('diagnostic')
    child.emit('close', 7, null)
    await expect(pending).resolves.toEqual({
      status: 'nonzero_exit', exitCode: 7, stdout: '', stderr: 'diagnostic',
    })
  })
})
