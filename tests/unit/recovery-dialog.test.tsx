// @vitest-environment jsdom

import '@testing-library/jest-dom/vitest'
import { cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { RecoveryDialog } from '../../src/renderer/src/features/recording/RecoveryDialog'
import { App } from '../../src/renderer/src/App'
import type { DesktopApi } from '../../src/shared/contracts/desktopApi'

const item = {
  meetingId: 'meeting-1',
  createdAt: '2026-07-14T12:00:00.000Z',
  durationMs: 65_000,
  byteCount: 1_024,
  kind: 'recoverable' as const,
}

describe('RecoveryDialog', () => {
  afterEach(cleanup)

  it('blocks normal recording while recovery decisions remain and resolves a recovery choice', async () => {
    const user = userEvent.setup()
    const recovery = { recover: vi.fn(async () => undefined), keepAsFile: vi.fn(), discard: vi.fn() }
    const resolved = vi.fn()
    render(<RecoveryDialog items={[item]} recovery={recovery} onResolved={resolved} />)

    expect(screen.getByRole('dialog', { name: '중단된 녹음 복구' })).toHaveAttribute('aria-modal', 'true')
    expect(screen.getByText('1분 5초')).toBeInTheDocument()
    expect(screen.getByText('1 KB')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: '복구' }))

    expect(recovery.recover).toHaveBeenCalledWith('meeting-1')
    expect(resolved).toHaveBeenCalledOnce()
  })

  it('confirms discard, cancels without deletion, and only discard is destructive', async () => {
    const user = userEvent.setup()
    const recovery = { recover: vi.fn(), keepAsFile: vi.fn(), discard: vi.fn(async () => undefined) }
    render(<RecoveryDialog items={[item]} recovery={recovery} onResolved={vi.fn()} />)

    expect(screen.getByRole('button', { name: '폐기' })).toHaveAttribute('data-destructive', 'true')
    expect(screen.getByRole('button', { name: '폐기' })).toHaveStyle({ backgroundColor: '#b42318', color: '#ffffff' })
    expect(screen.getByRole('button', { name: '복구' })).not.toHaveAttribute('data-destructive')
    await user.click(screen.getByRole('button', { name: '폐기' }))
    expect(screen.getByRole('button', { name: '복구' })).toBeDisabled()
    expect(screen.getByRole('button', { name: '현재 파일로 보관' })).toBeDisabled()
    expect(screen.getByRole('button', { name: '폐기' })).toBeDisabled()
    await user.click(screen.getByRole('button', { name: '복구' }))
    expect(recovery.recover).not.toHaveBeenCalled()
    await user.click(screen.getByRole('button', { name: '취소' }))
    expect(recovery.discard).not.toHaveBeenCalled()

    await user.click(screen.getByRole('button', { name: '폐기' }))
    await user.click(screen.getByRole('button', { name: '영구 폐기 확인' }))
    expect(recovery.discard).toHaveBeenCalledWith('meeting-1', { explicitDelete: true })
  })

  it('offers keep but not resume for a finalization-only stop crash', () => {
    render(<RecoveryDialog items={[{ ...item, kind: 'finalizeOnly' as const }]} recovery={{ recover: vi.fn(), keepAsFile: vi.fn(), discard: vi.fn() }} onResolved={vi.fn()} />)

    expect(screen.queryByRole('button', { name: '복구' })).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: '현재 파일로 보관' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '폐기' })).toBeInTheDocument()
  })

  it('shows corrupt recovery as export-only and keeps destructive discard behind confirmation', () => {
    render(<RecoveryDialog items={[{ ...item, kind: 'exportOnly' }]} recovery={{ recover: vi.fn(), keepAsFile: vi.fn(), discard: vi.fn() }} onResolved={vi.fn()} />)

    expect(screen.getByText(/내보내기 전용/)).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: '복구' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: '현재 파일로 보관' })).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: '폐기' })).toBeInTheDocument()
  })

  it('does not render the normal app until every startup recovery decision resolves', async () => {
    const user = userEvent.setup()
    const recovery = {
      scan: vi.fn(async () => [item]),
      recover: vi.fn(async () => ({ totalBytes: 1_024, durationMs: 65_000, warn: false, rolledToPartIndex: null, activePartIndex: 0, nextChunkIndex: 1 })),
      suspend: vi.fn(), exportOnly: vi.fn(),
      keepAsFile: vi.fn(),
      discard: vi.fn(),
    }
    Object.defineProperty(window, 'desktopApi', {
      configurable: true,
      value: { recovery } as unknown as DesktopApi,
    })

    render(<App recordingController={{ start: vi.fn(), stop: vi.fn(), discard: vi.fn(), resumeRecovered: vi.fn(async () => undefined) }} />)
    expect(await screen.findByRole('dialog', { name: '중단된 녹음 복구' })).toBeInTheDocument()
    expect(document.querySelector('main')).not.toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: '복구' }))
    expect(await screen.findByRole('main')).toHaveTextContent('Nnote')
  })
})
