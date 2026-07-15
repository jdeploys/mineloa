import { createHash } from 'node:crypto'
import { mkdir, mkdtemp, readFile, realpath, rename as renameFile, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  NodeWhisperModelStorage,
  WhisperModelManager,
  WhisperModelError,
  type WhisperModelStorage,
} from '../../src/main/localModels/whisperModelManager'
import { WHISPER_MODELS } from '../../src/main/localModels/whisperModelManifest'
import { registerSettingsHandlers } from '../../src/main/ipc/registerSettingsHandlers'
import type { DesktopApi } from '../../src/shared/contracts/desktopApi'
import { WhisperModelStatusSchema } from '../../src/shared/contracts/settings'

type Entry = { kind: 'regular' | 'symlink' | 'other'; size: number; digest: string }

class MemoryStorage implements WhisperModelStorage {
  readonly entries = new Map<string, Entry>()
  readonly removed: string[] = []
  readonly renamed: Array<[string, string]> = []
  nextDigest: string = WHISPER_MODELS.base.sha256

  async ensureRoot(): Promise<void> {}
  async inspect(path: string) {
    const entry = this.entries.get(path)
    return entry === undefined ? { kind: 'missing' as const, size: 0 } : { kind: entry.kind, size: entry.size }
  }
  async hash(path: string): Promise<string> {
    const entry = this.entries.get(path)
    if (entry === undefined) throw new Error('missing')
    return entry.digest
  }
  async remove(path: string): Promise<void> {
    this.removed.push(path)
    this.entries.delete(path)
  }
  async rename(from: string, to: string): Promise<void> {
    const entry = this.entries.get(from)
    if (entry === undefined) throw new Error('missing')
    this.renamed.push([from, to])
    this.entries.set(to, entry)
    this.entries.delete(from)
  }
  async write(
    path: string,
    body: AsyncIterable<Uint8Array>,
    mode: 'append' | 'truncate',
    maximumBytes: number,
    onBytes: (bytes: number) => void,
  ): Promise<number> {
    let size = mode === 'append' ? (this.entries.get(path)?.size ?? 0) : 0
    for await (const chunk of body) {
      size += chunk.byteLength
      if (size > maximumBytes) throw new WhisperModelError('WHISPER_MODEL_SIZE_MISMATCH', 'Model download size did not match.')
      onBytes(size)
    }
    this.entries.set(path, { kind: 'regular', size, digest: this.nextDigest })
    return size
  }
}

function chunk(size: number): Uint8Array {
  return { byteLength: size } as Uint8Array
}

function response(status: number, sizes: number[], headers: Record<string, string> = {}): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: new Headers(headers),
    body: (async function* () { for (const size of sizes) yield chunk(size) })(),
  } as unknown as Response
}

function setup(modelId: 'base' | 'small' = 'base') {
  const root = resolve('owned', 'models')
  const storage = new MemoryStorage()
  storage.nextDigest = WHISPER_MODELS[modelId].sha256
  const fetch = vi.fn().mockResolvedValue(response(200, [WHISPER_MODELS[modelId].size]))
  const manager = new WhisperModelManager(root, { fetch, storage })
  const finalPath = join(root, WHISPER_MODELS[modelId].filename)
  const partialPath = `${finalPath}.partial`
  return { root, storage, fetch, manager, finalPath, partialPath }
}

