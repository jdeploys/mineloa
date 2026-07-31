import { describe, expect, it } from 'vitest'
import { splitWebmByDuration, WebmSplitError } from '../../src/main/media/webmSplit'

const ID_EBML = [0x1a, 0x45, 0xdf, 0xa3]
const ID_SEGMENT = [0x18, 0x53, 0x80, 0x67]
const ID_INFO = [0x15, 0x49, 0xa9, 0x66]
const ID_TIMECODE_SCALE = [0x2a, 0xd7, 0xb1]
const ID_TRACKS = [0x16, 0x54, 0xae, 0x6b]
const ID_CLUSTER = [0x1f, 0x43, 0xb6, 0x75]
const ID_TIMECODE = [0xe7]
const ID_SIMPLE_BLOCK = [0xa3]
const UNKNOWN_SIZE = [0x01, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff]

function size(byteCount: number): Buffer {
  if (byteCount > 0x7e) throw new Error('fixture sizes stay in one byte')
  return Buffer.from([0x80 | byteCount])
}

function uint(value: number, width: number): Buffer {
  const bytes = Buffer.alloc(width)
  bytes.writeUIntBE(value, 0, width)
  return bytes
}

function element(id: number[], content: Buffer): Buffer {
  return Buffer.concat([Buffer.from(id), size(content.length), content])
}

function simpleBlock(relativeMs: number): Buffer {
  const content = Buffer.alloc(5)
  content.writeUInt8(0x81, 0)
  content.writeInt16BE(relativeMs, 1)
  content.writeUInt8(0x80, 3)
  content.writeUInt8(relativeMs & 0xff, 4)
  return element(ID_SIMPLE_BLOCK, content)
}

// Chrome's MediaRecorder streams an unknown-size Segment holding unknown-size
// Clusters, so the fixture mirrors that shape rather than a remuxed file.
function cluster(timecodeMs: number, blockOffsets: readonly number[], timecodeWidth = 3): Buffer {
  return Buffer.concat([
    Buffer.from(ID_CLUSTER),
    Buffer.from(UNKNOWN_SIZE),
    element(ID_TIMECODE, uint(timecodeMs, timecodeWidth)),
    ...blockOffsets.map(simpleBlock),
  ])
}

function sizedCluster(timecodeMs: number, blockOffsets: readonly number[]): Buffer {
  const body = Buffer.concat([
    element(ID_TIMECODE, uint(timecodeMs, 3)),
    ...blockOffsets.map(simpleBlock),
  ])
  return Buffer.concat([Buffer.from(ID_CLUSTER), size(body.length), body])
}

function header(timecodeScaleNs = 1_000_000): Buffer {
  return Buffer.concat([
    element(ID_EBML, Buffer.from([0x42, 0x86, 0x81, 0x01])),
    Buffer.from(ID_SEGMENT),
    Buffer.from(UNKNOWN_SIZE),
    element(ID_INFO, element(ID_TIMECODE_SCALE, uint(timecodeScaleNs, 3))),
    element(ID_TRACKS, Buffer.from([0xae, 0x81, 0x01])),
  ])
}

function recording(timecodes: readonly number[], build = cluster): Buffer {
  return Buffer.concat([header(), ...timecodes.map((timecode) => build(timecode, [0, 500]))])
}

function vintLength(marker: number): number {
  for (let index = 0; index < 8; index += 1) if (marker & (0x80 >> index)) return index + 1
  throw new Error('invalid vint')
}

function clusterTimecodes(part: Buffer): number[] {
  const found: number[] = []
  for (let offset = 0; offset + 4 <= part.length; offset += 1) {
    if (!part.subarray(offset, offset + 4).equals(Buffer.from(ID_CLUSTER))) continue
    const bodyStart = offset + 4 + vintLength(part[offset + 4])
    if (part[bodyStart] !== ID_TIMECODE[0]) throw new Error('cluster does not lead with its timecode')
    const width = part[bodyStart + 1] & 0x7f
    found.push(part.readUIntBE(bodyStart + 2, width))
  }
  return found
}

