import { contextBridge, ipcRenderer } from 'electron'
import type { DesktopApi } from '../shared/contracts/desktopApi'
import type { RecordingChunk } from '../shared/contracts/recording'

const settings: DesktopApi['settings'] = Object.freeze({
  saveApiKey: (value: string) => ipcRenderer.invoke('settings:save-api-key', value),
  getApiKeyStatus: () => ipcRenderer.invoke('settings:get-api-key-status'),
  deleteApiKey: () => ipcRenderer.invoke('settings:delete-api-key'),
})

const recording: DesktopApi['recording'] = Object.freeze({
  start: (meetingId: string) => ipcRenderer.invoke('recording:start', meetingId),
  appendChunk: (chunk: RecordingChunk) => ipcRenderer.invoke('recording:append-chunk', chunk),
  pause: (meetingId: string) => ipcRenderer.invoke('recording:pause', meetingId),
  resume: (meetingId: string) => ipcRenderer.invoke('recording:resume', meetingId),
  stop: (meetingId: string) => ipcRenderer.invoke('recording:stop', meetingId),
  discard: (meetingId: string) => ipcRenderer.invoke('recording:discard', meetingId),
})

const desktopApi: DesktopApi = Object.freeze({ settings, recording })

contextBridge.exposeInMainWorld('desktopApi', desktopApi)
