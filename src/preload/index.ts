import { contextBridge, ipcRenderer } from 'electron'
import type { DesktopApi } from '../shared/contracts/desktopApi'
import type { RecordingChunk } from '../shared/contracts/recording'
import type { CreateTemplateInput, UpdateTemplateInput } from '../shared/contracts/template'
import { ProcessingStatusSchema, type ProcessingStatus } from '../shared/contracts/processing'
import { RecoveryExportResultSchema } from '../shared/contracts/recovery'
import {
  CreateRecordingMeetingInputSchema,
  MeetingDocumentSchema,
  MeetingIdSchema,
  MeetingSearchInputSchema,
  MeetingTitleSchema,
  PublicMeetingSchema,
  type CreateRecordingMeetingInput,
  type MeetingSearchInput,
} from '../shared/contracts/meetingsApi'
import { SpeakerSchema } from '../shared/contracts/meeting'
import { ArchiveOperationResultSchema } from '../shared/contracts/archive'
import {
  ProcessingProviderSettingsSchema,
  ProviderDescriptorSchema,
  WhisperModelIdSchema,
  WhisperModelProgressSchema,
  WhisperModelStatusSchema,
  type ProcessingProviderSettings,
  type WhisperModelId,
  type WhisperModelProgress,
} from '../shared/contracts/settings'

const settings: DesktopApi['settings'] = Object.freeze({
  saveApiKey: (value: string) => ipcRenderer.invoke('settings:save-api-key', value),
  getApiKeyStatus: () => ipcRenderer.invoke('settings:get-api-key-status'),
  deleteApiKey: () => ipcRenderer.invoke('settings:delete-api-key'),
  getProcessingProviders: () => ipcRenderer.invoke('settings:get-processing-providers')
    .then((value) => ProcessingProviderSettingsSchema.parse(value)),
  updateProcessingProviders: (input: ProcessingProviderSettings) => ipcRenderer.invoke(
    'settings:update-processing-providers',
    ProcessingProviderSettingsSchema.parse(input),
  ).then((value) => ProcessingProviderSettingsSchema.parse(value)),
  listProcessingProviderDescriptors: () => ipcRenderer.invoke(
    'settings:list-processing-provider-descriptors',
  ).then((value) => ProviderDescriptorSchema.array().parse(value)),
  listWhisperModels: () => ipcRenderer.invoke('settings:list-whisper-models')
    .then((value) => WhisperModelStatusSchema.array().parse(value)),
  downloadWhisperModel: async (modelId: WhisperModelId) => ipcRenderer.invoke(
    'settings:download-whisper-model', WhisperModelIdSchema.parse(modelId),
  ).then((value) => WhisperModelStatusSchema.parse(value)),
  deleteWhisperModel: async (modelId: WhisperModelId) => ipcRenderer.invoke(
    'settings:delete-whisper-model', WhisperModelIdSchema.parse(modelId),
  ).then((value) => WhisperModelStatusSchema.parse(value)),
  onWhisperModelProgress: (listener: (progress: WhisperModelProgress) => void) => {
    const handler = (_event: unknown, value: unknown) => {
      const parsed = WhisperModelProgressSchema.safeParse(value)
      if (parsed.success) listener(parsed.data)
    }
    ipcRenderer.on('settings:whisper-model-progress', handler)
    return () => { ipcRenderer.removeListener('settings:whisper-model-progress', handler) }
  },
})

const recording: DesktopApi['recording'] = Object.freeze({
  start: (meetingId: string) => ipcRenderer.invoke('recording:start', meetingId),
  cancelStart: (meetingId: string) => ipcRenderer.invoke('recording:cancel-start', meetingId),
  appendChunk: (chunk: RecordingChunk) => ipcRenderer.invoke('recording:append-chunk', chunk),
  rollPart: (meetingId: string, partIndex: number) => ipcRenderer.invoke('recording:roll-part', meetingId, partIndex),
  pause: (meetingId: string) => ipcRenderer.invoke('recording:pause', meetingId),
  resume: (meetingId: string) => ipcRenderer.invoke('recording:resume', meetingId),
  stop: (meetingId: string) => ipcRenderer.invoke('recording:stop', meetingId),
  discard: (meetingId: string) => ipcRenderer.invoke('recording:discard', meetingId),
})

