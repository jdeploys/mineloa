import type { SettingsApi } from './settings'
import type { RecordingApi } from './recording'
import type { RecoveryApi } from './recovery'
import type { TemplatesApi } from './template'
import type { ProcessingApi } from './processing'
import type { MeetingsApi } from './meetingsApi'
import type { ArchiveApi } from './archive'

export interface DesktopApi {
  readonly settings: SettingsApi
  readonly recording: RecordingApi
  readonly recovery: RecoveryApi
  readonly templates: TemplatesApi
  readonly processing: ProcessingApi
  readonly meetings: MeetingsApi
  readonly archive: ArchiveApi
}

declare global {
  interface Window {
    desktopApi: DesktopApi
  }
}
