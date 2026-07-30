import { mkdtempSync, rmSync, writeFileSync, type ReadStream } from 'node:fs'
import { createServer, type Server } from 'node:http'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Agent, fetch as undiciFetch } from 'undici'
import { afterEach, describe, expect, it } from 'vitest'
import {
  OpenAiGateway,
  OPENAI_SOCKET_TIMEOUTS,
  transcriptionTimeoutMs,
  type OpenAiRequestOptions,
  type OpenAiTranscriptionClient,
  type TranscriptionRequest,
} from '../../src/main/ai/openAiGateway'
import type { CredentialStore } from '../../src/main/credentials/credentialStore'

const directories: string[] = []

const credentials: CredentialStore = {
  get: async () => 'sk-test',
  set: async () => {},
  delete: async () => {},
}

function audioFile(): string {
  const root = mkdtempSync(join(tmpdir(), 'nnote-gateway-'))
  directories.push(root)
  const path = join(root, 'meeting.webm')
  writeFileSync(path, 'audio')
  return path
}

function recordingClient(): { client: OpenAiTranscriptionClient; options: OpenAiRequestOptions[] } {
  const options: OpenAiRequestOptions[] = []
  const client: OpenAiTranscriptionClient = {
    audio: {
      transcriptions: {
        create: async (input, requestOptions) => {
          // The gateway hands over a lazily opened read stream. Nothing here
          // consumes it, so close it before the temporary directory is removed.
          const { file } = input as { file: ReadStream }
          file.on('error', () => {})
          file.destroy()
          if (requestOptions !== undefined) options.push(requestOptions)
          return { duration: 60, segments: [] }
        },
      },
    },
  }
  return { client, options }
}

function request(filePath: string, recordingDurationSeconds?: number): TranscriptionRequest {
  return {
    filePath,
    ...(recordingDurationSeconds === undefined ? {} : { recordingDurationSeconds }),
    model: 'gpt-4o-transcribe-diarize',
    responseFormat: 'diarized_json',
    chunkingStrategy: 'auto',
  }
}

afterEach(() => {
  for (const directory of directories.splice(0)) rmSync(directory, { recursive: true, force: true })
})

describe('transcriptionTimeoutMs', () => {
  it('holds a floor above the ten minute openai-node default for short audio', () => {
    expect(transcriptionTimeoutMs(30)).toBe(15 * 60 * 1_000)
    expect(transcriptionTimeoutMs(0)).toBe(15 * 60 * 1_000)
  })

  it('falls back to the floor when the recording duration is unknown', () => {
    expect(transcriptionTimeoutMs(undefined)).toBe(15 * 60 * 1_000)
    expect(transcriptionTimeoutMs(Number.NaN)).toBe(15 * 60 * 1_000)
  })

  it('scales past the floor so a long recording outlives the server-side work', () => {
    // A nineteen minute meeting previously aborted at the ten minute default.
    expect(transcriptionTimeoutMs(1_162)).toBe(2_324_000)
    expect(transcriptionTimeoutMs(1_162)).toBeGreaterThan(10 * 60 * 1_000)
  })

  it('caps the budget at an hour', () => {
    expect(transcriptionTimeoutMs(99_999)).toBe(60 * 60 * 1_000)
  })
})

describe('OPENAI_SOCKET_TIMEOUTS', () => {
  // A five minute socket ceiling under the SDK killed long transcriptions at
  // 300s regardless of the request budget. Pin the semantics we rely on: these
  // values must mean "wait indefinitely", not "give up immediately".
  async function delayedHeaderServer(delayMs: number): Promise<{ url: string; close(): Promise<void> }> {
    const server: Server = createServer((_request, response) => {
      setTimeout(() => {
        response.writeHead(200, { 'content-type': 'text/plain' })
        response.end('ok')
      }, delayMs)
    })
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
    const address = server.address()
    if (address === null || typeof address === 'string') throw new Error('no port')
    return {
      url: `http://127.0.0.1:${address.port}/`,
      close: () => new Promise<void>((resolve) => server.close(() => resolve())),
    }
  }

  it('waits past a socket deadline that would otherwise abort the request', async () => {
    const server = await delayedHeaderServer(1_500)
    const dispatcher = new Agent(OPENAI_SOCKET_TIMEOUTS)
    try {
      const response = await undiciFetch(server.url, { dispatcher })
      expect(response.status).toBe(200)
    } finally {
      await dispatcher.close()
      await server.close()
    }
  })

  it('fails the same request when a short header deadline is in force', async () => {
    const server = await delayedHeaderServer(1_500)
    const dispatcher = new Agent({ headersTimeout: 500, bodyTimeout: 500 })
    try {
      await expect(undiciFetch(server.url, { dispatcher })).rejects.toThrow()
    } finally {
      await dispatcher.close()
      await server.close()
    }
  })
})

describe('OpenAiGateway transcription request options', () => {
  it('sends a duration-scaled timeout and no retries', async () => {
    const { client, options } = recordingClient()
    const gateway = new OpenAiGateway(credentials, () => client)

    await gateway.transcribe(request(audioFile(), 1_162))

    expect(options).toHaveLength(1)
    expect(options[0]).toEqual({ timeout: 2_324_000, maxRetries: 0 })
  })

  it('still sends the floor timeout when the duration is unknown', async () => {
    const { client, options } = recordingClient()
    const gateway = new OpenAiGateway(credentials, () => client)

    await gateway.transcribe(request(audioFile()))

    expect(options[0]).toEqual({ timeout: 15 * 60 * 1_000, maxRetries: 0 })
  })
})