const recovery: DesktopApi['recovery'] = Object.freeze({
  scan: () => ipcRenderer.invoke('recovery:scan'),
  recover: (meetingId: string) => ipcRenderer.invoke('recovery:recover', meetingId),
  suspend: (meetingId: string) => ipcRenderer.invoke('recovery:suspend', meetingId),
  keepAsFile: (meetingId: string) => ipcRenderer.invoke('recovery:keep-as-file', meetingId),
  exportOnly: (meetingId: string) => ipcRenderer.invoke('recovery:export-only', meetingId)
    .then((value) => RecoveryExportResultSchema.parse(value)),
  discard: (meetingId: string, options: { explicitDelete: true }) =>
    ipcRenderer.invoke('recovery:discard', meetingId, options),
})

const templates: DesktopApi['templates'] = Object.freeze({
  list: () => ipcRenderer.invoke('templates:list'),
  create: (input: CreateTemplateInput) => ipcRenderer.invoke('templates:create', input),
  update: (id: string, input: UpdateTemplateInput) => ipcRenderer.invoke('templates:update', id, input),
  reorderSections: (id: string, orderedSectionIds: string[]) => ipcRenderer.invoke('templates:reorder-sections', id, orderedSectionIds),
  delete: (id: string) => ipcRenderer.invoke('templates:delete', id),
})

const processing: DesktopApi['processing'] = Object.freeze({
  getStatus: (meetingId: string) => ipcRenderer.invoke('processing:get-status', meetingId),
  process: (meetingId: string) => ipcRenderer.invoke('processing:process', meetingId),
  retry: (meetingId: string) => ipcRenderer.invoke('processing:retry', meetingId),
  onProgress: (listener: (status: ProcessingStatus) => void) => {
    const handler = (_event: unknown, value: unknown) => {
      const parsed = ProcessingStatusSchema.safeParse(value)
      if (parsed.success) listener(parsed.data)
    }
    ipcRenderer.on('processing:progress', handler)
    return () => { ipcRenderer.removeListener('processing:progress', handler) }
  },
})

const meetings: DesktopApi['meetings'] = Object.freeze({
  list: () => ipcRenderer.invoke('meetings:list').then((value) => PublicMeetingSchema.array().parse(value)),
  search: (input: MeetingSearchInput) => ipcRenderer.invoke(
    'meetings:search', MeetingSearchInputSchema.parse(input),
  ).then((value) => PublicMeetingSchema.array().parse(value)),
  get: (meetingId: string) => ipcRenderer.invoke('meetings:get', MeetingIdSchema.parse(meetingId)).then((value) => MeetingDocumentSchema.parse(value)),
  createRecording: (input: CreateRecordingMeetingInput) => ipcRenderer.invoke(
    'meetings:create-recording',
    CreateRecordingMeetingInputSchema.parse(input),
  ).then((value) => PublicMeetingSchema.parse(value)),
  renameMeeting: (meetingId: string, title: string) => ipcRenderer.invoke(
    'meetings:rename', MeetingIdSchema.parse(meetingId), MeetingTitleSchema.parse(title),
  ).then((value) => PublicMeetingSchema.parse(value)),
  renameSpeaker: (meetingId: string, speakerId: string, displayName: string) => ipcRenderer.invoke(
    'meetings:rename-speaker', meetingId, speakerId, displayName,
  ).then((value) => SpeakerSchema.parse(value)),
})

const archive: DesktopApi['archive'] = Object.freeze({
  exportMeeting: (meetingId: string) => ipcRenderer.invoke('archive:export-meeting', MeetingIdSchema.parse(meetingId)).then((value) => ArchiveOperationResultSchema.parse(value)),
  exportMarkdown: (meetingId: string) => ipcRenderer.invoke('archive:export-markdown', MeetingIdSchema.parse(meetingId)).then((value) => ArchiveOperationResultSchema.parse(value)),
  importMeeting: () => ipcRenderer.invoke('archive:import-meeting').then((value) => ArchiveOperationResultSchema.parse(value)),
})

const desktopApi: DesktopApi = Object.freeze({ settings, recording, recovery, templates, processing, meetings, archive })

contextBridge.exposeInMainWorld('desktopApi', desktopApi)
