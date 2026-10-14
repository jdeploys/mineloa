import { mkdir, mkdtemp, readdir, realpath, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { AppleSpeechTranscriptionAdapter } from '../../src/main/ai/providers/appleAdapters'
import type { AppleHelper } from '../../src/main/ai/providers/appleHelper'

const roots: string[] = []
afterEach(async () => {
  for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true })
})

function pcmWav(): Buffer {
  const samples = 16_000
  const wav = Buffer.alloc(44 + samples * 2)
  wav.write('RIFF', 0); wav.writeUInt32LE(36 + samples * 2, 4)
  wav.write('WAVEfmt ', 8); wav.writeUInt32LE(16, 16)
  wav.writeUInt16LE(1, 20); wav.writeUInt16LE(1, 22)
  wav.writeUInt32LE(16_000, 24); wav.writeUInt32LE(32_000, 28)
  wav.writeUInt16LE(2, 32); wav.writeUInt16LE(16, 34)
  wav.write('data', 36); wav.writeUInt32LE(samples * 2, 40)
  return wav
}

async function fixture(result: unknown) {
  const root = await realpath(await mkdtemp(join(tmpdir(), 'nnote-apple-adapter-test-')))
  roots.push(root)
  const recordingsRoot = join(root, 'recordings')
  const temporaryRoot = join(root, 'temporary')
  await mkdir(recordingsRoot); await mkdir(temporaryRoot)
  const input = join(recordingsRoot, 'part.webm')
  await writeFile(input, 'audio')
  const call = vi.fn(async (operation: string) => operation === 'status'
    ? { speech: { available: true }, summary: { available: true } }
    : result)
  const runProcess = vi.fn(async (request: { args: readonly string[] }) => {
    await writeFile(request.args.at(-1)!, pcmWav())
    return { status: 'success' as const, exitCode: 0 as const, stdout: '', stderr: '' }
  })
  const adapter = new AppleSpeechTranscriptionAdapter({
    helper: { call } as unknown as AppleHelper, recordingsRoot, temporaryRoot,
    resolveFfmpeg: async () => '/owned/ffmpeg', runProcess,
  })
  return { adapter, input, root, temporaryRoot, call, runProcess }
}

describe('Apple Speech adapter boundary', () => {
  it('rejects a symlinked recording without launching the converter or helper transcription', async () => {
    const h = await fixture({})
    await rm(h.input)
    await symlink(join(h.root, 'outside.webm'), h.input)
    await expect(h.adapter.transcribe({ filePath: h.input })).rejects.toMatchObject({ code: 'APPLE_SPEECH_INVALID_AUDIO' })
    expect(h.runProcess).not.toHaveBeenCalled()
    expect(h.call).toHaveBeenCalledTimes(1)
  })

  it('rejects reversed timing and removes the owned WAV task directory', async () => {
    const h = await fixture({ durationSeconds: 1, segments: [
      { speakerLabel: null, startSeconds: 0.8, endSeconds: 0.2, text: '안녕하세요' },
    ] })
    await expect(h.adapter.transcribe({ filePath: h.input })).rejects.toMatchObject({ code: 'APPLE_SPEECH_INVALID_OUTPUT' })
    expect(await readdir(h.temporaryRoot)).toEqual([])
  })
})
