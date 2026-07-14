import type { SettingsApi } from './settings'
import type { RecordingApi } from './recording'

export interface DesktopApi {
  readonly settings: SettingsApi
  readonly recording: RecordingApi
}

declare global {
  interface Window {
    desktopApi: DesktopApi
  }
}