describe('splitWebmByDuration', () => {
  it('keeps a recording that fits the limit as a single unmodified part', () => {
    const source = recording([0, 1_000, 2_000])

    const parts = splitWebmByDuration(source, { maxDurationMs: 10_000, totalDurationMs: 2_500 })

    expect(parts).toHaveLength(1)
    expect(parts[0].bytes.equals(source)).toBe(true)
    expect(parts[0].durationMs).toBe(2_500)
  })

  it('splits on cluster boundaries and rebases every part to zero', () => {
    const source = recording([0, 1_000, 2_000, 3_000, 4_000])

    const parts = splitWebmByDuration(source, { maxDurationMs: 2_000, totalDurationMs: 5_000 })

    expect(parts.map(({ durationMs }) => durationMs)).toEqual([2_000, 2_000, 1_000])
    expect(parts.map(({ bytes }) => clusterTimecodes(bytes))).toEqual([[0, 1_000], [0, 1_000], [0]])
  })

  it('reproduces the source header in every part so each one decodes alone', () => {
    const source = recording([0, 1_000, 2_000, 3_000])
    const expectedHeader = header()

    const parts = splitWebmByDuration(source, { maxDurationMs: 2_000, totalDurationMs: 4_000 })

    for (const part of parts) {
      expect(part.bytes.subarray(0, expectedHeader.length).equals(expectedHeader)).toBe(true)
    }
  })

  it('reassembles byte for byte, so no audio is dropped at a boundary', () => {
    const source = recording([0, 1_000, 2_000, 3_000, 4_000])
    const headerLength = header().length

    const parts = splitWebmByDuration(source, { maxDurationMs: 2_000, totalDurationMs: 5_000 })
    const rejoined = Buffer.concat([
      parts[0].bytes,
      ...parts.slice(1).map(({ bytes }) => bytes.subarray(headerLength)),
    ])

    expect(rejoined.length).toBe(source.length)
  })

  it('splits clusters that declare their own size', () => {
    const source = recording([0, 1_000, 2_000, 3_000], sizedCluster)

    const parts = splitWebmByDuration(source, { maxDurationMs: 2_000, totalDurationMs: 4_000 })

    expect(parts).toHaveLength(2)
    expect(parts.map(({ bytes }) => clusterTimecodes(bytes))).toEqual([[0, 1_000], [0, 1_000]])
  })

  it('rebases a wide timecode into its original byte width', () => {
    const wide = Buffer.concat([
      header(),
      cluster(0, [0], 1),
      cluster(70_000, [0], 3),
      cluster(140_000, [0], 3),
    ])

    const parts = splitWebmByDuration(wide, { maxDurationMs: 70_000, totalDurationMs: 210_000 })

    expect(parts.map(({ bytes }) => clusterTimecodes(bytes))).toEqual([[0], [0], [0]])
    expect(parts.map(({ durationMs }) => durationMs)).toEqual([70_000, 70_000, 70_000])
  })

  it('converts a non-millisecond timecode scale', () => {
    const microsecondScale = Buffer.concat([
      header(1_000),
      cluster(0, [0]),
      cluster(2_000_000, [0]),
    ])

    const parts = splitWebmByDuration(microsecondScale, { maxDurationMs: 1_000, totalDurationMs: 4_000 })

    expect(parts.map(({ durationMs }) => durationMs)).toEqual([2_000, 2_000])
  })

  it('measures the tail from block timestamps when no duration is known', () => {
    const source = recording([0, 1_000, 2_000])

    const parts = splitWebmByDuration(source, { maxDurationMs: 60_000 })

    expect(parts[0].durationMs).toBe(2_500)
  })

  it('never emits a part longer than a limit that no single cluster exceeds', () => {
    const source = recording(Array.from({ length: 30 }, (_, index) => index * 10_000))

    const parts = splitWebmByDuration(source, { maxDurationMs: 60_000, totalDurationMs: 300_000 })

    for (const part of parts) expect(part.durationMs).toBeLessThanOrEqual(60_000)
  })

  it('rejects input that is not a cluster-bearing WebM stream', () => {
    expect(() => splitWebmByDuration(Buffer.from('not webm at all'), { maxDurationMs: 1_000 }))
      .toThrow(WebmSplitError)
    expect(() => splitWebmByDuration(header(), { maxDurationMs: 1_000 })).toThrow(WebmSplitError)
  })

  it('rejects a recording whose clusters run backwards', () => {
    const source = Buffer.concat([header(), cluster(5_000, [0]), cluster(1_000, [0])])

    expect(() => splitWebmByDuration(source, { maxDurationMs: 1_000 })).toThrow(WebmSplitError)
  })
})
