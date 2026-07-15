import type { CredentialStore } from '../credentials/credentialStore'
import type { OpenAiKeyValidator } from '../ai/openAiKeyValidator'

interface SettingsIpcMain {
  handle(
    channel: string,
    listener: (event: unknown, ...args: unknown[]) => Promise<unknown> | unknown,
  ): void
}

type KeyValidator = Pick<OpenAiKeyValidator, 'validate'>

export function registerSettingsHandlers(
  ipcMain: SettingsIpcMain,
  credentials: CredentialStore,
  validator: KeyValidator,
  now: () => Date = () => new Date(),
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
}
