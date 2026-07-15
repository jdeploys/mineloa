import { z } from 'zod'
import type { ProcessingService } from '../ai/processingService'
import { ProcessingStatusSchema } from '../../shared/contracts/processing'

interface ProcessingSender {
  isDestroyed(): boolean
  send(channel: string, value: unknown): void
  once(event: 'destroyed', listener: () => void): void
}
interface ProcessingEvent { sender: ProcessingSender }
interface ProcessingIpcMain {
  handle(channel: string, listener: (event: ProcessingEvent, ...args: unknown[]) => unknown): void
}
type ProcessingPort = Pick<ProcessingService, 'process' | 'retry' | 'getStatus' | 'subscribe'>
const MeetingIdSchema = z.string().trim().min(1).max(200).regex(/^[\p{L}\p{N}._:-]+$/u)

export function registerProcessingHandlers(ipcMain: ProcessingIpcMain, service: ProcessingPort): () => void {
  const scopes = new Map<ProcessingSender, Set<string>>()
  const scope = (sender: ProcessingSender, rawMeetingId: unknown): string => {
    const meetingId = MeetingIdSchema.parse(rawMeetingId)
    let meetingIds = scopes.get(sender)
    if (meetingIds === undefined) {
      meetingIds = new Set()
      scopes.set(sender, meetingIds)
      sender.once('destroyed', () => scopes.delete(sender))
    }
    meetingIds.add(meetingId)
    return meetingId
  }

  ipcMain.handle('processing:get-status', (event, meetingId) => service.getStatus(scope(event.sender, meetingId)))
  ipcMain.handle('processing:process', (event, meetingId) => service.process(scope(event.sender, meetingId)))
  ipcMain.handle('processing:retry', (event, meetingId) => service.retry(scope(event.sender, meetingId)))

  return service.subscribe((value) => {
    const status = ProcessingStatusSchema.parse(value)
    for (const [sender, meetingIds] of scopes) {
      if (!meetingIds.has(status.meetingId)) continue
      if (sender.isDestroyed()) {
        scopes.delete(sender)
        continue
      }
      try {
        sender.send('processing:progress', status)
      } catch {
        scopes.delete(sender)
      }
    }
  })
}
