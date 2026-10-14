import type { CredentialStore } from '../credentials/credentialStore'
import type { OpenAiKeyValidator } from '../ai/openAiKeyValidator'
import type { ProcessingSettingsRepository } from '../settings/processingSettingsRepository'
import {
  ProcessingProviderSettingsSchema,
  WhisperModelIdSchema,
  type WhisperModelProgress,
  type WhisperModelStatus,
} from '../../shared/contracts/settings'
import type { ProviderDescriptor } from '../ai/providers/providerPorts'

interface SettingsIpcMain {
  handle(
    channel: string,
    listener: (event: unknown, ...args: unknown[]) => Promise<unknown> | unknown,
  ): void
}

type KeyValidator = Pick<OpenAiKeyValidator, 'validate'>
type ProcessingSettings = Pick<ProcessingSettingsRepository, 'get' | 'update'>
interface ProcessingProviders { descriptors(): Promise<ProviderDescriptor[]> }
interface WhisperModels {
  list(): Promise<WhisperModelStatus[]>
  download(modelId: 'base' | 'small'): Promise<WhisperModelStatus>
  delete(modelId: 'base' | 'small'): Promise<WhisperModelStatus>
  onProgress(listener: (progress: WhisperModelProgress) => void): () => void
}

export function registerSettingsHandlers(
  ipcMain: SettingsIpcMain,
  credentials: CredentialStore,
  validator: KeyValidator,
  processingSettings: ProcessingSettings,
  processingProviders: ProcessingProviders,
  whisperModels: WhisperModels,
  publishWhisperProgress: (progress: WhisperModelProgress) => void,
  now: () => Date = () => new Date(),
  appleSpeech?: { prepareSpeech(): Promise<{ available: boolean; code: string | null; message: string | null }> },
): void {
  let lastValidatedAt: string | null = null

  ipcMain.handle('settings:save-api-key', async (_event, value) => {
    if (typeof value !== 'string') {
      throw new Error('OpenAI API key must be a string')
    }

    await validator.validate(value)
    await credentials.set(value)
    lastValidatedAt = now().toISOString()
  })

  ipcMain.handle('settings:get-api-key-status', async () => ({
    configured: (await credentials.get()) !== null,
    lastValidatedAt,
  }))

  ipcMain.handle('settings:delete-api-key', async () => {
    await credentials.delete()
    lastValidatedAt = null
  })

  ipcMain.handle('settings:get-processing-providers', async () => processingSettings.get())

  ipcMain.handle('settings:update-processing-providers', async (_event, input) => (
    processingSettings.update(ProcessingProviderSettingsSchema.parse(input))
  ))

  ipcMain.handle('settings:list-processing-provider-descriptors', async () => (
    processingProviders.descriptors()
  ))
  ipcMain.handle('settings:prepare-apple-speech', async () => {
    if (appleSpeech === undefined || appleSpeech === null) throw new Error('Apple Speech is unavailable')
    return appleSpeech.prepareSpeech()
  })

  ipcMain.handle('settings:list-whisper-models', async () => whisperModels.list())
  ipcMain.handle('settings:download-whisper-model', async (_event, modelId) => (
    whisperModels.download(WhisperModelIdSchema.parse(modelId))
  ))
  ipcMain.handle('settings:delete-whisper-model', async (_event, modelId) => (
    whisperModels.delete(WhisperModelIdSchema.parse(modelId))
  ))
  whisperModels.onProgress(publishWhisperProgress)
}
