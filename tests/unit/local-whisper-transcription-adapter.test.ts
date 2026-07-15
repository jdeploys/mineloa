import { mkdir, mkdtemp, readFile, realpath, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { LocalWhisperTranscriptionAdapter } from '../../src/main/ai/providers/localWhisperTranscriptionAdapter'
import { resolveLocalRuntimePaths } from '../../src/main/localRuntime/runtimePaths'
import { parseWhisperOutput } from '../../src/main/localRuntime/whisperOutput'
import type { OwnedProcessRequest, OwnedProcessResult } from '../../src/main/process/runOwnedProcess'

const roots: string[] = []

afterEach(async () => {
  vi.restoreAllMocks()
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })))
})

async function root(prefix: string): Promise<string> {
  const path = await realpath(await mkdtemp(join(tmpdir(), prefix)))
  roots.push(path)
  return path
}

function pcmWav(durationSeconds: number): Buffer {
  const dataBytes = Math.round(durationSeconds * 16_000 * 2)
  const value = Buffer.alloc(44 + dataBytes)
  value.write('RIFF', 0)
  value.writeUInt32LE(36 + dataBytes, 4)
  value.write('WAVE', 8)
  value.write('fmt ', 12)
  value.writeUInt32LE(16, 16)
  value.writeUInt16LE(1, 20)
  value.writeUInt16LE(1, 22)
  value.writeUInt32LE(16_000, 24)
  value.writeUInt32LE(32_000, 28)
  value.writeUInt16LE(2, 32)
  value.writeUInt16LE(16, 34)
  value.write('data', 36)
  value.writeUInt32LE(dataBytes, 40)
  return value
}

const whisperJson = (segments: unknown[]) => JSON.stringify({
  result: { language: 'ko' },
  transcription: segments,
})

async function harness(options: {
  durationSeconds?: number
  output?: string
  wav?: Buffer
  processResults?: OwnedProcessResult[]
  cleanup?: (path: string) => Promise<void>
} = {}) {
  const parent = await root('nnote-local-whisper-')
  const recordingsRoot = join(parent, 'recordings')
  const runtimeRoot = join(parent, 'runtime')
  const tempRoot = join(parent, 'temp')
  const input = join(recordingsRoot, 'part-0.webm')
  const ffmpegPath = join(runtimeRoot, 'ffmpeg.exe')
  const whisperPath = join(runtimeRoot, 'whisper-cli.exe')
  const modelPath = join(parent, 'model', 'ggml-base.bin')
  await Promise.all([mkdir(recordingsRoot), mkdir(runtimeRoot), mkdir(tempRoot), mkdir(join(parent, 'model'))])
  await Promise.all([
    writeFile(input, 'audio'), writeFile(ffmpegPath, 'binary'),
    writeFile(whisperPath, 'binary'), writeFile(modelPath, 'model'),
  ])
  const calls: OwnedProcessRequest[] = []
  const results = [...(options.processResults ?? [])]
  const run = vi.fn(async (request: OwnedProcessRequest): Promise<OwnedProcessResult> => {
    calls.push(request)
    const queued = results.shift()
    if (queued !== undefined) return queued
    if (calls.length === 1) await writeFile(request.args.at(-1)!, options.wav ?? pcmWav(options.durationSeconds ?? 4))
    else await writeFile(`${request.args.at(-1)!}.json`, options.output ?? whisperJson([
      { timestamps: { from: '00:00:00,000', to: '00:00:01,200' }, offsets: { from: 0, to: 1200 }, text: '  안녕하세요  ' },
    ]))
    return { status: 'success', exitCode: 0, stdout: '', stderr: '' }
  })
  const adapter = new LocalWhisperTranscriptionAdapter({
    resolveRuntimePaths: vi.fn(async () => ({ ffmpegPath, whisperPath })),
    verifiedModelPath: vi.fn(async () => modelPath),
    resolveModel: () => 'base',
    recordingsRoot,
    temporaryRoot: tempRoot,
    runProcess: run,
    removeTemporaryDirectory: options.cleanup,
  })
  return { adapter, calls, input, parent, recordingsRoot, runtimeRoot, tempRoot, ffmpegPath, whisperPath, modelPath, run }
}

