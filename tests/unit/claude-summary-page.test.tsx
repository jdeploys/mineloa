// @vitest-environment jsdom

import '@testing-library/jest-dom/vitest'
import { cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { ClaudeSummaryPage } from '../../src/renderer/src/features/meetings/ClaudeSummaryPage'
import type { PublicMeeting } from '../../src/shared/contracts/meetingsApi'

const now = '2026-11-09T00:00:00.000Z'
const meeting: PublicMeeting = { id: 'meeting-1', title: '제품 회의', createdAt: now, updatedAt: now, durationMs: 1_000, status: 'completed', audioPolicy: 'keep', hasAudio: false, audioByteCount: 0, selectedTemplateId: null }

afterEach(cleanup)

describe('ClaudeSummaryPage', () => {
  it('makes a summary the first time, then remakes it on request', async () => {
    const generate = vi.fn()
      .mockResolvedValueOnce({ markdown: '# 첫 정리', createdAt: now })
      .mockRejectedValueOnce(new Error("Error invoking remote method 'claude-summary:generate': Error: 로그인이 필요합니다"))
    render(<ClaudeSummaryPage meeting={meeting} api={{ available: vi.fn(), get: vi.fn(async () => null), generate }} onBack={vi.fn()} />)

    expect(await screen.findByText('# 첫 정리')).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: '다시 만들기' }))

    expect(await screen.findByRole('alert')).toHaveTextContent('로그인이 필요합니다')
    expect(screen.getByText('# 첫 정리')).toBeInTheDocument()
    expect(generate).toHaveBeenCalledTimes(2)
  })

  it('shows a stored summary without running Claude', async () => {
    const generate = vi.fn()
    render(<ClaudeSummaryPage meeting={meeting} api={{ available: vi.fn(), get: vi.fn(async () => ({ markdown: '# 저장본', createdAt: now })), generate }} onBack={vi.fn()} />)

    expect(await screen.findByText('# 저장본')).toBeInTheDocument()
    expect(generate).not.toHaveBeenCalled()
  })
})
