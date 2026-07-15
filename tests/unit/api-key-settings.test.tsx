// @vitest-environment jsdom

import '@testing-library/jest-dom/vitest'
import { act, cleanup, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { DesktopApi } from '../../src/shared/contracts/desktopApi'
import { ApiKeySettings } from '../../src/renderer/src/features/settings/ApiKeySettings'

describe('API key settings', () => {
  afterEach(cleanup)

  beforeEach(() => {
    vi.resetModules()
  })

  it('keeps the saved key hidden from the desktop API while the settings copy changes', async () => {
    let exposedApi: DesktopApi | undefined
    vi.doMock('electron', () => ({
      contextBridge: {
        exposeInMainWorld: (_name: string, api: DesktopApi) => {
          exposedApi = api
        },
      },
      ipcRenderer: { invoke: vi.fn() },
    }))

    await import('../../src/preload/index')

    expect(exposedApi).toBeDefined()
    expect(Object.keys(exposedApi!.settings)).not.toContain('getApiKey')
  })

  it('renders the API key settings card in Korean', async () => {
    const settings: DesktopApi['settings'] = {
      saveApiKey: vi.fn().mockResolvedValue(undefined),
      getApiKeyStatus: vi.fn().mockResolvedValue({ configured: false, lastValidatedAt: null }),
      deleteApiKey: vi.fn().mockResolvedValue(undefined),
    }

    render(<ApiKeySettings settings={settings} />)

    expect(await screen.findByRole('region', { name: 'API 키 설정' })).toHaveClass('settings-panel')
    expect(screen.getByText('설정되지 않음')).toBeInTheDocument()
    expect(screen.getByLabelText('OpenAI API 키')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'API 키 저장' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'API 키 삭제' })).toBeInTheDocument()
  })

  it('saves a key and shows the configured status without rendering the secret', async () => {
    const user = userEvent.setup()
    const settings: DesktopApi['settings'] = {
      saveApiKey: vi.fn().mockResolvedValue(undefined),
      getApiKeyStatus: vi
        .fn()
        .mockResolvedValueOnce({ configured: false, lastValidatedAt: null })
        .mockResolvedValueOnce({
          configured: true,
          lastValidatedAt: '2026-07-14T01:02:03.000Z',
        }),
      deleteApiKey: vi.fn().mockResolvedValue(undefined),
    }

    render(<ApiKeySettings settings={settings} />)
    expect(await screen.findByRole('region', { name: 'API 키 설정' })).toHaveClass('settings-panel')
    await screen.findByText('설정되지 않음')

    await user.type(screen.getByLabelText('OpenAI API 키'), 'sk-secret-value')
    await user.click(screen.getByRole('button', { name: 'API 키 저장' }))

    expect(settings.saveApiKey).toHaveBeenCalledWith('sk-secret-value')
    expect(await screen.findByText('설정됨')).toBeInTheDocument()
    expect(screen.getByLabelText('OpenAI API 키')).toHaveValue('')
    expect(screen.queryByText('sk-secret-value')).not.toBeInTheDocument()
  })

  it('keeps a successful save configured when the status refresh fails', async () => {
    const user = userEvent.setup()
    const settings: DesktopApi['settings'] = {
      saveApiKey: vi.fn().mockResolvedValue(undefined),
      getApiKeyStatus: vi
        .fn()
        .mockResolvedValueOnce({ configured: false, lastValidatedAt: null })
        .mockRejectedValueOnce(new Error('status unavailable')),
      deleteApiKey: vi.fn().mockResolvedValue(undefined),
    }

    const view = render(<ApiKeySettings settings={settings} />)
    await view.findByText('설정되지 않음')

    await user.type(view.getByLabelText('OpenAI API 키'), 'sk-secret-value')
    await user.click(view.getByRole('button', { name: 'API 키 저장' }))

    expect(await view.findByText('설정됨')).toBeInTheDocument()
    expect(view.getByRole('alert')).toHaveTextContent(
      'API 키는 저장했지만 상태를 새로고침하지 못했습니다.',
    )
    expect(view.getByLabelText('OpenAI API 키')).toHaveValue('')
  })

  it('reports an unavailable initial status instead of claiming no key is configured', async () => {
    const settings: DesktopApi['settings'] = {
      saveApiKey: vi.fn().mockResolvedValue(undefined),
      getApiKeyStatus: vi.fn().mockRejectedValue(new Error('status unavailable')),
      deleteApiKey: vi.fn().mockResolvedValue(undefined),
    }

    render(<ApiKeySettings settings={settings} />)

    expect(await screen.findByText('상태 확인 불가')).toBeInTheDocument()
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'API 키 상태를 불러오지 못했습니다.',
    )
    expect(screen.queryByText('설정되지 않음')).not.toBeInTheDocument()
  })

  it('ignores an initial status response that arrives after a successful save', async () => {
    const user = userEvent.setup()
    let resolveInitialStatus!: (status: { configured: boolean; lastValidatedAt: null }) => void
    const initialStatus = new Promise<{ configured: boolean; lastValidatedAt: null }>((resolve) => {
      resolveInitialStatus = resolve
    })
    const settings: DesktopApi['settings'] = {
      saveApiKey: vi.fn().mockResolvedValue(undefined),
      getApiKeyStatus: vi
        .fn()
        .mockReturnValueOnce(initialStatus)
        .mockResolvedValueOnce({ configured: true, lastValidatedAt: null }),
      deleteApiKey: vi.fn().mockResolvedValue(undefined),
    }

    render(<ApiKeySettings settings={settings} />)
    await user.type(screen.getByLabelText('OpenAI API 키'), 'sk-secret-value')
    await user.click(screen.getByRole('button', { name: 'API 키 저장' }))
    expect(await screen.findByText('설정됨')).toBeInTheDocument()

    await act(async () => resolveInitialStatus({ configured: false, lastValidatedAt: null }))

    await waitFor(() => expect(screen.queryByText('설정되지 않음')).not.toBeInTheDocument())
    expect(screen.getByText('설정됨')).toBeInTheDocument()
  })
})