describe('LocalWhisperTranscriptionAdapter', () => {
  it('invokes only owned helpers with exact argv and preserves durable trailing silence', async () => {
    const h = await harness()

    await expect(h.adapter.transcribe({ filePath: h.input, recordingDurationSeconds: 6 })).resolves.toEqual({
      durationSeconds: 6,
      segments: [{ speakerLabel: null, startSeconds: 0, endSeconds: 1.2, text: '안녕하세요' }],
    })

    expect(h.calls).toHaveLength(2)
    const temporaryWav = h.calls[0]!.args.at(-1)!
    const outputBase = h.calls[1]!.args.at(-1)!
    expect(h.calls[0]).toMatchObject({
      command: h.ffmpegPath, cwd: expect.stringContaining('nnote-whisper-'),
      args: ['-nostdin', '-hide_banner', '-loglevel', 'error', '-i', resolve(h.input), '-ac', '1', '-ar', '16000', '-c:a', 'pcm_s16le', '-y', temporaryWav],
    })
    expect(h.calls[1]).toMatchObject({
      command: h.whisperPath, cwd: h.calls[0]!.cwd,
      args: ['-m', h.modelPath, '-f', temporaryWav, '-l', 'ko', '-oj', '-of', outputBase],
    })
    expect(h.calls.every((call) => !('shell' in call))).toBe(true)
    await expect(readFile(h.calls[0]!.cwd)).rejects.toMatchObject({ code: 'ENOENT' })
  })

  it('uses validated PCM duration for legacy requests instead of the last speech timestamp', async () => {
    const h = await harness({ durationSeconds: 7.25 })
    await expect(h.adapter.transcribe({ filePath: h.input })).resolves.toMatchObject({ durationSeconds: 7.25 })
  })

  it.each([
    ['converter non-zero', [{ status: 'nonzero_exit', exitCode: 2, stdout: 'secret', stderr: 'path' }]],
    ['converter timeout', [{ status: 'timeout' }]],
    ['Whisper non-zero', [{ status: 'success', exitCode: 0, stdout: '', stderr: '' }, { status: 'nonzero_exit', exitCode: 3, stdout: 'transcript canary', stderr: 'path' }]],
    ['Whisper timeout', [{ status: 'success', exitCode: 0, stdout: '', stderr: '' }, { status: 'timeout' }]],
    ['process output overflow', [{ status: 'output_overflow', stream: 'stderr' }]],
  ] as const)('maps %s to a safe error and removes its owned directory', async (_label, processResults) => {
    const h = await harness({ processResults: processResults as unknown as OwnedProcessResult[] })
    const failure = await h.adapter.transcribe({ filePath: h.input, recordingDurationSeconds: 4 }).catch((error: unknown) => error)
    expect(failure).toMatchObject({ code: expect.stringMatching(/^LOCAL_WHISPER_/), retryable: expect.any(Boolean) })
    expect(String(failure)).not.toMatch(/secret|canary|part-0|\\|\//)
    const cwd = h.calls[0]?.cwd
    if (cwd !== undefined) await expect(readFile(cwd)).rejects.toMatchObject({ code: 'ENOENT' })
  })

  it.each([
    ['missing output', undefined],
    ['malformed JSON', '{bad'],
    ['bad timestamp', whisperJson([{ timestamps: { from: '00:00:00,020', to: '00:00:00,010' }, offsets: { from: 20, to: 10 }, text: 'bad' }])],
    ['empty text', whisperJson([{ timestamps: { from: '00:00:00,000', to: '00:00:00,010' }, offsets: { from: 0, to: 10 }, text: '   ' }])],
    ['segment beyond duration', whisperJson([{ timestamps: { from: '00:00:00,000', to: '00:00:05,000' }, offsets: { from: 0, to: 5000 }, text: 'too long' }])],
  ])('rejects %s with no output detail leakage', async (_label, output) => {
    const h = await harness({ output })
    if (output === undefined) h.run.mockImplementationOnce(async (request) => {
      h.calls.push(request)
      await writeFile(request.args.at(-1)!, pcmWav(4))
      return { status: 'success', exitCode: 0, stdout: '', stderr: '' }
    }).mockResolvedValueOnce({ status: 'success', exitCode: 0, stdout: '', stderr: '' })
    const failure = await h.adapter.transcribe({ filePath: h.input, recordingDurationSeconds: 4 }).catch((error: unknown) => error)
    expect(failure).toMatchObject({ code: 'LOCAL_WHISPER_INVALID_OUTPUT' })
    expect(String(failure)).not.toContain('too long')
    await expect(readFile(h.calls[0]!.cwd)).rejects.toMatchObject({ code: 'ENOENT' })
  })

  it('rejects oversized output before parsing', async () => {
    const h = await harness({ output: 'x'.repeat(16 * 1024 * 1024 + 1) })
    await expect(h.adapter.transcribe({ filePath: h.input, recordingDurationSeconds: 4 })).rejects.toMatchObject({
      code: 'LOCAL_WHISPER_OUTPUT_TOO_LARGE',
    })
    await expect(readFile(h.calls[0]!.cwd)).rejects.toMatchObject({ code: 'ENOENT' })
  })

  it('rejects escaped and symlink inputs before spawning', async (context) => {
    const h = await harness()
    const outside = join(h.parent, 'outside.webm')
    const linked = join(h.recordingsRoot, 'linked.webm')
    await writeFile(outside, 'outside')
    try { await symlink(outside, linked, 'file') } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'EPERM') { context.skip(); return }
      throw error
    }
    await expect(h.adapter.transcribe({ filePath: outside })).rejects.toMatchObject({ code: 'LOCAL_WHISPER_INVALID_INPUT' })
    await expect(h.adapter.transcribe({ filePath: linked })).rejects.toMatchObject({ code: 'LOCAL_WHISPER_INVALID_INPUT' })
    expect(h.run).not.toHaveBeenCalled()
  })

  it('rejects a linked temporary root before creating process files', async (context) => {
    const h = await harness()
    const linkedTemp = join(h.parent, 'linked-temp')
    try { await symlink(h.tempRoot, linkedTemp, process.platform === 'win32' ? 'junction' : 'dir') } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'EPERM') { context.skip(); return }
      throw error
    }
    const adapter = new LocalWhisperTranscriptionAdapter({
      resolveRuntimePaths: async () => ({ ffmpegPath: h.ffmpegPath, whisperPath: h.whisperPath }),
      verifiedModelPath: async () => h.modelPath, resolveModel: () => 'base',
      recordingsRoot: h.recordingsRoot, temporaryRoot: linkedTemp, runProcess: h.run,
    })
    await expect(adapter.transcribe({ filePath: h.input })).rejects.toMatchObject({
      code: 'LOCAL_WHISPER_FILESYSTEM_ERROR',
    })
    expect(h.run).not.toHaveBeenCalled()
  })

  it.each([
    ['truncated header', Buffer.from('RIFF')],
    ['declared data beyond file', (() => { const wav = pcmWav(1); wav.writeUInt32LE(wav.length, 40); return wav })()],
    ['wrong PCM format', (() => { const wav = pcmWav(1); wav.writeUInt16LE(3, 20); return wav })()],
    ['wrong channels', (() => { const wav = pcmWav(1); wav.writeUInt16LE(2, 22); return wav })()],
    ['wrong sample rate', (() => { const wav = pcmWav(1); wav.writeUInt32LE(8_000, 24); return wav })()],
    ['wrong byte rate', (() => { const wav = pcmWav(1); wav.writeUInt32LE(16_000, 28); return wav })()],
    ['wrong block alignment', (() => { const wav = pcmWav(1); wav.writeUInt16LE(4, 32); return wav })()],
    ['wrong bits', (() => { const wav = pcmWav(1); wav.writeUInt16LE(8, 34); return wav })()],
    ['unaligned data', (() => { const wav = pcmWav(1); wav.writeUInt32LE(31_999, 40); return wav })()],
  ])('rejects malformed PCM: %s', async (_label, wav) => {
    const h = await harness({ wav })
    await expect(h.adapter.transcribe({ filePath: h.input })).rejects.toMatchObject({ code: 'LOCAL_WHISPER_INVALID_OUTPUT' })
    expect(h.calls).toHaveLength(1)
    await expect(readFile(h.calls[0]!.cwd)).rejects.toMatchObject({ code: 'ENOENT' })
  })

  it('rejects symlinked generated WAV and JSON without reading or changing outside targets', async (context) => {
    const wavHarness = await harness()
    const outsideWav = join(wavHarness.parent, 'outside.wav')
    await writeFile(outsideWav, pcmWav(4))
    wavHarness.run.mockImplementationOnce(async (request) => {
      wavHarness.calls.push(request)
      try { await symlink(outsideWav, request.args.at(-1)!, 'file') } catch (error) {
        if ((error as NodeJS.ErrnoException).code === 'EPERM') { context.skip(); return { status: 'success', exitCode: 0, stdout: '', stderr: '' } }
        throw error
      }
      return { status: 'success', exitCode: 0, stdout: '', stderr: '' }
    })
    await expect(wavHarness.adapter.transcribe({ filePath: wavHarness.input })).rejects.toMatchObject({ code: 'LOCAL_WHISPER_INVALID_OUTPUT' })
    await expect(readFile(outsideWav)).resolves.toEqual(pcmWav(4))

    const jsonHarness = await harness()
    const outsideJson = join(jsonHarness.parent, 'outside.json')
    await writeFile(outsideJson, 'outside transcript canary')
    jsonHarness.run.mockImplementationOnce(async (request) => {
      jsonHarness.calls.push(request)
      await writeFile(request.args.at(-1)!, pcmWav(4))
      return { status: 'success', exitCode: 0, stdout: '', stderr: '' }
    }).mockImplementationOnce(async (request) => {
      jsonHarness.calls.push(request)
      await symlink(outsideJson, `${request.args.at(-1)!}.json`, 'file')
      return { status: 'success', exitCode: 0, stdout: '', stderr: '' }
    })
    const failure = await jsonHarness.adapter.transcribe({ filePath: jsonHarness.input }).catch((error: unknown) => error)
    expect(failure).toMatchObject({ code: 'LOCAL_WHISPER_INVALID_OUTPUT' })
    expect(String(failure)).not.toContain('outside transcript canary')
    await expect(readFile(outsideJson, 'utf8')).resolves.toBe('outside transcript canary')
    await expect(readFile(jsonHarness.calls[0]!.cwd)).rejects.toMatchObject({ code: 'ENOENT' })
  })

  it('reports runtime/model availability safely and exposes only local capabilities', async () => {
    const h = await harness()
    await expect(h.adapter.descriptor()).resolves.toMatchObject({
      id: 'local_whisper', stage: 'transcription', displayName: 'Local Whisper', privacy: 'local',
      capabilities: ['model_manager'], availability: { available: true, code: null, message: null },
    })
    const unavailable = new LocalWhisperTranscriptionAdapter({
      resolveRuntimePaths: async () => { throw new Error('C:\\runtime\\canary') },
      verifiedModelPath: async () => { throw new Error('model canary') }, resolveModel: () => 'base',
      recordingsRoot: h.recordingsRoot, temporaryRoot: h.tempRoot, runProcess: h.run,
    })
    const availability = await unavailable.availability()
    expect(availability).toMatchObject({ available: false, code: 'LOCAL_WHISPER_RUNTIME_UNAVAILABLE' })
    expect(JSON.stringify(availability)).not.toMatch(/canary|\\runtime/)
  })

  it('maps missing runtime and corrupt model failures without spawning or leaking paths', async () => {
    const h = await harness()
    const missingRuntime = new LocalWhisperTranscriptionAdapter({
      resolveRuntimePaths: async () => { throw new Error('C:\\runtime\\missing.exe') },
      verifiedModelPath: async () => h.modelPath, resolveModel: () => 'base',
      recordingsRoot: h.recordingsRoot, temporaryRoot: h.tempRoot, runProcess: h.run,
    })
    await expect(missingRuntime.transcribe({ filePath: h.input })).rejects.toMatchObject({
      code: 'LOCAL_WHISPER_RUNTIME_UNAVAILABLE',
    })
    const corruptModel = new LocalWhisperTranscriptionAdapter({
      resolveRuntimePaths: async () => ({ ffmpegPath: h.ffmpegPath, whisperPath: h.whisperPath }),
      verifiedModelPath: async () => { throw new Error('C:\\model\\corrupt.bin') }, resolveModel: () => 'base',
      recordingsRoot: h.recordingsRoot, temporaryRoot: h.tempRoot, runProcess: h.run,
    })
    const failure = await corruptModel.transcribe({ filePath: h.input }).catch((error: unknown) => error)
    expect(failure).toMatchObject({ code: 'LOCAL_WHISPER_MODEL_UNAVAILABLE' })
    expect(String(failure)).not.toMatch(/missing|corrupt|\\runtime|\\model/)
    expect(h.run).not.toHaveBeenCalled()
  })

  it('does not replace a primary safe error when cleanup also fails', async () => {
    const h = await harness({
      processResults: [{ status: 'timeout' }],
      cleanup: async () => { throw new Error('cleanup canary') },
    })
    const failure = await h.adapter.transcribe({ filePath: h.input }).catch((error: unknown) => error)
    expect(failure).toMatchObject({ code: 'LOCAL_WHISPER_TIMEOUT' })
    expect(String(failure)).not.toContain('cleanup canary')
  })
})