describe('WhisperModelManager', () => {
  it('activates only after exact pinned size and digest via atomic partial rename', async () => {
    const { manager, storage, finalPath, partialPath } = setup()

    await expect(manager.download('base')).resolves.toMatchObject({ modelId: 'base', state: 'installed' })
    expect(storage.renamed).toEqual([[partialPath, finalPath]])
    await expect(manager.status('base')).resolves.toMatchObject({ state: 'installed' })
  })

  it.each([
    ['digest', 'WHISPER_MODEL_DIGEST_MISMATCH'],
    ['size', 'WHISPER_MODEL_SIZE_MISMATCH'],
  ] as const)('removes a %s-mismatched partial and never installs it', async (kind, code) => {
    const { manager, storage, partialPath } = setup()
    if (kind === 'digest') storage.nextDigest = '0'.repeat(64)
    else storage.write = async (path) => {
      storage.entries.set(path, { kind: 'regular', size: WHISPER_MODELS.base.size - 1, digest: WHISPER_MODELS.base.sha256 })
      return WHISPER_MODELS.base.size - 1
    }

    await expect(manager.download('base')).rejects.toMatchObject({ code })
    expect(storage.removed).toContain(partialPath)
    await expect(manager.status('base')).resolves.toMatchObject({ state: 'not_installed' })
  })

  it.each([
    ['unsupported HTTP response', 503, null],
    ['inconsistent range response', 206, 'bytes 99-147951464/147951465'],
  ] as const)('cancels the body for an %s', async (_label, status, contentRange) => {
    const context = setup()
    const cancel = vi.fn().mockRejectedValue(new Error('cancel transport detail'))
    if (status === 206) context.storage.entries.set(context.partialPath, { kind: 'regular', size: 100, digest: '' })
    context.fetch.mockResolvedValue({
      ok: false,
      status,
      headers: new Headers(contentRange === null ? {} : { 'content-range': contentRange }),
      body: { cancel },
    } as unknown as Response)

    await expect(context.manager.download('base')).rejects.toBeInstanceOf(WhisperModelError)
    expect(cancel).toHaveBeenCalledTimes(1)
  })

  it('cancels the response stream as soon as it exceeds the pinned size', async () => {
    const context = setup()
    const cancel = vi.fn().mockResolvedValue(undefined)
    let delivered = false
    context.fetch.mockResolvedValue({
      ok: true,
      status: 200,
      headers: new Headers(),
      body: {
        getReader: () => ({
          read: async () => delivered
            ? { done: true, value: undefined }
            : (delivered = true, { done: false, value: chunk(WHISPER_MODELS.base.size + 1) }),
          cancel,
          releaseLock: vi.fn(),
        }),
      },
    } as unknown as Response)

    await expect(context.manager.download('base')).rejects.toMatchObject({ code: 'WHISPER_MODEL_SIZE_MISMATCH' })
    expect(cancel).toHaveBeenCalledTimes(1)
  })

  it.each([
    ['symlink', 'symlink', WHISPER_MODELS.base.size, WHISPER_MODELS.base.sha256],
    ['non-regular', 'other', WHISPER_MODELS.base.size, WHISPER_MODELS.base.sha256],
    ['wrong size', 'regular', 10, WHISPER_MODELS.base.sha256],
    ['wrong digest', 'regular', WHISPER_MODELS.base.size, '0'.repeat(64)],
  ] as const)('reports a %s final file as corrupt', async (_label, kind, size, digest) => {
    const { manager, storage, finalPath } = setup()
    storage.entries.set(finalPath, { kind, size, digest })
    await expect(manager.status('base')).resolves.toMatchObject({ state: 'corrupt' })
  })

  it('resumes only from a matching 206 Content-Range and emits monotonic safe progress', async () => {
    const { manager, storage, fetch, partialPath } = setup()
    const start = 100
    storage.entries.set(partialPath, { kind: 'regular', size: start, digest: '' })
    fetch.mockResolvedValue(response(206, [200, WHISPER_MODELS.base.size - start - 200], {
      'content-range': `bytes ${start}-${WHISPER_MODELS.base.size - 1}/${WHISPER_MODELS.base.size}`,
    }))
    const progress: unknown[] = []
    manager.onProgress((value) => progress.push(value))

    await manager.download('base')

    expect(fetch).toHaveBeenCalledWith(WHISPER_MODELS.base.url, { headers: { Range: `bytes=${start}-` } })
    expect(progress).toEqual([
      { modelId: 'base', receivedBytes: start, totalBytes: WHISPER_MODELS.base.size },
      { modelId: 'base', receivedBytes: start + 200, totalBytes: WHISPER_MODELS.base.size },
      { modelId: 'base', receivedBytes: WHISPER_MODELS.base.size, totalBytes: WHISPER_MODELS.base.size },
    ])
    expect(JSON.stringify(progress)).not.toContain('owned')
    expect(JSON.stringify(progress)).not.toContain('huggingface')
  })

  it('isolates a throwing progress listener from downloads and other listeners', async () => {
    const { manager } = setup()
    const healthy = vi.fn()
    manager.onProgress(() => { throw new Error('renderer disposed') })
    manager.onProgress(healthy)

    await expect(manager.download('base')).resolves.toMatchObject({ state: 'installed' })
    expect(healthy).toHaveBeenCalled()
  })

  it('verifies and atomically activates a complete partial without another HTTP request', async () => {
    const { manager, storage, fetch, partialPath, finalPath } = setup()
    storage.entries.set(partialPath, {
      kind: 'regular', size: WHISPER_MODELS.base.size, digest: WHISPER_MODELS.base.sha256,
    })

    await expect(manager.download('base')).resolves.toMatchObject({ state: 'installed' })
    expect(fetch).not.toHaveBeenCalled()
    expect(storage.renamed).toEqual([[partialPath, finalPath]])
  })

  it('maps unexpected filesystem errors to a stable safe error without leaking paths', async () => {
    const { manager, storage } = setup()
    storage.inspect = async () => { throw new Error('C:\\private\\username\\models failed') }

    const failure = await manager.status('base').catch((error: unknown) => error)

    expect(failure).toBeInstanceOf(WhisperModelError)
    expect(failure).toMatchObject({ code: 'WHISPER_MODEL_FILESYSTEM_ERROR' })
    expect(String((failure as Error).message)).not.toMatch(/private|username|models/i)
  })

  it('restarts from zero when a range request is ignored with 200', async () => {
    const { manager, storage, fetch, partialPath } = setup()
    storage.entries.set(partialPath, { kind: 'regular', size: 100, digest: '' })

    await manager.download('base')

    expect(fetch).toHaveBeenCalledWith(WHISPER_MODELS.base.url, { headers: { Range: 'bytes=100-' } })
    expect(storage.entries.get(partialPath)).toBeUndefined()
  })

  it.each([
    ['inconsistent range', async ({ fetch }: ReturnType<typeof setup>) => fetch.mockResolvedValue(response(206, [1], { 'content-range': 'bytes 99-99/147951465' }))],
    ['network failure', async ({ fetch }: ReturnType<typeof setup>) => fetch.mockRejectedValue(new Error('private endpoint failed'))],
    ['stream failure', async ({ fetch }: ReturnType<typeof setup>) => fetch.mockResolvedValue({ status: 200, ok: true, headers: new Headers(), body: (async function* () { throw new Error('disk path secret') })() } as unknown as Response)],
    ['overflow', async ({ fetch }: ReturnType<typeof setup>) => fetch.mockResolvedValue(response(200, [WHISPER_MODELS.base.size + 1]))],
  ] as const)('%s leaves no installed state and exposes only a safe model error', async (_label, arrange) => {
    const context = setup()
    if (_label === 'inconsistent range') context.storage.entries.set(context.partialPath, { kind: 'regular', size: 100, digest: '' })
    await arrange(context)

    const failure = await context.manager.download('base').catch((error: unknown) => error)

    expect(failure).toBeInstanceOf(WhisperModelError)
    expect(failure).toMatchObject({ code: expect.stringMatching(/^WHISPER_MODEL_/) })
    expect(String((failure as Error).message)).not.toMatch(/private endpoint|disk path|huggingface|owned/i)
    await expect(context.manager.status('base')).resolves.not.toMatchObject({ state: 'installed' })
  })

  it('shares the same-model in-flight download without double-writing', async () => {
    const context = setup()
    let release!: () => void
    context.fetch.mockImplementation(() => new Promise<Response>((resolve) => { release = () => resolve(response(200, [WHISPER_MODELS.base.size])) }))

    const first = context.manager.download('base')
    const second = context.manager.download('base')
    await vi.waitFor(() => expect(context.fetch).toHaveBeenCalledTimes(1))
    release()
    await expect(Promise.all([first, second])).resolves.toHaveLength(2)
    expect(context.fetch).toHaveBeenCalledTimes(1)
    expect(context.storage.renamed).toHaveLength(1)
  })

  it('deletes only the manifest-owned final and partial files', async () => {
    const { manager, storage, root, finalPath, partialPath } = setup()
    const unrelated = join(root, 'notes.txt')
    for (const path of [finalPath, partialPath, unrelated]) storage.entries.set(path, { kind: 'regular', size: 1, digest: '' })

    await manager.delete('base')

    expect(storage.removed).toEqual([finalPath, partialPath])
    expect(storage.entries.has(unrelated)).toBe(true)
  })

  it('verifiedPath rechecks trust on every call and never exposes an invalid file path', async () => {
    const { manager, storage, finalPath } = setup()
    storage.entries.set(finalPath, { kind: 'regular', size: WHISPER_MODELS.base.size, digest: WHISPER_MODELS.base.sha256 })
    await expect(manager.verifiedPath('base')).resolves.toBe(finalPath)

    storage.entries.set(finalPath, { kind: 'symlink', size: WHISPER_MODELS.base.size, digest: WHISPER_MODELS.base.sha256 })
    await expect(manager.verifiedPath('base')).rejects.toMatchObject({ code: 'WHISPER_MODEL_NOT_INSTALLED' })
  })
})

