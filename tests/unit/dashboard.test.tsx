// @vitest-environment jsdom

import '@testing-library/jest-dom/vitest'
import { cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { MeetingStatus } from '../../src/shared/contracts/meeting'
import type { PublicMeeting } from '../../src/shared/contracts/meetingsApi'
import { Dashboard } from '../../src/renderer/src/features/meetings/Dashboard'

const now = '2026-07-15T00:00:00.000Z'
const meeting = (id: string, title: string, status: MeetingStatus): PublicMeeting => ({
  id, title, status, createdAt: now, updatedAt: now, durationMs: 60_000,
  audioPolicy: 'keep', hasAudio: false, audioByteCount: 0, selectedTemplateId: null,
})

describe('balanced meeting dashboard', () => {
  afterEach(cleanup)

  it('shows the recording entry and exact recent meeting statuses', () => {
    render(<Dashboard
      meetings={[meeting('done', '제품 회의', 'completed'), meeting('failed', '주간 회의', 'failed')]}
      recordingControls={{ start: vi.fn(), stop: vi.fn(), discard: vi.fn() }}
      onOpenMeeting={vi.fn()}
      onNavigate={vi.fn()}
    />)

    expect(screen.getByRole('button', { name: '녹음 시작' })).toBeInTheDocument()
    expect(screen.getByText('completed')).toBeInTheDocument()
    expect(screen.getByText('failed')).toBeInTheDocument()
    expect(screen.getByRole('navigation', { name: '주요 메뉴' })).toBeInTheDocument()
  })

  it('opens a meeting row without starting or discarding a recording', async () => {
    const user = userEvent.setup()
    const controls = { start: vi.fn(), stop: vi.fn(), discard: vi.fn() }
    const open = vi.fn()
    render(<Dashboard
      meetings={[meeting('done', '제품 회의', 'completed')]}
      recordingControls={controls}
      onOpenMeeting={open}
      onNavigate={vi.fn()}
    />)

    await user.click(screen.getByRole('button', { name: /제품 회의/ }))

    expect(open).toHaveBeenCalledWith('done')
    expect(controls.start).not.toHaveBeenCalled()
    expect(controls.discard).not.toHaveBeenCalled()
  })

  it.each([
    ['idle dashboard', [], '최근 기록이 없습니다.'],
    ['failed processing', [meeting('failed', '실패한 회의', 'failed')], 'failed'],
    ['recoverable recording', [meeting('recover', '복구할 회의', 'recoverable')], 'recoverable'],
  ])('renders the visible %s state', (_name, meetings, visible) => {
    render(<Dashboard
      meetings={meetings as PublicMeeting[]}
      recordingControls={{ start: vi.fn(), stop: vi.fn(), discard: vi.fn() }}
      onOpenMeeting={vi.fn()}
      onNavigate={vi.fn()}
    />)
    expect(screen.getByText(visible)).toBeVisible()
  })

  it('dashboard-shows-active-recording-controls', async () => {
    const user = userEvent.setup()
    render(<Dashboard meetings={[]} recordingControls={{ start: vi.fn(), stop: vi.fn(), discard: vi.fn() }} onOpenMeeting={vi.fn()} onNavigate={vi.fn()} />)
    await user.click(screen.getByRole('button', { name: '녹음 시작' }))
    expect(screen.getByText('녹음 중')).toBeVisible()
    expect(screen.getByRole('button', { name: '종료' })).toBeVisible()
    expect(screen.getByRole('button', { name: '폐기' })).toBeVisible()
  })
})
