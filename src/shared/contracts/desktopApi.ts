import type { SettingsApi } from './settings'

export interface DesktopApi {
  readonly settings: SettingsApi
}

declare global {
  interface Window {
    desktopApi: DesktopApi
  }
}
