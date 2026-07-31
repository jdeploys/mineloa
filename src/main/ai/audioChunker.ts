import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { splitWebmByDuration } from '../media/webmSplit'

export interface AudioChunk {
  filePath: string
  durationSeconds?: number
}

export interface AudioChunkSet {
  chunks: AudioChunk[]
  dispose(): Promise<void>
}

export interface AudioChunkRequest {
  filePath: string
  durationSeconds?: number
  maxDurationSeconds: number
}

export interface AudioChunker {
  chunk(request: AudioChunkRequest): Promise<AudioChunkSet>
}

async function passThrough(request: AudioChunkRequest): Promise<AudioChunkSet> {
  return {
    chunks: [request.durationSeconds === undefined
      ? { filePath: request.filePath }
      : { filePath: request.filePath, durationSeconds: request.durationSeconds }],
    dispose: async () => { /* nothing was written */ },
  }
}

/**
 * Cuts a recording part into pieces a transcription provider will accept.
 * The pieces live in a temporary directory the caller disposes of; a part that
 * already fits is handed back untouched so the common path copies nothing.
 */
export function createWebmAudioChunker(temporaryRoot: string): AudioChunker {
  return {
    async chunk(request: AudioChunkRequest): Promise<AudioChunkSet> {
      if (
        request.durationSeconds !== undefined
        && request.durationSeconds <= request.maxDurationSeconds
      ) {
        return passThrough(request)
      }
      const source = await readFile(request.filePath)
      const parts = splitWebmByDuration(source, {
        maxDurationMs: request.maxDurationSeconds * 1_000,
        ...(request.durationSeconds === undefined
          ? {}
          : { totalDurationMs: request.durationSeconds * 1_000 }),
      })
      if (parts.length === 1) return passThrough(request)

      const directory = await mkdtemp(join(temporaryRoot, 'nnote-audio-chunk-'))
      try {
        const chunks: AudioChunk[] = []
        for (const [index, part] of parts.entries()) {
          const filePath = join(directory, `part-${index}.webm`)
          await writeFile(filePath, part.bytes)
          chunks.push({ filePath, durationSeconds: part.durationMs / 1_000 })
        }
        return { chunks, dispose: () => rm(directory, { recursive: true, force: true }) }
      } catch (error) {
        await rm(directory, { recursive: true, force: true })
        throw error
      }
    },
  }
}
