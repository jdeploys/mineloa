// Cloud transcription models cap how much audio one request may carry, and a
// meeting recorded before that cap was respected arrives as a single WebM that
// no request can hold. Opus frames are individually decodable and MediaRecorder
// emits self-contained clusters, so a recording can be cut at cluster
// boundaries and each piece replayed behind the original header without
// re-encoding — no packaged ffmpeg, which App Store builds do not ship.

const ID_SEGMENT = 0x18538067
const ID_INFO = 0x1549a966
const ID_TIMECODE_SCALE = 0x2ad7b1
const ID_CLUSTER = 0x1f43b675
const ID_TIMECODE = 0xe7
const ID_SIMPLE_BLOCK = 0xa3
const ID_BLOCK_GROUP = 0xa0

// Cluster children other than blocks and the timecode. An unknown-size cluster
// ends at the first element that cannot belong to it.
const CLUSTER_CHILDREN = new Set([
  ID_TIMECODE, ID_SIMPLE_BLOCK, ID_BLOCK_GROUP,
  0xa7 /* Position */, 0xab /* PrevSize */, 0x5854 /* SilentTracks */, 0xaf /* EncryptedBlock */,
])

const DEFAULT_TIMECODE_SCALE_NS = 1_000_000
const MAX_UINT_WIDTH = 6

export class WebmSplitError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'WebmSplitError'
  }
}

export interface WebmPart {
  bytes: Buffer
  durationMs: number
}

export interface WebmSplitOptions {
  maxDurationMs: number
  /**
   * Durable duration of the whole recording. The tail is measured from block
   * timestamps when it is absent, which under-reports trailing silence.
   */
  totalDurationMs?: number
}

interface Element {
  id: number
  contentStart: number
  contentSize: number | null
}

interface Cluster {
  start: number
  end: number
  timecodeTicks: number
  timecodeValueStart: number
  timecodeValueWidth: number
  lastBlockMs: number
}

function readVintLength(marker: number, maximum: number): number {
  for (let index = 0; index < maximum; index += 1) {
    if (marker & (0x80 >> index)) return index + 1
  }
  throw new WebmSplitError('Malformed WebM variable-length integer')
}

function readElement(buffer: Buffer, offset: number): Element {
  if (offset + 1 > buffer.length) throw new WebmSplitError('Truncated WebM element')
  const idLength = readVintLength(buffer[offset], 4)
  if (offset + idLength + 1 > buffer.length) throw new WebmSplitError('Truncated WebM element')
  let id = 0
  for (let index = 0; index < idLength; index += 1) id = id * 256 + buffer[offset + index]

  const sizeOffset = offset + idLength
  const sizeLength = readVintLength(buffer[sizeOffset], 8)
  if (sizeOffset + sizeLength > buffer.length) throw new WebmSplitError('Truncated WebM element')
  let size = buffer[sizeOffset] & (0xff >> sizeLength)
  let unknown = size === (0xff >> sizeLength)
  for (let index = 1; index < sizeLength; index += 1) {
    const byte = buffer[sizeOffset + index]
    size = size * 256 + byte
    if (byte !== 0xff) unknown = false
  }
  const contentStart = sizeOffset + sizeLength
  if (!unknown && contentStart + size > buffer.length) throw new WebmSplitError('WebM element runs past the file')
  return { id, contentStart, contentSize: unknown ? null : size }
}

function readUInt(buffer: Buffer, start: number, width: number): number {
  if (width === 0) return 0
  if (width > MAX_UINT_WIDTH) throw new WebmSplitError('WebM integer is wider than this splitter supports')
  return buffer.readUIntBE(start, width)
}

function scanCluster(buffer: Buffer, start: number, limit: number): Cluster {
  const { contentStart, contentSize } = readElement(buffer, start)
  const hardEnd = contentSize === null ? limit : contentStart + contentSize
  let offset = contentStart
  let timecodeTicks: number | null = null
  let timecodeValueStart = 0
  let timecodeValueWidth = 0
  let lastBlockTicks = 0

  while (offset < hardEnd) {
    let child: Element
    try {
      child = readElement(buffer, offset)
    } catch {
      if (contentSize === null) break
      throw new WebmSplitError('Malformed WebM cluster')
    }
    if (!CLUSTER_CHILDREN.has(child.id)) {
      if (contentSize === null) break
      throw new WebmSplitError('Unexpected element inside a sized WebM cluster')
    }
    if (child.contentSize === null) throw new WebmSplitError('Unsized element inside a WebM cluster')
    if (child.id === ID_TIMECODE) {
      timecodeTicks = readUInt(buffer, child.contentStart, child.contentSize)
      timecodeValueStart = child.contentStart
      timecodeValueWidth = child.contentSize
    }
    if (child.id === ID_SIMPLE_BLOCK) {
      // Track number vint, then a signed 16-bit offset from the cluster timecode.
      const trackLength = readVintLength(buffer[child.contentStart], 8)
      if (child.contentSize >= trackLength + 2) {
        lastBlockTicks = Math.max(lastBlockTicks, buffer.readInt16BE(child.contentStart + trackLength))
      }
    }
    offset = child.contentStart + child.contentSize
  }

  if (timecodeTicks === null) throw new WebmSplitError('WebM cluster is missing its timecode')
  return {
    start,
    end: offset,
    timecodeTicks,
    timecodeValueStart,
    timecodeValueWidth,
    lastBlockMs: lastBlockTicks,
  }
}

