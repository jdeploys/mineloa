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

  it('never exposes the saved key through the desktop API', async () => {
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

  it('saves a key and shows the configured status without rendering the key', async () => {
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
    expect(await screen.findByRole('region', { name: 'API key settings' })).toHaveClass('settings-panel')
    await screen.findByText('Not configured')

    await user.type(screen.getByLabelText('OpenAI API key'), 'sk-secret-value')
    await user.click(screen.getByRole('button', { name: 'Save API key' }))

    expect(settings.saveApiKey).toHaveBeenCalledWith('sk-secret-value')
    expect(await screen.findByText('Configured')).toBeInTheDocument()
    expect(screen.getByLabelText('OpenAI API key')).toHaveValue('')
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
    await view.findByText('Not configured')

    await user.type(view.getByLabelText('OpenAI API key'), 'sk-secret-value')
    await user.click(view.getByRole('button', { name: 'Save API key' }))

    expect(await view.findByText('Configured')).toBeInTheDocument()
    expect(view.getByRole('alert')).toHaveTextContent(
      'The API key was saved, but its status could not be refreshed.',
    )
    expect(view.getByLabelText('OpenAI API key')).toHaveValue('')
  })

  it('reports an unavailable initial status instead of claiming no key is configured', async () => {
    const settings: DesktopApi['settings'] = {
      saveApiKey: vi.fn().mockResolvedValue(undefined),
      getApiKeyStatus: vi.fn().mockRejectedValue(new Error('status unavailable')),
      deleteApiKey: vi.fn().mockResolvedValue(undefined),
    }

    render(<ApiKeySettings settings={settings} />)

    expect(await screen.findByText('Status unavailable')).toBeInTheDocument()
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'The API key status could not be loaded.',
    )
    expect(screen.queryByText('Not configured')).not.toBeInTheDocument()
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
    await user.type(screen.getByLabelText('OpenAI API key'), 'sk-secret-value')
    await user.click(screen.getByRole('button', { name: 'Save API key' }))
    expect(await screen.findByText('Configured')).toBeInTheDocument()

    await act(async () => resolveInitialStatus({ configured: false, lastValidatedAt: null }))

    await waitFor(() => expect(screen.queryByText('Not configured')).not.toBeInTheDocument())
    expect(screen.getByText('Configured')).toBeInTheDocument()
  })
})