describe('pinned whisper.cpp output parser', () => {
  it('accepts only the pinned offsets shape with finite monotonic milliseconds', () => {
    expect(parseWhisperOutput(whisperJson([
      { timestamps: { from: '00:00:00,000', to: '00:00:00,250' }, offsets: { from: 0, to: 250 }, text: ' 첫째 ' },
      { timestamps: { from: '00:00:00,250', to: '00:00:00,800' }, offsets: { from: 250, to: 800 }, text: '둘째' },
    ]), 2)).toEqual({
      durationSeconds: 2,
      segments: [
        { speakerLabel: null, startSeconds: 0, endSeconds: 0.25, text: '첫째' },
        { speakerLabel: null, startSeconds: 0.25, endSeconds: 0.8, text: '둘째' },
      ],
    })
    expect(() => parseWhisperOutput(JSON.stringify({ segments: [] }), 2)).toThrow()
    expect(() => parseWhisperOutput(whisperJson([{ offsets: { from: Number.NaN, to: 1 }, text: 'x' }]), 2)).toThrow()
    expect(() => parseWhisperOutput(whisperJson([{
      timestamps: { from: 'not-a-time', to: 'still-not-a-time' }, offsets: { from: 0, to: 1 }, text: 'x',
    }]), 2)).toThrow()
    expect(() => parseWhisperOutput(whisperJson([{
      timestamps: { from: '00:00:00,000', to: '00:00:03,000' }, offsets: { from: 0, to: 3000 }, text: 'too long',
    }]), 2)).toThrow()
    expect(() => parseWhisperOutput(whisperJson([{
      timestamps: { from: '00:00:60,000', to: '00:01:00,001' }, offsets: { from: 60_000, to: 60_001 }, text: 'range',
    }]), 120)).toThrow()
    expect(() => parseWhisperOutput(whisperJson([{
      timestamps: { from: '00:00:00,001', to: '00:00:00,002' }, offsets: { from: 0, to: 2 }, text: 'mismatch',
    }]), 2)).toThrow()
    expect(() => parseWhisperOutput(JSON.stringify({
      result: { language: 'en' }, transcription: [],
    }), 2)).toThrow()
    expect(() => parseWhisperOutput(whisperJson([
      { timestamps: { from: '00:00:00,000', to: '00:00:01,000' }, offsets: { from: 0, to: 1000 }, text: 'first' },
      { timestamps: { from: '00:00:00,500', to: '00:00:00,600' }, offsets: { from: 500, to: 600 }, text: 'regressed' },
    ]), 2)).toThrow()
  })
})

