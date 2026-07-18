import type { OpenAiGatewayPort } from '../openAiGateway'
import { toOpenAiError } from '../openAiErrors'
import { toProviderError } from './providerErrors'
import type {
  NormalizedTranscription,
  ProviderAvailability,
  ProviderDescriptor,
  TranscriptionProvider,
  TranscriptionProviderRequest,
} from './providerPorts'

const available: ProviderAvailability = { available: true, code: null, message: null }

export class OpenAiTranscriptionAdapter implements TranscriptionProvider {
  readonly id = 'openai' as const

  constructor(private readonly gateway: OpenAiGatewayPort) {}

  async availability(): Promise<ProviderAvailability> {
    return available
  }

  async descriptor(): Promise<ProviderDescriptor> {
    return {
      id: this.id,
      stage: 'transcription',
      displayName: 'OpenAI',
      availability: await this.availability(),
      privacy: 'audio_cloud',
      capabilities: ['api_key', 'speaker_diarization'],
    }
  }

  async transcribe(request: TranscriptionProviderRequest): Promise<NormalizedTranscription> {
    try {
      const response = await this.gateway.transcribe({
        filePath: request.filePath,
        ...(request.recordingDurationSeconds === undefined
          ? {}
          : { recordingDurationSeconds: request.recordingDurationSeconds }),
        model: 'gpt-4o-transcribe-diarize',
        responseFormat: 'diarized_json',
        chunkingStrategy: 'auto',
      })
      return {
        durationSeconds: response.durationSeconds,
        segments: response.segments.map((segment) => ({
          speakerLabel: segment.speaker,
          startSeconds: segment.startSeconds,
          endSeconds: segment.endSeconds,
          text: segment.text,
        })),
      }
    } catch (error) {
      throw toProviderError(toOpenAiError(error))
    }
  }
}
