import { z } from 'zod'
import type { RecoveryService } from '../recording/recoveryService'

interface RecoveryIpcMain {
  handle(channel: string, listener: (event: unknown, ...args: unknown[]) => Promise<unknown> | unknown): void
}

type RecoveryServicePort = Pick<RecoveryService, 'scan' | 'recover' | 'suspend' | 'keepAsFile' | 'exportOnly' | 'exportOnlyFormat' | 'discard'>
interface RecoveryDialog {
  showSaveDialog(options: { title: string; defaultPath: string; filters: { name: string; extensions: string[] }[] }): Promise<{ canceled: boolean; filePath?: string }>
}
const MeetingIdSchema = z.string().trim().min(1)
const ExplicitDeleteSchema = z.object({ explicitDelete: z.literal(true, { error: 'explicitDelete true is required' }) }).strict()

export function registerRecoveryHandlers(ipcMain: RecoveryIpcMain, service: RecoveryServicePort, dialog?: RecoveryDialog): void {
  ipcMain.handle('recovery:scan', () => service.scan())
  ipcMain.handle('recovery:recover', (_event, meetingId) => service.recover(MeetingIdSchema.parse(meetingId)))
  ipcMain.handle('recovery:suspend', (_event, meetingId) => service.suspend(MeetingIdSchema.parse(meetingId)))
  ipcMain.handle('recovery:keep-as-file', (_event, meetingId) => service.keepAsFile(MeetingIdSchema.parse(meetingId)))
  ipcMain.handle('recovery:export-only', async (_event, meetingId) => {
    const id = MeetingIdSchema.parse(meetingId)
    if (dialog === undefined) return { status: 'failure', code: 'EXPORT_FAILED', message: '복구 파일을 내보내지 못했습니다.' }
    try {
      const format = await service.exportOnlyFormat(id)
      const isPackage = format.extension === 'zip'
      const selected = await dialog.showSaveDialog({
        title: '복구 오디오 내보내기', defaultPath: `recovered-recording.${format.extension}`,
        filters: [isPackage
          ? { name: 'Nnote recovery package', extensions: ['zip'] }
          : { name: 'WebM audio', extensions: ['webm'] }],
      })
      if (selected.canceled || selected.filePath === undefined) return { status: 'cancelled' }
      await service.exportOnly(id, selected.filePath)
      return { status: 'success' }
    } catch {
      return { status: 'failure', code: 'EXPORT_FAILED', message: '복구 파일을 내보내지 못했습니다.' }
    }
  })
  ipcMain.handle('recovery:discard', (_event, meetingId, options) =>
    service.discard(MeetingIdSchema.parse(meetingId), ExplicitDeleteSchema.parse(options)),
  )
}