describe('local runtime path resolver', () => {
  it('resolves only the fixed packaged target and rejects unsupported or linked helpers', async (context) => {
    const resources = await root('nnote-runtime-')
    const owned = join(resources, 'local-runtime', 'win32-x64')
    await mkdir(owned, { recursive: true })
    await writeFile(join(owned, 'ffmpeg.exe'), 'ffmpeg')
    await writeFile(join(owned, 'whisper-cli.exe'), 'whisper')
    await expect(resolveLocalRuntimePaths({ isPackaged: true, resourcesPath: resources, platform: 'win32', arch: 'x64' }))
      .resolves.toEqual({ ffmpegPath: resolve(owned, 'ffmpeg.exe'), whisperPath: resolve(owned, 'whisper-cli.exe') })
    await expect(resolveLocalRuntimePaths({ isPackaged: true, resourcesPath: resources, platform: 'linux', arch: 'x64' }))
      .rejects.toMatchObject({ code: 'LOCAL_WHISPER_UNSUPPORTED_RUNTIME' })

    const target = join(resources, 'outside.exe')
    await writeFile(target, 'outside')
    await rm(join(owned, 'ffmpeg.exe'))
    try { await symlink(target, join(owned, 'ffmpeg.exe'), 'file') } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'EPERM') { context.skip(); return }
      throw error
    }
    await expect(resolveLocalRuntimePaths({ isPackaged: true, resourcesPath: resources, platform: 'win32', arch: 'x64' }))
      .rejects.toMatchObject({ code: 'LOCAL_WHISPER_RUNTIME_UNAVAILABLE' })
  })

  it('requires an explicit development override and never searches PATH', async () => {
    const resources = await root('nnote-runtime-dev-')
    await expect(resolveLocalRuntimePaths({ isPackaged: false, resourcesPath: resources, platform: 'win32', arch: 'x64' }))
      .rejects.toMatchObject({ code: 'LOCAL_WHISPER_RUNTIME_UNAVAILABLE' })
  })

  it('accepts an explicit owned development override and both packaged macOS targets', async () => {
    const development = await root('nnote-runtime-explicit-')
    await writeFile(join(development, 'ffmpeg.exe'), 'ffmpeg')
    await writeFile(join(development, 'whisper-cli.exe'), 'whisper')
    await expect(resolveLocalRuntimePaths({
      isPackaged: false, resourcesPath: 'unused', platform: 'win32', arch: 'x64', developmentRuntimeDirectory: development,
    })).resolves.toEqual({ ffmpegPath: resolve(development, 'ffmpeg.exe'), whisperPath: resolve(development, 'whisper-cli.exe') })

    for (const arch of ['x64', 'arm64']) {
      const resources = await root(`nnote-runtime-darwin-${arch}-`)
      const owned = join(resources, 'local-runtime', `darwin-${arch}`)
      await mkdir(owned, { recursive: true })
      await writeFile(join(owned, 'ffmpeg'), 'ffmpeg')
      await writeFile(join(owned, 'whisper-cli'), 'whisper')
      await expect(resolveLocalRuntimePaths({ isPackaged: true, resourcesPath: resources, platform: 'darwin', arch }))
        .resolves.toEqual({ ffmpegPath: resolve(owned, 'ffmpeg'), whisperPath: resolve(owned, 'whisper-cli') })
    }
  })
})
