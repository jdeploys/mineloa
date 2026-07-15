// @vitest-environment jsdom

import '@testing-library/jest-dom/vitest'
import { cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { RecordingPanel } from '../../src/renderer/src/features/recording/RecordingPanel'
import { RecordingTerminalError } from '../../src/renderer/src/features/recording/mediaRecorderController'

describe('RecordingPanel', () => {
  afterEach(cleanup)

  it('commits on stop while navigation preserves the recording', async () => {
    const user = userEvent.setup()
    const controls = {
      start: vi.fn(async () => undefined),
      stop: vi.fn(async () => undefined),
      discard: vi.fn(async () => undefined),
    }
    const navigate = vi.fn()
    render(<RecordingPanel controls={controls} onNavigate={navigate} />)

    await user.click(screen.getByRole('button', { name: '녹음 시작' }))
    await user.click(screen.getByRole('button', { name: '설정으로 이동' }))

    expect(navigate).toHaveBeenCalledWith('settings')
    expect(controls.discard).not.toHaveBeenCalled()

    await user.click(screen.getByRole('button', { name: '종료' }))
    expect(controls.stop).toHaveBeenCalledOnce()
    expect(controls.discard).not.toHaveBeenCalled()
  })

  it('discards only after explicit confirmation and preserves on cancellation', async () => {
    const user = userEvent.setup()
    const controls = {
      start: vi.fn(async () => undefined),
      stop: vi.fn(async () => undefined),
      discard: vi.fn(async () => undefined),
    }
    render(<RecordingPanel controls={controls} onNavigate={vi.fn()} />)
    await user.click(screen.getByRole('button', { name: '녹음 시작' }))

    await user.click(screen.getByRole('button', { name: '폐기' }))
    expect(screen.getByRole('dialog')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: '취소' }))
    expect(controls.discard).not.toHaveBeenCalled()

    await user.click(screen.getByRole('button', { name: '폐기' }))
    await user.click(screen.getByRole('button', { name: '녹음 폐기 확인' }))
    expect(controls.discard).toHaveBeenCalledOnce()
  })

  it('shows stopped pending state and retries Main stop without claiming to still record', async () => {
    const user = userEvent.setup()
    const controls = {
      start: vi.fn(async () => undefined),
      stop: vi
        .fn()
        .mockRejectedValueOnce(new RecordingTerminalError('stop_failed', 'database busy'))
        .mockResolvedValueOnce(undefined),
      discard: vi.fn(async () => undefined),
    }
    render(<RecordingPanel controls={controls} onNavigate={vi.fn()} />)
    await user.click(screen.getByRole('button', { name: '녹음 시작' }))
    await user.click(screen.getByRole('button', { name: '종료' }))

    expect(await screen.findByText('녹음은 중지되었지만 저장 완료를 기다리고 있습니다.')).toBeInTheDocument()
    expect(screen.queryByText('녹음 중')).not.toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: '종료 재시도' }))

    expect(controls.stop).toHaveBeenCalledTimes(2)
    expect(screen.getByRole('button', { name: '녹음 시작' })).toBeInTheDocument()
  })

  it('shows discard retry after confirmed discard fails and never reports recording', async () => {
    const user = userEvent.setup()
    const controls = {
      start: vi.fn(async () => undefined),
      stop: vi.fn(async () => undefined),
      discard: vi
        .fn()
        .mockRejectedValueOnce(new RecordingTerminalError('discard_failed', 'database busy'))
        .mockResolvedValueOnce(undefined),
    }
    render(<RecordingPanel controls={controls} onNavigate={vi.fn()} />)
    await user.click(screen.getByRole('button', { name: '녹음 시작' }))
    await user.click(screen.getByRole('button', { name: '폐기' }))
    await user.click(screen.getByRole('button', { name: '녹음 폐기 확인' }))

    expect(await screen.findByText('녹음은 중지되었지만 폐기를 완료하지 못했습니다.')).toBeInTheDocument()
    expect(screen.queryByText('녹음 중')).not.toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: '폐기 재시도' }))

    expect(controls.discard).toHaveBeenCalledTimes(2)
    expect(screen.getByRole('button', { name: '녹음 시작' })).toBeInTheDocument()
  })

  it('offers explicit discard when start rollback cannot safely remove the recording', async () => {
    const user = userEvent.setup()
    const controls = {
      start: vi.fn(async () => {
        throw new RecordingTerminalError('capture_failed', 'start rollback refused')
      }),
      stop: vi.fn(),
      discard: vi.fn(async () => undefined),
    }
    render(<RecordingPanel controls={controls} onNavigate={vi.fn()} />)

    await user.click(screen.getByRole('button', { name: '녹음 시작' }))

    expect(await screen.findByText('녹음은 중지되었지만 저장 완료를 기다리고 있습니다.')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: '녹음 시작' })).not.toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: '폐기' }))
    await user.click(screen.getByRole('button', { name: '녹음 폐기 확인' }))
    expect(controls.discard).toHaveBeenCalledOnce()
  })

  it('selects a summary template and retention policy and shows authoritative recording telemetry', async () => {
    const user = userEvent.setup()
    let listener: ((value: unknown) => void) | undefined
    const controls = {
      start: vi.fn(async () => undefined), stop: vi.fn(async () => undefined), discard: vi.fn(async () => undefined),
      pause: vi.fn(async () => undefined), resume: vi.fn(async () => undefined),
      subscribe: vi.fn((next: (value: unknown) => void) => { listener = next; return () => undefined }),
    }
    const templates = {
      list: vi.fn(async () => [
        { id: 'default', name: '기본', isDefault: true, sections: [{ id: '10000000-0000-4000-8000-000000000001', title: '요약', kind: 'paragraph' as const, prompt: '요약' }], createdAt: '2026-07-14T00:00:00.000Z', updatedAt: '2026-07-14T00:00:00.000Z' },
        { id: 'custom', name: '주간 회의', isDefault: false, sections: [{ id: '20000000-0000-4000-8000-000000000001', title: '결론', kind: 'bullet_list' as const, prompt: '결론' }], createdAt: '2026-07-14T00:00:00.000Z', updatedAt: '2026-07-14T00:00:00.000Z' },
      ]), create: vi.fn(), update: vi.fn(), reorderSections: vi.fn(), delete: vi.fn(),
    }
    render(<RecordingPanel controls={controls as never} templates={templates} onNavigate={vi.fn()} />)
    await user.selectOptions(await screen.findByLabelText('요약 템플릿'), 'custom')
    await user.selectOptions(screen.getByLabelText('원본 오디오'), 'keep')
    await user.click(screen.getByRole('button', { name: '녹음 시작' }))
    expect(controls.start).toHaveBeenCalledWith({ selectedTemplateId: 'custom', audioPolicy: 'keep' })

    listener?.({ phase: 'recording', meetingId: 'm1', durationMs: 65_000, totalBytes: 23 * 1024 * 1024, warn: true, activePartIndex: 1, partCount: 2, microphone: 'active', localSave: 'saved' })
    expect(await screen.findByText('1:05')).toBeInTheDocument()
    expect(screen.getByText('22 MiB를 넘어 새 파트 전환을 준비합니다.')).toBeInTheDocument()
    expect(screen.getByText('마이크 연결됨')).toBeInTheDocument()
    expect(screen.getByText('로컬 저장 완료')).toBeInTheDocument()
    expect(screen.getByText('파트 2')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: '일시정지' }))
    expect(controls.pause).toHaveBeenCalledOnce()
  })
})
