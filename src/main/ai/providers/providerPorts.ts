import type {
  SummaryProviderId,
  TranscriptionProviderId,
} from '../../../shared/contracts/settings'
import type { TemplateSectionKind } from '../../../shared/contracts/template'

export interface ProviderAvailability {
  available: boolean
  code: string | null
  message: string | null
}

export interface ProviderDescriptor {
  id: TranscriptionProviderId | SummaryProviderId
  stage: 'transcription' | 'summary'
  displayName: string
  availability: ProviderAvailability
  privacy: 'audio_cloud' | 'text_cloud' | 'local'
  capabilities: readonly ('api_key' | 'model_manager' | 'cli_status' | 'speaker_diarization')[]
}

export interface TranscriptionProviderRequest {
  filePath: string
  recordingDurationSeconds?: number
}

export interface NormalizedTranscriptSegment {
  speakerLabel: string | null
  startSeconds: number
  endSeconds: number
  text: string
}

export interface NormalizedTranscription {
  durationSeconds: number
  segments: NormalizedTranscriptSegment[]
}

export interface SummaryRequest {
  input: string
  schema: { [key: string]: unknown }
  context?: {
    sections: Array<{ id: string; title: string; kind: TemplateSectionKind; prompt: string }>
    transcript: Array<{ sourceIndex: number; speakerId: string | null; text: string }>
    speakerIds: string[]
  }
}

export interface TranscriptionProvider {
  readonly id: TranscriptionProviderId
  /**
   * Longest recording this provider accepts in one request. A part longer than
   * this is cut before it is sent; leaving it unset means no ceiling applies.
   */
  readonly maxAudioDurationSeconds?: number
  descriptor(): Promise<ProviderDescriptor>
  availability(): Promise<ProviderAvailability>
  transcribe(request: TranscriptionProviderRequest): Promise<NormalizedTranscription>
}

export interface SummaryProvider {
  readonly id: SummaryProviderId
  descriptor(): Promise<ProviderDescriptor>
  availability(): Promise<ProviderAvailability>
  summarize(request: SummaryRequest): Promise<string>
}