interface ParsedWebm {
  headerEnd: number
  timecodeScaleNs: number
  clusters: Cluster[]
}

function readTimecodeScale(buffer: Buffer, info: Element): number {
  if (info.contentSize === null) throw new WebmSplitError('Unsized WebM Info element')
  const end = info.contentStart + info.contentSize
  let offset = info.contentStart
  while (offset < end) {
    const child = readElement(buffer, offset)
    if (child.contentSize === null) throw new WebmSplitError('Unsized element inside WebM Info')
    if (child.id === ID_TIMECODE_SCALE) return readUInt(buffer, child.contentStart, child.contentSize)
    offset = child.contentStart + child.contentSize
  }
  return DEFAULT_TIMECODE_SCALE_NS
}

export function parseWebm(buffer: Buffer): ParsedWebm {
  let offset = 0
  let segmentContentStart: number | null = null
  while (offset < buffer.length && segmentContentStart === null) {
    const element = readElement(buffer, offset)
    if (element.id === ID_SEGMENT) {
      segmentContentStart = element.contentStart
      break
    }
    if (element.contentSize === null) throw new WebmSplitError('Unsized element before the WebM Segment')
    offset = element.contentStart + element.contentSize
  }
  if (segmentContentStart === null) throw new WebmSplitError('WebM Segment was not found')

  let timecodeScaleNs = DEFAULT_TIMECODE_SCALE_NS
  let headerEnd: number | null = null
  const clusters: Cluster[] = []
  offset = segmentContentStart
  while (offset < buffer.length) {
    const element = readElement(buffer, offset)
    if (element.id === ID_CLUSTER) {
      headerEnd ??= offset
      const cluster = scanCluster(buffer, offset, buffer.length)
      if (cluster.end <= offset) throw new WebmSplitError('WebM cluster made no progress')
      clusters.push(cluster)
      offset = cluster.end
      continue
    }
    // Cues and Tags may trail the clusters. They carry no audio and their
    // offsets no longer apply once a recording is cut, so they are left behind.
    if (element.id === ID_INFO && headerEnd === null) timecodeScaleNs = readTimecodeScale(buffer, element)
    if (element.contentSize === null) throw new WebmSplitError('Unsized element inside the WebM Segment')
    offset = element.contentStart + element.contentSize
  }

  if (headerEnd === null || clusters.length === 0) throw new WebmSplitError('WebM stream holds no clusters')
  if (timecodeScaleNs <= 0) throw new WebmSplitError('Invalid WebM timecode scale')
  return { headerEnd, timecodeScaleNs, clusters }
}

function rebased(buffer: Buffer, cluster: Cluster, baseTicks: number): Buffer {
  const bytes = Buffer.from(buffer.subarray(cluster.start, cluster.end))
  if (baseTicks === 0) return bytes
  const value = cluster.timecodeTicks - baseTicks
  if (value < 0) throw new WebmSplitError('WebM cluster timecodes are not ordered')
  if (cluster.timecodeValueWidth === 0) throw new WebmSplitError('WebM cluster timecode has no width to rebase into')
  // A rebased timecode is never larger than the one it replaces, so the
  // original width always holds it and every cluster keeps its byte length.
  bytes.writeUIntBE(value, cluster.timecodeValueStart - cluster.start, cluster.timecodeValueWidth)
  return bytes
}

export function splitWebmByDuration(buffer: Buffer, options: WebmSplitOptions): WebmPart[] {
  if (!Number.isFinite(options.maxDurationMs) || options.maxDurationMs <= 0) {
    throw new WebmSplitError('A positive maximum duration is required')
  }
  const { headerEnd, timecodeScaleNs, clusters } = parseWebm(buffer)
  const toMs = (ticks: number): number => (ticks * timecodeScaleNs) / 1_000_000

  let previousTicks = -1
  for (const cluster of clusters) {
    if (cluster.timecodeTicks < previousTicks) throw new WebmSplitError('WebM cluster timecodes are not ordered')
    previousTicks = cluster.timecodeTicks
  }

  const groups: Cluster[][] = []
  let current: Cluster[] = []
  let groupStartMs = 0
  for (const cluster of clusters) {
    const clusterMs = toMs(cluster.timecodeTicks)
    if (current.length > 0 && clusterMs - groupStartMs >= options.maxDurationMs) {
      groups.push(current)
      current = []
    }
    if (current.length === 0) groupStartMs = clusterMs
    current.push(cluster)
  }
  groups.push(current)

  const header = buffer.subarray(0, headerEnd)
  const measuredEndMs = toMs(clusters.at(-1)!.timecodeTicks + clusters.at(-1)!.lastBlockMs)
  const totalMs = options.totalDurationMs ?? measuredEndMs

  return groups.map((group, index) => {
    const baseTicks = group[0].timecodeTicks
    const startMs = toMs(baseTicks)
    const next = groups[index + 1]
    const endMs = next === undefined ? Math.max(totalMs, startMs) : toMs(next[0].timecodeTicks)
    return {
      bytes: Buffer.concat([header, ...group.map((cluster) => rebased(buffer, cluster, baseTicks))]),
      durationMs: endMs - startMs,
    }
  })
}