describe('Whisper model settings IPC and preload', () => {
  beforeEach(() => vi.resetModules())

  it('parses model IDs in every lifecycle handler while preserving API-key/provider contracts', async () => {
    const handlers = new Map<string, (...args: unknown[]) => unknown>()
    let progressListener!: (progress: { modelId: 'base'; receivedBytes: number; totalBytes: number }) => void
    const publish = vi.fn()
    const descriptors = vi.fn().mockResolvedValue([])
    const models = {
      list: vi.fn().mockResolvedValue([]), download: vi.fn(), delete: vi.fn(),
      onProgress: vi.fn((listener) => { progressListener = listener; return () => undefined }),
    }
    registerSettingsHandlers(
      { handle: (channel, handler) => handlers.set(channel, handler) },
      { get: async () => null, set: async () => undefined, delete: async () => undefined },
      { validate: async () => undefined },
      { get: () => ({ transcriptionProvider: 'openai', summaryProvider: 'openai', localWhisperModel: 'base' }), update: (input) => input },
      { descriptors },
      models,
      publish,
    )

    await expect(handlers.get('settings:download-whisper-model')?.({}, 'large')).rejects.toThrow()
    expect(models.download).not.toHaveBeenCalled()
    await handlers.get('settings:delete-whisper-model')?.({}, 'small')
    expect(models.delete).toHaveBeenCalledWith('small')
    expect(descriptors).not.toHaveBeenCalled()
    await expect(handlers.get('settings:get-api-key-status')?.({})).resolves.toEqual({ configured: false, lastValidatedAt: null })
    await expect(handlers.get('settings:get-processing-providers')?.({})).resolves.toMatchObject({ transcriptionProvider: 'openai' })
    expect(handlers.has('settings:list-processing-provider-descriptors')).toBe(true)
    progressListener({ modelId: 'base', receivedBytes: 10, totalBytes: WHISPER_MODELS.base.size })
    expect(publish).toHaveBeenCalledWith({ modelId: 'base', receivedBytes: 10, totalBytes: WHISPER_MODELS.base.size })
  })

  it('validates statuses/progress and removes the exact preload listener', async () => {
    let exposed!: DesktopApi
    let progressHandler!: (event: unknown, value: unknown) => void
    const removeListener = vi.fn()
    const invoke = vi.fn().mockResolvedValue([{ modelId: 'base', state: 'installed', expectedBytes: WHISPER_MODELS.base.size, receivedBytes: WHISPER_MODELS.base.size, error: null }])
    vi.doMock('electron', () => ({
      contextBridge: { exposeInMainWorld: (_name: string, api: DesktopApi) => { exposed = api } },
      ipcRenderer: {
        invoke,
        on: vi.fn((_channel: string, handler: typeof progressHandler) => { progressHandler = handler }),
        removeListener,
      },
    }))
    await import('../../src/preload/index')

    await expect(exposed.settings.listWhisperModels()).resolves.toHaveLength(1)
    invoke.mockResolvedValueOnce({ modelId: 'small', state: 'not_installed', expectedBytes: WHISPER_MODELS.small.size, receivedBytes: 0, error: null })
    await expect(exposed.settings.downloadWhisperModel('small')).resolves.toMatchObject({ modelId: 'small' })
    invoke.mockResolvedValueOnce({ modelId: 'small', state: 'not_installed', expectedBytes: WHISPER_MODELS.small.size, receivedBytes: 0, error: { code: 'raw', message: 'bad' } })
    await expect(exposed.settings.deleteWhisperModel('small')).rejects.toThrow()
    await expect(exposed.settings.downloadWhisperModel('large' as never)).rejects.toThrow()
    const listener = vi.fn()
    const unsubscribe = exposed.settings.onWhisperModelProgress(listener)
    progressHandler({}, { modelId: 'base', receivedBytes: 1, totalBytes: WHISPER_MODELS.base.size })
    progressHandler({}, { modelId: 'large', receivedBytes: 2, totalBytes: 3 })
    progressHandler({}, { modelId: 'base', receivedBytes: 4, totalBytes: 3 })
    expect(listener).toHaveBeenCalledTimes(1)
    unsubscribe()
    expect(removeListener).toHaveBeenCalledWith('settings:whisper-model-progress', progressHandler)

    invoke.mockResolvedValueOnce([{ modelId: 'base', state: 'installed', expectedBytes: 1, receivedBytes: 1, localPath: 'secret' }])
    await expect(exposed.settings.listWhisperModels()).rejects.toThrow()
    invoke.mockResolvedValueOnce([{
      modelId: 'base', state: 'corrupt', expectedBytes: WHISPER_MODELS.base.size,
      receivedBytes: 0, error: { code: 'WHISPER_MODEL_UNKNOWN', message: 'Unsafe detail' },
    }])
    await expect(exposed.settings.listWhisperModels()).rejects.toThrow()
    expect(WhisperModelStatusSchema.safeParse({
      modelId: 'base', state: 'corrupt', expectedBytes: WHISPER_MODELS.base.size,
      receivedBytes: 0, error: { code: 'WHISPER_MODEL_INVALID_FILE', message: '' },
    }).success).toBe(false)
  })
})

