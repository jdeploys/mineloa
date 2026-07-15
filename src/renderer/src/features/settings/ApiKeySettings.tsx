import { useEffect, useRef, useState, type FormEvent } from 'react'
import type { ApiKeyStatus, SettingsApi } from '../../../../shared/contracts/settings'

interface ApiKeySettingsProps {
  settings: SettingsApi
}

export function ApiKeySettings({ settings }: ApiKeySettingsProps) {
  const [value, setValue] = useState('')
  const [status, setStatus] = useState<ApiKeyStatus | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const statusRequestGeneration = useRef(0)

  const refreshStatus = async () => {
    const generation = ++statusRequestGeneration.current

    try {
      const nextStatus = await settings.getApiKeyStatus()
      if (generation === statusRequestGeneration.current) {
        setStatus(nextStatus)
      }
    } catch (cause) {
      if (generation === statusRequestGeneration.current) {
        throw cause
      }
    }
  }

  useEffect(() => {
    void refreshStatus().catch(() => {
      setError('The API key status could not be loaded.')
    })

    return () => {
      statusRequestGeneration.current += 1
    }
  }, [settings])

  const save = async (event: FormEvent) => {
    event.preventDefault()
    setBusy(true)
    setError(null)

    try {
      await settings.saveApiKey(value)
      setValue('')
      setStatus({ configured: true, lastValidatedAt: null })

      try {
        await refreshStatus()
      } catch {
        setError('The API key was saved, but its status could not be refreshed.')
      }
    } catch {
      setError('The API key could not be validated.')
    } finally {
      setBusy(false)
    }
  }

  const remove = async () => {
    setBusy(true)
    setError(null)

    try {
      await settings.deleteApiKey()
      setValue('')
      setStatus({ configured: false, lastValidatedAt: null })

      try {
        await refreshStatus()
      } catch {
        setError('The API key was deleted, but its status could not be refreshed.')
      }
    } catch {
      setError('The API key could not be deleted.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <section aria-labelledby="api-key-settings-title">
      <h2 id="api-key-settings-title">API key settings</h2>
      <p>{status === null ? 'Status unavailable' : status.configured ? 'Configured' : 'Not configured'}</p>
      {status?.lastValidatedAt ? <p>Last validated: {status.lastValidatedAt}</p> : null}
      <form onSubmit={save}>
        <label htmlFor="openai-api-key">OpenAI API key</label>
        <input
          id="openai-api-key"
          type="password"
          autoComplete="off"
          value={value}
          onChange={(event) => setValue(event.target.value)}
        />
        <button type="submit" disabled={busy || value.length === 0}>
          Save API key
        </button>
      </form>
      <button type="button" disabled={busy || !status?.configured} onClick={remove}>
        Delete API key
      </button>
      {error ? <p role="alert">{error}</p> : null}
    </section>
  )
}
