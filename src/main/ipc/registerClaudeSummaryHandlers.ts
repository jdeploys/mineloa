import { MeetingIdSchema } from '../../shared/contracts/meetingsApi'
import type { ClaudeSummaryService } from '../ai/claudeSummaryService'

interface ClaudeSummaryIpcMain {
  handle(channel: string, listener: (event: unknown, ...args: unknown[]) => unknown): void
}

export function registerClaudeSummaryHandlers(
  ipcMain: ClaudeSummaryIpcMain,
  service: Pick<ClaudeSummaryService, 'available' | 'get' | 'generate'> | null,
): void {
  ipcMain.handle('claude-summary:available', async () => service !== null && service.available())
  ipcMain.handle('claude-summary:get', async (_event, rawMeetingId) => service?.get(MeetingIdSchema.parse(rawMeetingId)) ?? null)
  ipcMain.handle('claude-summary:generate', async (_event, rawMeetingId) => {
    if (service === null) throw new Error('Claude 요약본은 이 환경에서 쓸 수 없습니다.')
    return service.generate(MeetingIdSchema.parse(rawMeetingId))
  })
}