describe('NodeWhisperModelStorage secure file handles', () => {
  const roots: string[] = []
  const storages: NodeWhisperModelStorage[] = []
  afterEach(async () => {
    await Promise.all(storages.splice(0).map((storage) => storage.close()))
    await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })))
  })

  async function temporaryRoot() {
    const parent = await realpath(await mkdtemp(join(tmpdir(), 'nnote-whisper-storage-')))
    roots.push(parent)
    const root = join(parent, 'owned')
    const storage = new NodeWhisperModelStorage()
    storages.push(storage)
    await storage.ensureRoot(root)
    return { parent, root, storage }
  }

  async function* bytes(value: string) { yield Buffer.from(value) }

  it('hashes an owned regular file through its verified open handle', async () => {
    const { root, storage } = await temporaryRoot()
    const path = join(root, 'ggml-base.bin')
    await writeFile(path, 'owned bytes')

    await expect(storage.hash(path)).resolves.toBe(
      createHash('sha256').update('owned bytes').digest('hex'),
    )
  })

  it('truncates and appends an owned regular partial through production storage', async () => {
    const { root, storage } = await temporaryRoot()
    const partial = join(root, 'ggml-base.bin.partial')
    const progress: number[] = []

    await storage.write(partial, bytes('fresh'), 'truncate', 10, (received) => progress.push(received))
    await storage.write(partial, bytes(' data'), 'append', 10, (received) => progress.push(received))

    await expect(readFile(partial, 'utf8')).resolves.toBe('fresh data')
    expect(progress).toEqual([5, 10])
  })

  it('rejects a final symlink at open time without reading its target', async () => {
    const { parent, root, storage } = await temporaryRoot()
    const target = join(parent, 'outside-secret')
    const link = join(root, 'ggml-base.bin')
    await writeFile(target, 'do not read')
    await symlink(target, link, 'file')

    await expect(storage.hash(link)).rejects.toMatchObject({ code: 'WHISPER_MODEL_INVALID_FILE' })
    await expect(readFile(target, 'utf8')).resolves.toBe('do not read')
  })

  it('rejects a truncate symlink and never changes its target', async () => {
    const { parent, root, storage } = await temporaryRoot()
    const target = join(parent, 'outside-target')
    const partial = join(root, 'ggml-base.bin.partial')
    await writeFile(target, 'untouched')
    await symlink(target, partial, 'file')

    await expect(storage.write(partial, bytes('new partial'), 'truncate', 100, () => undefined))
      .rejects.toMatchObject({ code: 'WHISPER_MODEL_INVALID_FILE' })

    await expect(readFile(target, 'utf8')).resolves.toBe('untouched')
  })

  it('rejects an append symlink without changing its target', async () => {
    const { parent, root, storage } = await temporaryRoot()
    const target = join(parent, 'outside-target')
    const partial = join(root, 'ggml-base.bin.partial')
    await writeFile(target, 'untouched')
    await symlink(target, partial, 'file')

    await expect(storage.write(partial, bytes('bad'), 'append', 100, () => undefined))
      .rejects.toMatchObject({ code: 'WHISPER_MODEL_INVALID_FILE' })
    await expect(readFile(target, 'utf8')).resolves.toBe('untouched')
  })

  it('deletes a manifest-owned symlink entry without changing its target', async () => {
    const { parent, root, storage } = await temporaryRoot()
    const target = join(parent, 'outside-target')
    const finalPath = join(root, 'ggml-base.bin')
    await writeFile(target, 'untouched')
    await symlink(target, finalPath, 'file')

    await storage.remove(finalPath)

    await expect(readFile(finalPath)).rejects.toMatchObject({ code: 'ENOENT' })
    await expect(readFile(target, 'utf8')).resolves.toBe('untouched')
  })

  it('removes an owned regular file after handle verification', async () => {
    const { root, storage } = await temporaryRoot()
    const finalPath = join(root, 'ggml-base.bin')
    await writeFile(finalPath, 'owned model')

    await storage.remove(finalPath)

    await expect(readFile(finalPath)).rejects.toMatchObject({ code: 'ENOENT' })
  })

  it('rejects a regular-file-to-symlink swap between inspection and open', async () => {
    const { parent, root } = await temporaryRoot()
    const target = join(parent, 'outside-target')
    const partial = join(root, 'ggml-base.bin.partial')
    const displaced = join(root, 'displaced-partial')
    await writeFile(target, 'untouched')
    await writeFile(partial, 'safe')
    const storage = new NodeWhisperModelStorage({
      beforeOpen: async (path, operation) => {
        if (path === partial && operation === 'append') {
          await renameFile(partial, displaced)
          await symlink(target, partial, 'file')
        }
      },
    })
    storages.push(storage)
    await storage.ensureRoot(root)
    await storage.inspect(partial)

    await expect(storage.write(partial, bytes('bad'), 'append', 100, () => undefined))
      .rejects.toMatchObject({ code: 'WHISPER_MODEL_INVALID_FILE' })
    await expect(readFile(target, 'utf8')).resolves.toBe('untouched')
  })

  it('rejects a final-file-to-symlink swap before the hash handle opens', async () => {
    const { parent, root } = await temporaryRoot()
    const target = join(parent, 'outside-secret')
    const finalPath = join(root, 'ggml-base.bin')
    const displaced = join(root, 'displaced-final')
    await writeFile(target, 'do not hash')
    await writeFile(finalPath, 'safe')
    const storage = new NodeWhisperModelStorage({
      beforeOpen: async (path, operation) => {
        if (path === finalPath && operation === 'hash') {
          await renameFile(finalPath, displaced)
          await symlink(target, finalPath, 'file')
        }
      },
    })
    storages.push(storage)
    await storage.ensureRoot(root)
    await storage.inspect(finalPath)

    await expect(storage.hash(finalPath)).rejects.toMatchObject({ code: 'WHISPER_MODEL_INVALID_FILE' })
    await expect(readFile(target, 'utf8')).resolves.toBe('do not hash')
  })

  it('revalidates the owned root identity after opening a file', async () => {
    const { parent, root } = await temporaryRoot()
    const outside = join(parent, 'outside-root')
    const displacedRoot = join(parent, 'displaced-root')
    const finalPath = join(root, 'ggml-base.bin')
    await writeFile(finalPath, 'safe')
    await mkdir(outside)
    await writeFile(join(outside, 'ggml-base.bin'), 'outside secret')
    const storage = new NodeWhisperModelStorage({
      beforeOpen: async (_path, operation) => {
        if (operation === 'hash') {
          await renameFile(root, displacedRoot)
          await symlink(outside, root, process.platform === 'win32' ? 'junction' : 'dir')
        }
      },
    })
    storages.push(storage)
    await storage.ensureRoot(root)

    await expect(storage.hash(finalPath)).rejects.toMatchObject({ code: 'WHISPER_MODEL_INVALID_FILE' })
    await expect(readFile(join(outside, 'ggml-base.bin'), 'utf8')).resolves.toBe('outside secret')
  })

  it('does not truncate an outside file when the root swaps before mutation', async () => {
    const { parent, root } = await temporaryRoot()
    const outside = join(parent, 'outside-root')
    const displacedRoot = join(parent, 'displaced-root')
    const partial = join(root, 'ggml-base.bin.partial')
    await mkdir(outside)
    await writeFile(partial, 'owned partial')
    await writeFile(join(outside, 'ggml-base.bin.partial'), 'outside sentinel')
    const storage = new NodeWhisperModelStorage({
      beforeMutation: async (_path: string, operation: string) => {
        if (operation === 'truncate') {
          await renameFile(root, displacedRoot)
          await symlink(outside, root, process.platform === 'win32' ? 'junction' : 'dir')
        }
      },
    } as never)
    storages.push(storage)
    await storage.ensureRoot(root)

    await expect(storage.write(partial, bytes('replacement'), 'truncate', 100, () => undefined))
      .rejects.toMatchObject({ code: 'WHISPER_MODEL_INVALID_FILE' })
    await expect(readFile(join(outside, 'ggml-base.bin.partial'), 'utf8')).resolves.toBe('outside sentinel')
    const originalPartial = process.platform === 'win32'
      ? partial
      : join(displacedRoot, 'ggml-base.bin.partial')
    await expect(readFile(originalPartial, 'utf8')).resolves.toBe('owned partial')
  })

  it('does not remove an outside file when the root swaps before removal', async () => {
    const { parent, root } = await temporaryRoot()
    const outside = join(parent, 'outside-root')
    const displacedRoot = join(parent, 'displaced-root')
    const finalPath = join(root, 'ggml-base.bin')
    await mkdir(outside)
    await writeFile(finalPath, 'owned model')
    await writeFile(join(outside, 'ggml-base.bin'), 'outside sentinel')
    const storage = new NodeWhisperModelStorage({
      beforeMutation: async (_path: string, operation: string) => {
        if (operation === 'remove') {
          await renameFile(root, displacedRoot)
          await symlink(outside, root, process.platform === 'win32' ? 'junction' : 'dir')
        }
      },
    } as never)
    storages.push(storage)
    await storage.ensureRoot(root)

    await expect(storage.remove(finalPath)).rejects.toMatchObject({ code: 'WHISPER_MODEL_INVALID_FILE' })
    await expect(readFile(join(outside, 'ggml-base.bin'), 'utf8')).resolves.toBe('outside sentinel')
    const originalFinal = process.platform === 'win32'
      ? finalPath
      : join(displacedRoot, 'ggml-base.bin')
    await expect(readFile(originalFinal, 'utf8')).resolves.toBe('owned model')
  })

  it('does not create an outside partial when the root swaps before exclusive create', async () => {
    const { parent, root } = await temporaryRoot()
    const outside = join(parent, 'outside-root')
    const displacedRoot = join(parent, 'displaced-root')
    const partial = join(root, 'ggml-base.bin.partial')
    await mkdir(outside)
    const storage = new NodeWhisperModelStorage({
      beforeOpen: async (_path, operation) => {
        if (operation === 'truncate') {
          await renameFile(root, displacedRoot)
          await symlink(outside, root, process.platform === 'win32' ? 'junction' : 'dir')
        }
      },
    })
    storages.push(storage)
    await storage.ensureRoot(root)

    await expect(storage.write(partial, bytes('new'), 'truncate', 100, () => undefined))
      .rejects.toMatchObject({ code: 'WHISPER_MODEL_INVALID_FILE' })
    await expect(readFile(join(outside, 'ggml-base.bin.partial'))).rejects.toMatchObject({ code: 'ENOENT' })
  })

  it('ties activation rename to the identity that produced the verified hash', async () => {
    const { root, storage } = await temporaryRoot()
    const partial = join(root, 'ggml-base.bin.partial')
    const displaced = join(root, 'verified-but-displaced')
    const finalPath = join(root, 'ggml-base.bin')
    await writeFile(partial, 'verified bytes')
    await storage.hash(partial)
    await renameFile(partial, displaced)
    await writeFile(partial, 'replacement bytes')

    await expect(storage.rename(partial, finalPath)).rejects.toMatchObject({ code: 'WHISPER_MODEL_INVALID_FILE' })
    await expect(readFile(finalPath)).rejects.toMatchObject({ code: 'ENOENT' })
  })
})
