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
import { createMainWindow, reopenMainWindow } from './window/createMainWindow'
import { installApplicationMenu } from './window/applicationMenu'
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
import { CodexCliSummaryAdapter } from './ai/providers/codexCliSummaryAdapter'
import { createCodexCommandResolver } from './ai/providers/codexCommandResolver'
import { runOwnedProcess } from './process/runOwnedProcess'
import { WhisperModelManager } from './localModels/whisperModelManager'
import { publishWhisperProgressToLiveWindows } from './window/publishWhisperProgress'
import { LocalWhisperTranscriptionAdapter } from './ai/providers/localWhisperTranscriptionAdapter'
import { resolveLocalRuntimePaths } from './localRuntime/runtimePaths'
import {
  legacyUserDataDirectory,
  shouldUseLegacyUserDataDirectory,
} from './app/userDataCompatibility'

protocol.registerSchemesAsPrivileged([{
  scheme: 'nnote-media',
  privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true },
}])

const verificationRequest = parsePackageVerificationRequest(process.argv)
const applicationName = 'Mineloa'

if (verificationRequest !== null) {
  app.whenReady().then(() => runPackageRuntimeVerification(verificationRequest.resultPath))
} else {
  if (shouldUseLegacyUserDataDirectory(process.argv)) {
    app.setPath('userData', legacyUserDataDirectory(app.getPath('appData')))
  }
  startSingleInstanceApp(app, BrowserWindow, () => {
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
        const processingSettings = new ProcessingSettingsRepository(database, {
          codexCliEnabled: !process.mas,
          localWhisperEnabled: !process.mas,
        })
        const whisperModels = new WhisperModelManager(join(userDataDirectory, 'models', 'whisper'))
        const registry = new ProviderRegistry(
          [
            new OpenAiTranscriptionAdapter(new OpenAiGateway(credentialStore)),
            ...(!process.mas ? [new LocalWhisperTranscriptionAdapter({
              resolveRuntimePaths: () => resolveLocalRuntimePaths({
                isPackaged: app.isPackaged,
                resourcesPath: process.resourcesPath,
                platform: process.platform,
                arch: process.arch,
                developmentRuntimeDirectory: process.env.NNOTE_LOCAL_RUNTIME_DIR,
                developmentProjectDirectory: app.getAppPath(),
              }),
              verifiedModelPath: (model) => whisperModels.verifiedPath(model),
              resolveModel: () => processingSettings.get().localWhisperModel,
              recordingsRoot: recordingsDirectory,
              temporaryRoot: app.getPath('temp'),
              runProcess: runOwnedProcess,
            })] : []),
          ],
          [
            new OpenAiSummaryAdapter(new OpenAiSummaryGateway(credentialStore)),
            ...(!process.mas ? [
              new CodexCliSummaryAdapter(
                runOwnedProcess,
                app.getPath('temp'),
                createCodexCommandResolver(),
              ),
            ] : []),
          ],
        )
        registerSettingsHandlers(
          ipcMain,
          credentialStore,
          new OpenAiKeyValidator(),
          processingSettings,
          registry,
          whisperModels,
          (progress) => publishWhisperProgressToLiveWindows(BrowserWindow.getAllWindows(), progress),
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

        installApplicationMenu(applicationName, process.platform === 'darwin', () => {
          reopenMainWindow()
        })
        createMainWindow()
        app.on('activate', () => {
          reopenMainWindow()
        })
      },
    })
  })

  app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') app.quit()
  })
  })
}
