// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { cleanup } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { ProcessingStatus } from '../../src/renderer/src/features/meetings/ProcessingStatus'
import type { ProcessingStatus as ProcessingStatusValue } from '../../src/shared/contracts/processing'

afterEach(cleanup)

describe('ProcessingStatus', () => {
  it('shows the exact stage and disables duplicate processing while active', () => {
    render(<ProcessingStatus meetingId="m1" processing={{ getStatus: vi.fn(), process: vi.fn(), retry: vi.fn(), onProgress: vi.fn(() => () => {}) }} initialStatus={{ meetingId: 'm1', state: 'transcribing', failedStage: null, retryable: false, audioRequired: true, error: null }} />)
    expect(screen.getByText('전사 중')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '처리 중' })).toBeDisabled()
    expect(screen.getByText('원본 오디오 필요')).toBeInTheDocument()
  })

  it('shows summary retry without an audio requirement and recovers after retry errors', async () => {
    const completed = { meetingId: 'm1', state: 'completed' as const, failedStage: null, retryable: false, audioRequired: false, error: null }
    const retry = vi.fn().mockRejectedValueOnce(new Error('offline')).mockResolvedValueOnce(completed)
    render(<ProcessingStatus meetingId="m1" processing={{ getStatus: vi.fn(), process: vi.fn(), retry, onProgress: vi.fn(() => () => {}) }} initialStatus={{ meetingId: 'm1', state: 'failed', failedStage: 'summarizing', retryable: true, audioRequired: false, error: { code: 'OPENAI_NETWORK', message: '네트워크 오류' } }} />)
    expect(screen.getByText('요약 실패')).toBeInTheDocument()
    expect(screen.getByText('원본 오디오 불필요')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: '요약 다시 시도' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('offline')
    fireEvent.click(screen.getByRole('button', { name: '요약 다시 시도' }))
    await waitFor(() => expect(retry).toHaveBeenCalledTimes(2))
  })

  it('renders completed state without a start action', () => {
    render(<ProcessingStatus meetingId="m1" processing={{ getStatus: vi.fn(), process: vi.fn(), retry: vi.fn(), onProgress: vi.fn(() => () => {}) }} initialStatus={{ meetingId: 'm1', state: 'completed', failedStage: null, retryable: false, audioRequired: false, error: null }} />)
    expect(screen.getByText('처리 완료')).toBeInTheDocument()
    expect(screen.queryByRole('button')).not.toBeInTheDocument()
  })

  it('resets state when reused for another meeting and chooses process rather than stale retry', async () => {
    const process = vi.fn().mockResolvedValue({ meetingId: 'm2', state: 'transcribing', failedStage: null, retryable: false, audioRequired: true, error: null })
    const retry = vi.fn()
    const processing = { getStatus: vi.fn(), process, retry, onProgress: vi.fn(() => () => {}) }
    const { rerender } = render(<ProcessingStatus meetingId="m1" processing={processing} initialStatus={{ meetingId: 'm1', state: 'failed', failedStage: 'summarizing', retryable: true, audioRequired: false, error: { code: 'X', message: 'old' } }} />)
    rerender(<ProcessingStatus meetingId="m2" processing={processing} initialStatus={{ meetingId: 'm2', state: 'recorded', failedStage: null, retryable: false, audioRequired: true, error: null }} />)
    fireEvent.click(screen.getByRole('button', { name: '전사 및 요약 시작' }))
    await waitFor(() => expect(process).toHaveBeenCalledWith('m2'))
    expect(retry).not.toHaveBeenCalled()
    expect(screen.queryByText('old')).not.toBeInTheDocument()
  })

  it('ignores a deferred request result from the previously rendered meeting', async () => {
    let resolveOld!: (value: ProcessingStatusValue) => void
    const process = vi.fn((meetingId: string): Promise<ProcessingStatusValue> => meetingId === 'm1'
      ? new Promise((resolve) => { resolveOld = resolve })
      : Promise.resolve({ meetingId: 'm2', state: 'completed', failedStage: null, retryable: false, audioRequired: false, error: null }))
    const processing = { getStatus: vi.fn(), process, retry: vi.fn(), onProgress: vi.fn(() => () => {}) }
    const { rerender } = render(<ProcessingStatus meetingId="m1" processing={processing} initialStatus={{ meetingId: 'm1', state: 'recorded', failedStage: null, retryable: false, audioRequired: true, error: null }} />)
    fireEvent.click(screen.getByRole('button', { name: '전사 및 요약 시작' }))
    rerender(<ProcessingStatus meetingId="m2" processing={processing} initialStatus={{ meetingId: 'm2', state: 'recorded', failedStage: null, retryable: false, audioRequired: true, error: null }} />)
    resolveOld({ meetingId: 'm1', state: 'completed', failedStage: null, retryable: false, audioRequired: false, error: null })
    await waitFor(() => expect(screen.getByText('처리 대기')).toBeInTheDocument())
    expect(screen.getByRole('button', { name: '전사 및 요약 시작' })).toBeEnabled()
  })
})
