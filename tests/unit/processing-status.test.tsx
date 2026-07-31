// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest'
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { cleanup } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { ProcessingStatus } from '../../src/renderer/src/features/meetings/ProcessingStatus'
import type { ProcessingStatus as ProcessingStatusValue } from '../../src/shared/contracts/processing'

afterEach(cleanup)

describe('ProcessingStatus', () => {
  it('shows the exact stage and disables duplicate processing while active', () => {
    render(<ProcessingStatus meetingId="m1" processing={{ getStatus: vi.fn(), process: vi.fn(), retry: vi.fn(), setAudioPolicy: vi.fn(), onProgress: vi.fn(() => () => {}) }} initialStatus={{ meetingId: 'm1', state: 'transcribing', failedStage: null, retryable: false, audioRequired: true, error: null }} />)
    expect(screen.getByText('음성을 글로 변환 중')).toBeInTheDocument()
    expect(screen.getByRole('status', { name: '처리 중' })).toBeVisible()
    expect(screen.queryByRole('button', { name: '처리 중' })).not.toBeInTheDocument()
    expect(screen.getByText('녹음된 음성을 읽을 수 있는 글로 바꾸고 있습니다.')).toBeInTheDocument()
  })

  it('shows processing immediately while the background request is pending', async () => {
    const process = vi.fn(() => new Promise<ProcessingStatusValue>(() => undefined))
    render(<ProcessingStatus meetingId="m1" processing={{ getStatus: vi.fn(), process, retry: vi.fn(), setAudioPolicy: vi.fn(), onProgress: vi.fn(() => () => {}) }} initialStatus={{ meetingId: 'm1', state: 'recorded', failedStage: null, retryable: false, audioRequired: true, error: null }} />)

    expect(screen.getByText('녹음 완료')).toBeInTheDocument()
    expect(screen.getByText('녹음이 끝났습니다. 회의록을 만들 수 있습니다.')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: '회의록 만들기' }))

    expect(await screen.findByText('회의록 생성 시작 중')).toBeInTheDocument()
    expect(screen.getByText('회의록 생성을 시작하고 있습니다.')).toBeInTheDocument()
    expect(screen.getByRole('status', { name: '처리 중' }).querySelector('.ui-icon-processing')).toBeVisible()
    expect(screen.queryByRole('button', { name: '처리 중' })).not.toBeInTheDocument()
  })

  it('shows summary retry without an audio requirement and recovers after retry errors', async () => {
    const completed = { meetingId: 'm1', state: 'completed' as const, failedStage: null, retryable: false, audioRequired: false, error: null }
    const retry = vi.fn().mockRejectedValueOnce(new Error('offline')).mockResolvedValueOnce(completed)
    render(<ProcessingStatus meetingId="m1" processing={{ getStatus: vi.fn(), process: vi.fn(), retry, setAudioPolicy: vi.fn(), onProgress: vi.fn(() => () => {}) }} initialStatus={{ meetingId: 'm1', state: 'failed', failedStage: 'summarizing', retryable: true, audioRequired: false, error: { code: 'OPENAI_NETWORK', message: '네트워크 오류' } }} />)
    expect(screen.getByRole('note', { name: '회의록 생성 상태' })).toHaveAttribute('data-tone', 'warning')
    expect(screen.getByText('회의록 작성 실패')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '회의록 작성 다시 시도' })).toHaveAttribute('data-variant', 'primary')
    expect(screen.getByRole('button', { name: '회의록 작성 다시 시도' }).querySelector('.ui-icon')).toBeVisible()
    fireEvent.click(screen.getByRole('button', { name: '회의록 작성 다시 시도' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('처리 요청을 완료하지 못했습니다.')
    fireEvent.click(screen.getByRole('button', { name: '회의록 작성 다시 시도' }))
    await waitFor(() => expect(retry).toHaveBeenCalledTimes(2))
  })

  it('renders completed state without a start action', () => {
    render(<ProcessingStatus meetingId="m1" processing={{ getStatus: vi.fn(), process: vi.fn(), retry: vi.fn(), setAudioPolicy: vi.fn(), onProgress: vi.fn(() => () => {}) }} initialStatus={{ meetingId: 'm1', state: 'completed', failedStage: null, retryable: false, audioRequired: false, error: null }} />)
    expect(screen.getByRole('note', { name: '회의록 생성 상태' })).toHaveAttribute('data-tone', 'success')
    expect(screen.getByLabelText('회의록 생성 완료').querySelector('.ui-icon')).toBeVisible()
    expect(screen.getByText('음성 변환과 회의록 작성을 모두 마쳤습니다.')).toBeInTheDocument()
    expect(screen.queryByRole('button')).not.toBeInTheDocument()
  })

  it('does not present a disabled retry action for a non-retryable failure', () => {
    render(<ProcessingStatus meetingId="m1" processing={{ getStatus: vi.fn(), process: vi.fn(), retry: vi.fn(), setAudioPolicy: vi.fn(), onProgress: vi.fn(() => () => {}) }} initialStatus={{ meetingId: 'm1', state: 'failed', failedStage: 'transcribing', retryable: false, audioRequired: true, error: { code: 'OPENAI_MALFORMED_RESPONSE', message: 'unsafe provider detail' } }} />)

    expect(screen.getByText('음성 변환 실패')).toBeInTheDocument()
    expect(screen.getByText('현재 설정으로 다시 처리할 수 없는 오류가 발생했습니다.')).toBeInTheDocument()
    expect(screen.queryByRole('button')).not.toBeInTheDocument()
    expect(screen.queryByText('unsafe provider detail')).not.toBeInTheDocument()
  })

  describe('while a stage is running', () => {
    const api = () => ({ getStatus: vi.fn(), process: vi.fn(), retry: vi.fn(), setAudioPolicy: vi.fn(), onProgress: vi.fn(() => () => {}) })
    const running = (progress: Record<string, unknown>) => ({
      meetingId: 'm1', state: 'transcribing' as const, failedStage: null, retryable: false,
      audioRequired: true, error: null,
      progress: {
        startedAt: '2026-07-31T07:30:00.000Z',
        unitStartedAt: '2026-07-31T07:30:00.000Z',
        completedUnits: 0,
        totalUnits: 2,
        pendingAudioMs: 2_053_381,
        msPerAudioMs: null,
        ...progress,
      },
    })

    afterEach(() => { vi.useRealTimers() })

    it('shows which piece is running, the elapsed time, and an estimate', () => {
      vi.useFakeTimers()
      vi.setSystemTime(Date.parse('2026-07-31T07:33:12.000Z'))

      render(<ProcessingStatus meetingId="m1" processing={api()} initialStatus={running({})} />)

      expect(screen.getByText('2개 중 1번째')).toBeInTheDocument()
      // 2053381ms of audio at the seeded 0.45x is about 15.4 minutes, less the
      // 3m12s already spent on this piece.
      expect(screen.getByText('경과 3분 12초 · 남은 시간 약 13분')).toBeInTheDocument()
    })

    it('counts down without a new status arriving', () => {
      vi.useFakeTimers()
      vi.setSystemTime(Date.parse('2026-07-31T07:30:00.000Z'))
      render(<ProcessingStatus meetingId="m1" processing={api()} initialStatus={running({})} />)

      act(() => { vi.advanceTimersByTime(60_000) })

      expect(screen.getByText('경과 1분 0초 · 남은 시간 약 15분')).toBeInTheDocument()
    })

    it('says so plainly once the estimate is spent instead of sitting at zero', () => {
      vi.useFakeTimers()
      vi.setSystemTime(Date.parse('2026-07-31T08:30:00.000Z'))

      render(<ProcessingStatus meetingId="m1" processing={api()} initialStatus={running({})} />)

      expect(screen.getByText('경과 60분 0초 · 예상보다 오래 걸리고 있습니다')).toBeInTheDocument()
    })

    // One request is the normal case for a short meeting; "1개 중 1번째" is noise.
    it('omits the piece label when the recording was not cut', () => {
      render(<ProcessingStatus meetingId="m1" processing={api()} initialStatus={running({ totalUnits: 1 })} />)

      expect(screen.queryByText(/개 중/)).not.toBeInTheDocument()
    })

    it('shows no estimate for a stage that reported none', () => {
      render(<ProcessingStatus meetingId="m1" processing={api()} initialStatus={{
        meetingId: 'm1', state: 'transcribing', failedStage: null, retryable: false, audioRequired: true, error: null,
      }} />)

      expect(screen.queryByText(/경과/)).not.toBeInTheDocument()
    })
  })

  it('names the cause when the failure has one the user can act on', () => {
    render(<ProcessingStatus meetingId="m1" processing={{ getStatus: vi.fn(), process: vi.fn(), retry: vi.fn(), setAudioPolicy: vi.fn(), onProgress: vi.fn(() => () => {}) }} initialStatus={{ meetingId: 'm1', state: 'failed', failedStage: 'transcribing', retryable: false, audioRequired: true, error: { code: 'OPENAI_AUDIO_TOO_LONG', message: 'unsafe provider detail' } }} />)

    expect(screen.getByText('녹음이 음성 변환 모델이 한 번에 받을 수 있는 길이를 넘었습니다.')).toBeInTheDocument()
    expect(screen.queryByText('현재 설정으로 다시 처리할 수 없는 오류가 발생했습니다.')).not.toBeInTheDocument()
    expect(screen.queryByText('unsafe provider detail')).not.toBeInTheDocument()
  })

  it('resets state when reused for another meeting and chooses process rather than stale retry', async () => {
    const process = vi.fn().mockResolvedValue({ meetingId: 'm2', state: 'transcribing', failedStage: null, retryable: false, audioRequired: true, error: null })
    const retry = vi.fn()
    const processing = { getStatus: vi.fn(), process, retry, setAudioPolicy: vi.fn(), onProgress: vi.fn(() => () => {}) }
    const { rerender } = render(<ProcessingStatus meetingId="m1" processing={processing} initialStatus={{ meetingId: 'm1', state: 'failed', failedStage: 'summarizing', retryable: true, audioRequired: false, error: { code: 'X', message: 'old' } }} />)
    rerender(<ProcessingStatus meetingId="m2" processing={processing} initialStatus={{ meetingId: 'm2', state: 'recorded', failedStage: null, retryable: false, audioRequired: true, error: null }} />)
    fireEvent.click(screen.getByRole('button', { name: '회의록 만들기' }))
    await waitFor(() => expect(process).toHaveBeenCalledWith('m2'))
    expect(retry).not.toHaveBeenCalled()
    expect(screen.queryByText('old')).not.toBeInTheDocument()
  })

  it('ignores a deferred request result from the previously rendered meeting', async () => {
    let resolveOld!: (value: ProcessingStatusValue) => void
    const process = vi.fn((meetingId: string): Promise<ProcessingStatusValue> => meetingId === 'm1'
      ? new Promise((resolve) => { resolveOld = resolve })
      : Promise.resolve({ meetingId: 'm2', state: 'completed', failedStage: null, retryable: false, audioRequired: false, error: null }))
    const processing = { getStatus: vi.fn(), process, retry: vi.fn(), setAudioPolicy: vi.fn(), onProgress: vi.fn(() => () => {}) }
    const { rerender } = render(<ProcessingStatus meetingId="m1" processing={processing} initialStatus={{ meetingId: 'm1', state: 'recorded', failedStage: null, retryable: false, audioRequired: true, error: null }} />)
    fireEvent.click(screen.getByRole('button', { name: '회의록 만들기' }))
    rerender(<ProcessingStatus meetingId="m2" processing={processing} initialStatus={{ meetingId: 'm2', state: 'recorded', failedStage: null, retryable: false, audioRequired: true, error: null }} />)
    resolveOld({ meetingId: 'm1', state: 'completed', failedStage: null, retryable: false, audioRequired: false, error: null })
    await waitFor(() => expect(screen.getByText('녹음 완료')).toBeInTheDocument())
    expect(screen.getByRole('button', { name: '회의록 만들기' })).toBeEnabled()
  })
})
