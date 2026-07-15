import { z } from 'zod'
import type { RecordingService } from '../recording/recordingService'
import { RECORDING_MIME_TYPE } from '../../shared/contracts/recording'

interface RecordingIpcMain {
  handle(
    channel: string,
    listener: (event: unknown, ...args: unknown[]) => Promise<unknown> | unknown,
  ): void
}

type RecordingServicePort = Pick<
  RecordingService,
  'start' | 'cancelStart' | 'appendChunk' | 'pause' | 'resume' | 'stop' | 'discard'
> & { rollPart?(meetingId: string, partIndex: number): ReturnType<RecordingService['rollPart']> }

const MeetingIdSchema = z.string().trim().min(1)
const RecordingChunkSchema = z.object({
  meetingId: MeetingIdSchema,
  partIndex: z.number().int().nonnegative(),
  chunkIndex: z.number().int().nonnegative(),
  durationMs: z.number().int().nonnegative(),
  mimeType: z.literal(RECORDING_MIME_TYPE, { error: 'Only Opus WebM recording chunks are accepted' }),
  bytes: z.custom<Uint8Array>((value) => value instanceof Uint8Array, 'Chunk bytes must be a Uint8Array'),
})

export function registerRecordingHandlers(
  ipcMain: RecordingIpcMain,
  service: RecordingServicePort,
): void {
  ipcMain.handle('recording:start', (_event, meetingId) => service.start(MeetingIdSchema.parse(meetingId)))
  ipcMain.handle('recording:cancel-start', (_event, meetingId) => service.cancelStart(MeetingIdSchema.parse(meetingId)))
  ipcMain.handle('recording:append-chunk', async (_event, value) => {
    const { mimeType: _mimeType, ...chunk } = RecordingChunkSchema.parse(value)
    return service.appendChunk(chunk)
  })
  ipcMain.handle('recording:roll-part', (_event, meetingId, partIndex) => {
    if (service.rollPart === undefined) throw new Error('Recording part rollover is unavailable')
    return service.rollPart(MeetingIdSchema.parse(meetingId), z.number().int().nonnegative().parse(partIndex))
  })
  ipcMain.handle('recording:pause', (_event, meetingId) => service.pause(MeetingIdSchema.parse(meetingId)))
  ipcMain.handle('recording:resume', (_event, meetingId) => service.resume(MeetingIdSchema.parse(meetingId)))
  ipcMain.handle('recording:stop', (_event, meetingId) => service.stop(MeetingIdSchema.parse(meetingId)))
  ipcMain.handle('recording:discard', (_event, meetingId) => service.discard(MeetingIdSchema.parse(meetingId)))
}
