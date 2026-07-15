// @vitest-environment jsdom

import '@testing-library/jest-dom/vitest'
import { cleanup, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { DesktopApi } from '../../src/shared/contracts/desktopApi'
import type { MeetingDocument, PublicMeeting } from '../../src/shared/contracts/meetingsApi'
import { App } from '../../src/renderer/src/App'
import { RecordingTerminalError } from '../../src/renderer/src/features/recording/mediaRecorderController'

const now = '2026-07-15T00:00:00.000Z'
const meeting: PublicMeeting = { id: 'meeting-1', title: '제품 회의', createdAt: now, updatedAt: now, durationMs: 1_000, status: 'completed', audioPolicy: 'keep', hasAudio: false, audioByteCount: 0, selectedTemplateId: null }
const documentFixture: MeetingDocument = { meeting, audioUrl: null, speakers: [], transcript: [], summarySections: [], actionItems: [] }

function api(overrides: Partial<DesktopApi['meetings']> = {}): DesktopApi {
  return {
    recovery: { scan: vi.fn(async () => []), recover: vi.fn(), suspend: vi.fn(), keepAsFile: vi.fn(), exportOnly: vi.fn(), discard: vi.fn() },
    meetings: {
      list: vi.fn(async () => [meeting]), get: vi.fn(async () => documentFixture),
      createRecording: vi.fn(async () => ({ ...meeting, id: 'recording-1', title: '새 회의', status: 'recording' })),
      renameSpeaker: vi.fn(),
      ...overrides,
    } as DesktopApi['meetings'],
    settings: { getApiKeyStatus: vi.fn(async () => ({ configured: false, lastValidatedAt: null })), saveApiKey: vi.fn(), deleteApiKey: vi.fn() },
    templates: { list: vi.fn(async () => [{ id: 'default', name: '기본', isDefault: true, sections: [{ id: '10000000-0000-4000-8000-000000000001', title: '요약', kind: 'paragraph', prompt: '요약' }], createdAt: now, updatedAt: now }]), create: vi.fn(), update: vi.fn(), reorderSections: vi.fn(), delete: vi.fn() },
    recording: {
      start: vi.fn(), cancelStart: vi.fn(async () => undefined), appendChunk: vi.fn(), pause: vi.fn(),
      resume: vi.fn(), stop: vi.fn(), discard: vi.fn(),
    } as DesktopApi['recording'],
    processing: { getStatus: vi.fn(async (meetingId) => ({ meetingId, state: 'completed', failedStage: null, retryable: false, audioRequired: false, error: null })), process: vi.fn(), retry: vi.fn(), onProgress: vi.fn(() => () => {}) },
    archive: { exportMeeting: vi.fn(), exportMarkdown: vi.fn(), importMeeting: vi.fn(async () => ({ status: 'cancelled' as const })) },
  } as unknown as DesktopApi
}

describe('App route and recording ownership', () => {
  afterEach(cleanup)

  it('preserves active recording controls and identity across settings navigation without discard or a second start', async () => {
    const user = userEvent.setup()
    const desktopApi = api()
    const controller = { start: vi.fn(async () => undefined), stop: vi.fn(async () => undefined), discard: vi.fn(async () => undefined) }
    render(<App desktopApi={desktopApi} recordingController={controller} />)
    await screen.findByRole('button', { name: '녹음 시작' })
    await user.click(screen.getByRole('button', { name: '녹음 시작' }))
    await user.click(screen.getByRole('button', { name: '설정' }))
    await user.click(screen.getByRole('button', { name: '← 전체 기록' }))

    await user.click(screen.getByRole('button', { name: '요약 템플릿' }))
    await user.click(screen.getByRole('button', { name: '← 전체 기록' }))
    await user.click(screen.getByRole('button', { name: /제품 회의/ }))
    await user.click(await screen.findByRole('button', { name: '← 전체 기록' }))

    expect(screen.getByText('녹음 중')).toBeVisible()
    expect(screen.queryByRole('button', { name: '녹음 시작' })).not.toBeInTheDocument()
    expect(controller.start).toHaveBeenCalledTimes(1)
    expect(controller.start).toHaveBeenCalledWith('recording-1')
    expect(desktopApi.meetings.createRecording).toHaveBeenCalledWith(expect.objectContaining({
      selectedTemplateId: 'default',
    }))
    expect(controller.discard).not.toHaveBeenCalled()
  })

  it('removes an empty meeting created for a failed capture start and keeps the failure visible', async () => {
    const user = userEvent.setup()
    const desktopApi = api()
    const controller = { start: vi.fn(async () => { throw new Error('마이크 거부') }), stop: vi.fn(), discard: vi.fn() }
    render(<App desktopApi={desktopApi} recordingController={controller} />)
    await user.click(await screen.findByRole('button', { name: '녹음 시작' }))

    expect(await screen.findByRole('alert')).toHaveTextContent('마이크 거부')
    expect(desktopApi.recording.cancelStart).toHaveBeenCalledWith('recording-1')
    expect(controller.discard).not.toHaveBeenCalled()
    await user.click(screen.getByRole('button', { name: '설정' }))
    await user.click(screen.getByRole('button', { name: '← 전체 기록' }))
    expect(screen.getByRole('alert')).toHaveTextContent('마이크 거부')
  })

  it('keeps a non-pristine failed start for explicit discard', async () => {
    const user = userEvent.setup()
    const desktopApi = api()
    const controller = {
      start: vi.fn(async () => { throw new RecordingTerminalError('capture_failed', 'rollback refused') }),
      stop: vi.fn(), discard: vi.fn(async () => undefined),
    }
    render(<App desktopApi={desktopApi} recordingController={controller} />)

    await user.click(await screen.findByRole('button', { name: '녹음 시작' }))

    expect(await screen.findByRole('alert')).toHaveTextContent('rollback refused')
    expect(desktopApi.recording.cancelStart).not.toHaveBeenCalled()
    await user.click(screen.getByRole('button', { name: '폐기' }))
    await user.click(screen.getByRole('button', { name: '녹음 폐기 확인' }))
    expect(controller.discard).toHaveBeenCalledOnce()
  })

  it('restores focus to the recording panel settings button after back', async () => {
    const user = userEvent.setup()
    render(<App desktopApi={api()} recordingController={{ start: vi.fn(), stop: vi.fn(), discard: vi.fn() }} />)
    const recordingSettings = await screen.findByRole('button', { name: '설정으로 이동' })

    await user.click(recordingSettings)
    await user.click(screen.getByRole('button', { name: '← 전체 기록' }))

    await waitFor(() => expect(screen.getByRole('button', { name: '설정으로 이동' })).toHaveFocus())
  })

  it('focuses route headings and restores the originating meeting row on back', async () => {
    const user = userEvent.setup()
    render(<App desktopApi={api()} recordingController={{ start: vi.fn(), stop: vi.fn(), discard: vi.fn() }} />)
    const row = await screen.findByRole('button', { name: /제품 회의/ })
    await user.click(row)
    expect(await screen.findByRole('heading', { name: '제품 회의' })).toHaveFocus()
    await user.click(screen.getByRole('button', { name: '← 전체 기록' }))
    await waitFor(() => expect(screen.getByRole('button', { name: /제품 회의/ })).toHaveFocus())
  })

  it('focuses settings and template route headings', async () => {
    const user = userEvent.setup()
    render(<App desktopApi={api()} recordingController={{ start: vi.fn(), stop: vi.fn(), discard: vi.fn() }} />)
    await user.click(await screen.findByRole('button', { name: '설정' }))
    expect(screen.getByRole('heading', { name: '설정' })).toHaveFocus()
    await user.click(screen.getByRole('button', { name: '← 전체 기록' }))
    await user.click(screen.getByRole('button', { name: '요약 템플릿' }))
    expect(screen.getByRole('heading', { name: '요약 템플릿' })).toHaveFocus()
  })

  it('reaches recorded-to-processing from detail and refreshes the completed document', async () => {
    const user = userEvent.setup()
    const recorded = { ...meeting, status: 'recorded' as const }
    const recordedDocument = { ...documentFixture, meeting: recorded }
    const desktopApi = api({ list: vi.fn(async () => [recorded]), get: vi.fn(async () => recordedDocument) })
    vi.mocked(desktopApi.processing.getStatus).mockResolvedValue({ meetingId: recorded.id, state: 'recorded', failedStage: null, retryable: false, audioRequired: true, error: null })
    vi.mocked(desktopApi.processing.process).mockResolvedValue({ meetingId: recorded.id, state: 'completed', failedStage: null, retryable: false, audioRequired: false, error: null })
    render(<App desktopApi={desktopApi} recordingController={{ start: vi.fn(), stop: vi.fn(), discard: vi.fn() }} />)

    await user.click(await screen.findByRole('button', { name: /제품 회의/ }))
    await user.click(await screen.findByRole('button', { name: '전사 및 요약 시작' }))
    expect(desktopApi.processing.process).toHaveBeenCalledWith('meeting-1')
    await waitFor(() => expect(desktopApi.meetings.get).toHaveBeenCalledTimes(2))
    expect(screen.getByRole('button', { name: '.nnote 내보내기' })).toBeVisible()
    expect(screen.getByRole('button', { name: 'Markdown 내보내기' })).toBeVisible()
  })

  it('imports a .nnote from the dashboard and opens the imported meeting', async () => {
    const user = userEvent.setup()
    const imported = { ...meeting, id: 'imported-1', title: '가져온 회의' }
    const desktopApi = api({ get: vi.fn(async () => ({ ...documentFixture, meeting: imported })) })
    vi.mocked(desktopApi.archive.importMeeting).mockResolvedValue({ status: 'success', meetingId: imported.id, includedAudio: true, audioCoverage: 'all-parts' })
    render(<App desktopApi={desktopApi} recordingController={{ start: vi.fn(), stop: vi.fn(), discard: vi.fn() }} />)
    await user.click(await screen.findByRole('button', { name: '.nnote 가져오기' }))
    expect(await screen.findByRole('heading', { name: '가져온 회의' })).toBeVisible()
    expect(desktopApi.meetings.get).toHaveBeenCalledWith('imported-1')
  })

  it('keeps the dashboard functional and offers retry or dismissal after an invalid archive import', async () => {
    const user = userEvent.setup()
    const desktopApi = api()
    vi.mocked(desktopApi.archive.importMeeting)
      .mockResolvedValueOnce({ status: 'failure', code: 'INVALID_ARCHIVE', message: '올바른 NNote 파일이 아닙니다.' })
      .mockResolvedValueOnce({ status: 'cancelled' })
    render(<App desktopApi={desktopApi} recordingController={{ start: vi.fn(), stop: vi.fn(), discard: vi.fn() }} />)

    await user.click(await screen.findByRole('button', { name: '.nnote 가져오기' }))

    expect(await screen.findByRole('alert')).toHaveTextContent('올바른 NNote 파일이 아닙니다.')
    expect(screen.getByRole('button', { name: '녹음 시작' })).toBeVisible()
    expect(screen.getByRole('button', { name: /제품 회의/ })).toBeVisible()
    await user.click(screen.getByRole('button', { name: '가져오기 다시 시도' }))
    expect(desktopApi.archive.importMeeting).toHaveBeenCalledTimes(2)
    expect(screen.queryByText('올바른 NNote 파일이 아닙니다.')).not.toBeInTheDocument()

    vi.mocked(desktopApi.archive.importMeeting).mockResolvedValueOnce({ status: 'failure', code: 'INVALID_ARCHIVE', message: '다시 실패했습니다.' })
    await user.click(screen.getByRole('button', { name: '.nnote 가져오기' }))
    expect(await screen.findByText('다시 실패했습니다.')).toBeVisible()
    await user.click(screen.getByRole('button', { name: '알림 닫기' }))
    expect(screen.queryByText('다시 실패했습니다.')).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: '녹음 시작' })).toBeVisible()
  })

  it('keeps a recovery startup failure as a fatal screen', async () => {
    const desktopApi = api()
    vi.mocked(desktopApi.recovery.scan).mockRejectedValue(new Error('복구 인덱스 손상'))
    render(<App desktopApi={desktopApi} recordingController={{ start: vi.fn(), stop: vi.fn(), discard: vi.fn() }} />)

    expect(await screen.findByRole('alert')).toHaveTextContent('복구 또는 기록 확인에 실패했습니다. 새 녹음을 시작하지 않았습니다: 복구 인덱스 손상')
    expect(screen.queryByRole('button', { name: '녹음 시작' })).not.toBeInTheDocument()
  })

  it('rolls back a failed renderer recovery attachment and allows coherent retry', async () => {
    const user = userEvent.setup()
    const desktopApi = api()
    vi.mocked(desktopApi.recovery.scan).mockResolvedValue([{ meetingId: 'recover-1', createdAt: now, durationMs: 1_000, byteCount: 3, kind: 'recoverable' }])
    vi.mocked(desktopApi.recovery.recover).mockResolvedValue({ totalBytes: 3, durationMs: 1_000, warn: false, rollRequired: false, rolledToPartIndex: 1, activePartIndex: 1, nextChunkIndex: 0 })
    const controller = {
      start: vi.fn(), stop: vi.fn(), discard: vi.fn(),
      resumeRecovered: vi.fn().mockRejectedValueOnce(new Error('microphone denied')).mockResolvedValueOnce(undefined),
      subscribe: vi.fn((listener) => { listener({ phase: 'recording', meetingId: 'recover-1', durationMs: 1_000, totalBytes: 3, warn: false, activePartIndex: 1, partCount: 2, microphone: 'active', localSave: 'saved' }); return () => undefined }),
    }
    render(<App desktopApi={desktopApi} recordingController={controller as never} />)
    await user.click(await screen.findByRole('button', { name: '복구' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('microphone denied')
    expect(desktopApi.recovery.suspend).toHaveBeenCalledWith('recover-1')
    await user.click(screen.getByRole('button', { name: '복구' }))
    await waitFor(() => expect(controller.resumeRecovered).toHaveBeenCalledTimes(2))
    expect(await screen.findByText('녹음 중')).toBeVisible()
  })
})
