export interface ApiKeyStatus {
  configured: boolean
  lastValidatedAt: string | null
}

export interface SettingsApi {
  saveApiKey(value: string): Promise<void>
  getApiKeyStatus(): Promise<ApiKeyStatus>
  deleteApiKey(): Promise<void>
}
