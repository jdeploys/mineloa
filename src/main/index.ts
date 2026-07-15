import { app, BrowserWindow, dialog, ipcMain, protocol } from 'electron'
import { join } from 'node:path'
import { OpenAiKeyValidator } from './ai/openAiKeyValidator'
import { OpenAiGateway, OpenAiSummaryGateway } from './ai/openAiGateway'
import { TranscriptionService } from './ai/transcriptionService'
import { SummaryService } from './ai/summaryService'
import { ProcessingService } from './ai/processingService'
import { KeyringCredentialStore } from './credentials/keyringCredentialStore'
import { openDatabase } from './db/database'
import { MeetingRepository } from './db/meetingRepository'
import { TemplateRepository } from './db/templateRepository'
import { registerRecordingHandlers } from './ipc/registerRecordingHandlers'
import { registerRecoveryHandlers } from './ipc/registerRecoveryHandlers'
import { registerSettingsHandlers } from './ipc/registerSettingsHandlers'
import { registerTemplateHandlers } from './ipc/registerTemplateHandlers'
import { registerProcessingHandlers } from './ipc/registerProcessingHandlers'
import { RecordingService } from './recording/recordingService'
import { RecoveryService } from './recording/recoveryService'
import { createMainWindow } from './window/createMainWindow'
import { TemplateService } from './templates/templateService'
import { startSingleInstanceApp } from './app/singleInstance'
import { registerMediaProtocol } from './media/registerMediaProtocol'
import { registerMeetingHandlers } from './ipc/registerMeetingHandlers'
import { registerArchiveHandlers } from './ipc/registerArchiveHandlers'
import { reconcileImportJournals } from './archive/importMeeting'
import { bootstrapAfterImportRecovery } from './app/archiveStartup'
import { parsePackageVerificationRequest } from './app/packageVerification'
import { runPackageRuntimeVerification } from './app/runtimePackageVerification'
import { ProcessingSettingsRepository } from './settings/processingSettingsRepository'
import { OpenAiTranscriptionAdapter } from './ai/providers/openAiTranscriptionAdapter'
import { OpenAiSummaryAdapter } from './ai/providers/openAiSummaryAdapter'
import { ProviderRegistry } from './ai/providers/providerRegistry'

protocol.registerSchemesAsPrivileged([{
  scheme: 'nnote-media',
  privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true },
}])

const verificationRequest = parsePackageVerificationRequest(process.argv)

if (verificationRequest !== null) {
  app.whenReady().then(() => runPackageRuntimeVerification(verificationRequest.resultPath))
} else startSingleInstanceApp(app, BrowserWindow, () => {
  app.whenReady().then(async () => {
    const userDataDirectory = app.getPath('userData')
    const database = openDatabase(join(userDataDirectory, 'nnote.sqlite'))
    const recordingsDirectory = join(userDataDirectory, 'recordings')
    await bootstrapAfterImportRecovery({
      app, database, dialog, recordingsDirectory,
      reconcile: () => reconcileImportJournals(database, recordingsDirectory),
      start: () => {
        const meetings = new MeetingRepository(database)
        const credentialStore = new KeyringCredentialStore()
        const processingSettings = new ProcessingSettingsRepository(database)
        const registry = new ProviderRegistry(
          [new OpenAiTranscriptionAdapter(new OpenAiGateway(credentialStore))],
          [new OpenAiSummaryAdapter(new OpenAiSummaryGateway(credentialStore))],
        )
        registerSettingsHandlers(
          ipcMain,
          credentialStore,
          new OpenAiKeyValidator(),
          processingSettings,
          registry,
        )
        const recordingService = new RecordingService(meetings, recordingsDirectory)
        const templateRepository = new TemplateRepository(database)
        const templateService = new TemplateService(templateRepository)
        templateService.seedDefault()
        registerTemplateHandlers(ipcMain, templateService)
        registerRecordingHandlers(ipcMain, recordingService)
        registerRecoveryHandlers(
          ipcMain,
          new RecoveryService(new MeetingRepository(database), recordingService, recordingsDirectory),
          dialog,
        )
        const processingService = new ProcessingService(
          meetings,
          new TranscriptionService(
            meetings,
            () => registry.transcription(processingSettings.get().transcriptionProvider),
            recordingsDirectory,
          ),
          new SummaryService(
            meetings,
            templateService,
            () => registry.summary(processingSettings.get().summaryProvider),
          ),
          recordingsDirectory,
        )
        registerProcessingHandlers(ipcMain, processingService)
        registerMeetingHandlers(ipcMain, meetings, templateService)
        registerArchiveHandlers(ipcMain, dialog, meetings, templateRepository, database, recordingsDirectory)
        registerMediaProtocol(protocol, meetings, recordingsDirectory)

        createMainWindow()
        app.on('activate', () => {
          if (BrowserWindow.getAllWindows().length === 0) createMainWindow()
        })
      },
    })
  })

  app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') app.quit()
  })
})
