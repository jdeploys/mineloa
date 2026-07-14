import { app, BrowserWindow, ipcMain } from 'electron'
import { OpenAiKeyValidator } from './ai/openAiKeyValidator'
import { KeyringCredentialStore } from './credentials/keyringCredentialStore'
import { registerSettingsHandlers } from './ipc/registerSettingsHandlers'
import { createMainWindow } from './window/createMainWindow'

registerSettingsHandlers(ipcMain, new KeyringCredentialStore(), new OpenAiKeyValidator())

app.whenReady().then(() => {
  createMainWindow()

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createMainWindow()
    }
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit()
  }
})
