import { createReadStream } from 'node:fs'
import OpenAI from 'openai'
import { z } from 'zod'
import type { CredentialStore } from '../credentials/credentialStore'
import { safeOpenAiError, toOpenAiError, toSummaryOpenAiError } from './openAiErrors'

export interface TranscriptionRequest {
  filePath: string
  model: 'gpt-4o-transcribe-diarize'
  responseFormat: 'diarized_json'
  chunkingStrategy: 'auto'
}

export interface ProviderTranscriptSegment {
  speaker: string
  startSeconds: number
  endSeconds: number
  text: string
}

export interface ProviderTranscription {
  durationSeconds: number
  segments: ProviderTranscriptSegment[]
}

export interface OpenAiGatewayPort {
  transcribe(request: TranscriptionRequest): Promise<ProviderTranscription>
}

export interface OpenAiTranscriptionClient {
  audio: { transcriptions: { create(input: unknown): Promise<unknown> } }
}

export type OpenAiTranscriptionClientFactory = (apiKey: string) => OpenAiTranscriptionClient

const createClient: OpenAiTranscriptionClientFactory = (apiKey) => new OpenAI({ apiKey })

const responseSchema = z.object({
  duration: z.number().finite().nonnegative(),
  segments: z.array(
    z.object({
      speaker: z.string().min(1),
      start: z.number().finite().nonnegative(),
      end: z.number().finite().nonnegative(),
      text: z.string(),
    }),
  ),
})

export class OpenAiGateway implements OpenAiGatewayPort {
  constructor(
    private readonly credentials: CredentialStore,
    private readonly clientFactory: OpenAiTranscriptionClientFactory = createClient,
  ) {}

  async transcribe(request: TranscriptionRequest): Promise<ProviderTranscription> {
    const apiKey = await this.credentials.get()
    if (apiKey === null) {
      throw safeOpenAiError('OPENAI_API_KEY_MISSING')
    }

    let response: unknown
    try {
      response = await this.clientFactory(apiKey).audio.transcriptions.create({
        file: createReadStream(request.filePath),
        model: request.model,
        response_format: request.responseFormat,
        chunking_strategy: request.chunkingStrategy,
      })
    } catch (error) {
      throw toOpenAiError(error)
    }
    const parsed = responseSchema.safeParse(response)
    if (!parsed.success) {
      throw safeOpenAiError('OPENAI_MALFORMED_RESPONSE')
    }

    let previousStart = 0
    for (const segment of parsed.data.segments) {
      if (
        segment.end < segment.start ||
        segment.start < previousStart ||
        segment.end > parsed.data.duration + 0.001
      ) {
        throw safeOpenAiError('OPENAI_MALFORMED_RESPONSE')
      }
      previousStart = segment.start
    }
    return {
      durationSeconds: parsed.data.duration,
      segments: parsed.data.segments.map((segment) => ({
        speaker: segment.speaker,
        startSeconds: segment.start,
        endSeconds: segment.end,
        text: segment.text,
      })),
    }
  }
}

export interface SummaryRequest {
  input: string
  schema: { [key: string]: unknown }
}

export interface OpenAiSummaryGatewayPort {
  summarize(request: SummaryRequest): Promise<string>
}

export interface OpenAiResponsesClient {
  responses: { create(input: unknown): Promise<unknown> }
}

export type OpenAiResponsesClientFactory = (apiKey: string) => OpenAiResponsesClient

const createResponsesClient: OpenAiResponsesClientFactory = (apiKey) => new OpenAI({ apiKey })

const responsesResultSchema = z.object({
  status: z.string(),
  output_text: z.string(),
  output: z.array(z.unknown()),
}).passthrough()

function containsRefusal(value: unknown): boolean {
  if (Array.isArray(value)) return value.some(containsRefusal)
  if (typeof value !== 'object' || value === null) return false
  if ('type' in value && value.type === 'refusal') return true
  return Object.values(value).some(containsRefusal)
}

export class OpenAiSummaryGateway implements OpenAiSummaryGatewayPort {
  constructor(
    private readonly credentials: CredentialStore,
    private readonly clientFactory: OpenAiResponsesClientFactory = createResponsesClient,
  ) {}

  async summarize(request: SummaryRequest): Promise<string> {
    const apiKey = await this.credentials.get()
    if (apiKey === null) throw safeOpenAiError('OPENAI_API_KEY_MISSING')
    let response: unknown
    try {
      response = await this.clientFactory(apiKey).responses.create({
        model: 'gpt-5-mini',
        input: request.input,
        text: {
          format: {
            type: 'json_schema',
            name: 'nnote_meeting_summary',
            strict: true,
            schema: request.schema,
          },
        },
      })
    } catch (error) {
      throw toSummaryOpenAiError(error)
    }
    const parsed = responsesResultSchema.safeParse(response)
    if (!parsed.success) throw safeOpenAiError('OPENAI_MALFORMED_SUMMARY')
    if (containsRefusal(parsed.data.output)) throw safeOpenAiError('OPENAI_SUMMARY_REFUSED')
    if (parsed.data.status !== 'completed') throw safeOpenAiError('OPENAI_SUMMARY_INCOMPLETE')
    if (parsed.data.output_text.trim().length === 0) throw safeOpenAiError('OPENAI_MALFORMED_SUMMARY')
    return parsed.data.output_text
  }
}
