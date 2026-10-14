import { z } from 'zod'

export interface ApiKeyStatus {
  configured: boolean
  lastValidatedAt: string | null
}

export const TranscriptionProviderIdSchema = z.enum(['openai', 'local_whisper', 'apple_speech'])
export const SummaryProviderIdSchema = z.enum(['openai', 'codex_cli', 'apple_foundation'])
export const WhisperModelIdSchema = z.enum(['base', 'small'])
export type TranscriptionProviderId = z.infer<typeof TranscriptionProviderIdSchema>
export type SummaryProviderId = z.infer<typeof SummaryProviderIdSchema>
export type WhisperModelId = z.infer<typeof WhisperModelIdSchema>

export const ProviderAvailabilitySchema = z.object({
  available: z.boolean(),
  code: z.string().nullable(),
  message: z.string().nullable(),
}).strict()
export const ProviderDescriptorSchema = z.object({
  id: z.union([TranscriptionProviderIdSchema, SummaryProviderIdSchema]),
  stage: z.enum(['transcription', 'summary']),
  displayName: z.string(),
  availability: ProviderAvailabilitySchema,
  privacy: z.enum(['audio_cloud', 'text_cloud', 'local']),
  capabilities: z.array(z.enum(['api_key', 'model_manager', 'cli_status', 'speaker_diarization'])).readonly(),
}).strict()
export type ProcessingProviderDescriptor = z.infer<typeof ProviderDescriptorSchema>
export const ProcessingProviderSettingsSchema = z.object({
  transcriptionProvider: TranscriptionProviderIdSchema,
  summaryProvider: SummaryProviderIdSchema,
  localWhisperModel: WhisperModelIdSchema,
}).strict()

export type ProcessingProviderSettings = z.infer<typeof ProcessingProviderSettingsSchema>

export const WhisperModelErrorCodeSchema = z.enum([
  'WHISPER_MODEL_DIGEST_MISMATCH',
  'WHISPER_MODEL_SIZE_MISMATCH',
  'WHISPER_MODEL_INVALID_FILE',
  'WHISPER_MODEL_NOT_INSTALLED',
  'WHISPER_MODEL_NETWORK_ERROR',
  'WHISPER_MODEL_HTTP_ERROR',
  'WHISPER_MODEL_RANGE_MISMATCH',
  'WHISPER_MODEL_STREAM_ERROR',
  'WHISPER_MODEL_FILESYSTEM_ERROR',
  'WHISPER_MODEL_BUSY',
])
export type WhisperModelErrorCode = z.infer<typeof WhisperModelErrorCodeSchema>
export const WhisperModelErrorSchema = z.object({
  code: WhisperModelErrorCodeSchema,
  message: z.string().trim().min(1).max(200),
}).strict()
export const WhisperModelStatusSchema = z.object({
  modelId: WhisperModelIdSchema,
  state: z.enum(['not_installed', 'downloading', 'installed', 'corrupt']),
  expectedBytes: z.number().int().nonnegative(),
  receivedBytes: z.number().int().nonnegative(),
  error: WhisperModelErrorSchema.nullable(),
}).strict()
export const WhisperModelProgressSchema = z.object({
  modelId: WhisperModelIdSchema,
  receivedBytes: z.number().int().nonnegative(),
  totalBytes: z.number().int().positive(),
}).strict().refine((progress) => progress.receivedBytes <= progress.totalBytes, {
  message: 'receivedBytes must not exceed totalBytes',
})
export type WhisperModelStatus = z.infer<typeof WhisperModelStatusSchema>
export type WhisperModelProgress = z.infer<typeof WhisperModelProgressSchema>

export interface SettingsApi {
  saveApiKey(value: string): Promise<void>
  getApiKeyStatus(): Promise<ApiKeyStatus>
  deleteApiKey(): Promise<void>
  getProcessingProviders(): Promise<ProcessingProviderSettings>
  updateProcessingProviders(input: ProcessingProviderSettings): Promise<ProcessingProviderSettings>
  listProcessingProviderDescriptors(): Promise<ProcessingProviderDescriptor[]>
  prepareAppleSpeech(): Promise<z.infer<typeof ProviderAvailabilitySchema>>
  listWhisperModels(): Promise<WhisperModelStatus[]>
  downloadWhisperModel(modelId: WhisperModelId): Promise<WhisperModelStatus>
  deleteWhisperModel(modelId: WhisperModelId): Promise<WhisperModelStatus>
  onWhisperModelProgress(listener: (progress: WhisperModelProgress) => void): () => void
}
