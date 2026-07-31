import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { createWebmAudioChunker } from '../../src/main/ai/audioChunker'
import { parseWebm } from '../../src/main/media/webmSplit'

const directories: string[] = []

afterEach(() => {
  for (const directory of directories.splice(0)) rmSync(directory, { recursive: true, force: true })
})

function root(): string {
  const created = mkdtempSync(join(tmpdir(), 'nnote-chunker-'))
  directories.push(created)
  return created
}

// Minimal MediaRecorder-shaped stream: unknown-size Segment, one cluster per second.
function recording(seconds: number): Buffer {
  const header = Buffer.concat([
    Buffer.from([0x1a, 0x45, 0xdf, 0xa3, 0x84, 0x42, 0x86, 0x81, 0x01]),
    Buffer.from([0x18, 0x53, 0x80, 0x67]),
    Buffer.from([0x01, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff]),
    Buffer.from([0x15, 0x49, 0xa9, 0x66, 0x87, 0x2a, 0xd7, 0xb1, 0x83, 0x0f, 0x42, 0x40]),
  ])
  const clusters = Array.from({ length: seconds }, (_unused, index) => {
    const timecode = Buffer.alloc(3)
    timecode.writeUIntBE(index * 1_000, 0, 3)
    return Buffer.concat([
      Buffer.from([0x1f, 0x43, 0xb6, 0x75]),
      Buffer.from([0x01, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff]),
      Buffer.from([0xe7, 0x83]), timecode,
      Buffer.from([0xa3, 0x85, 0x81, 0x00, 0x00, 0x80, index & 0xff]),
    ])
  })
  return Buffer.concat([header, ...clusters])
}

describe('createWebmAudioChunker', () => {
  it('hands back a part that already fits without writing anything', async () => {
    const directory = root()
    const filePath = join(directory, 'part-0.webm')
    writeFileSync(filePath, recording(30))

    const set = await createWebmAudioChunker(directory).chunk({
      filePath, durationSeconds: 30, maxDurationSeconds: 60,
    })

    expect(set.chunks).toEqual([{ filePath, durationSeconds: 30 }])
    expect(readdirSync(directory)).toEqual(['part-0.webm'])
    await set.dispose()
  })

  it('cuts an over-long part into playable pieces whose durations sum to the original', async () => {
    const directory = root()
    const filePath = join(directory, 'part-0.webm')
    writeFileSync(filePath, recording(100))

    const set = await createWebmAudioChunker(directory).chunk({
      filePath, durationSeconds: 100, maxDurationSeconds: 40,
    })

    expect(set.chunks).toHaveLength(3)
    expect(set.chunks.reduce((total, chunk) => total + chunk.durationSeconds!, 0)).toBeCloseTo(100)
    for (const chunk of set.chunks) {
      expect(chunk.durationSeconds!).toBeLessThanOrEqual(40)
      expect(parseWebm(readFileSync(chunk.filePath)).clusters[0].timecodeTicks).toBe(0)
    }
    await set.dispose()
  })

  it('removes its temporary directory on dispose and leaves the recording in place', async () => {
    const directory = root()
    const filePath = join(directory, 'part-0.webm')
    writeFileSync(filePath, recording(100))

    const set = await createWebmAudioChunker(directory).chunk({
      filePath, durationSeconds: 100, maxDurationSeconds: 40,
    })
    const chunkDirectory = dirname(set.chunks[0].filePath)
    await set.dispose()

    expect(existsSync(chunkDirectory)).toBe(false)
    expect(existsSync(filePath)).toBe(true)
  })

  it('measures a part whose duration is unknown rather than sending it whole', async () => {
    const directory = root()
    const filePath = join(directory, 'part-0.webm')
    writeFileSync(filePath, recording(100))

    const set = await createWebmAudioChunker(directory).chunk({ filePath, maxDurationSeconds: 40 })

    expect(set.chunks.length).toBeGreaterThan(1)
    await set.dispose()
  })
})
