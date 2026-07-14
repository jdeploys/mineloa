import { app, BrowserWindow, ipcMain } from 'electron'
import { join } from 'node:path'
import { OpenAiKeyValidator } from './ai/openAiKeyValidator'
import { KeyringCredentialStore } from './credentials/keyringCredentialStore'
import { openDatabase } from './db/database'
import { MeetingRepository } from './db/meetingRepository'
import { registerRecordingHandlers } from './ipc/registerRecordingHandlers'
import { registerSettingsHandlers } from './ipc/registerSettingsHandlers'
import { RecordingService } from './recording/recordingService'
import { createMainWindow } from './window/createMainWindow'

registerSettingsHandlers(ipcMain, new KeyringCredentialStore(), new OpenAiKeyValidator())

app.whenReady().then(() => {
  const userDataDirectory = app.getPath('userData')
  const database = openDatabase(join(userDataDirectory, 'nnote.sqlite'))
  const recordingService = new RecordingService(
    new MeetingRepository(database),
    join(userDataDirectory, 'recordings'),
  )
  registerRecordingHandlers(ipcMain, recordingService)

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
