// @vitest-environment jsdom

import '@testing-library/jest-dom/vitest'
import { cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { RecordingPanel } from '../../src/renderer/src/features/recording/RecordingPanel'

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
})
