import { contextBridge, ipcRenderer } from 'electron'
import type { DesktopApi } from '../shared/contracts/desktopApi'

const settings: DesktopApi['settings'] = Object.freeze({
  saveApiKey: (value: string) => ipcRenderer.invoke('settings:save-api-key', value),
  getApiKeyStatus: () => ipcRenderer.invoke('settings:get-api-key-status'),
  deleteApiKey: () => ipcRenderer.invoke('settings:delete-api-key'),
})

const desktopApi: DesktopApi = Object.freeze({ settings })

contextBridge.exposeInMainWorld('desktopApi', desktopApi)
