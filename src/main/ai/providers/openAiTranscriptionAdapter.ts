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

// gpt-4o-transcribe-diarize refuses any upload past 1400 seconds with a 400,
// and `chunking_strategy: 'auto'` only chunks server side once the file is
// already accepted. Stop well short so the last cluster of a cut part, which
// can overshoot the target by one cluster, still lands under the ceiling.
const MAX_AUDIO_DURATION_SECONDS = 20 * 60

export class OpenAiTranscriptionAdapter implements TranscriptionProvider {
  readonly id = 'openai' as const
  readonly maxAudioDurationSeconds = MAX_AUDIO_DURATION_SECONDS

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
        // Matches the `-l ko` the local Whisper adapter already pins.
        language: 'ko',
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
