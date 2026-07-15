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
      setError('API 키 상태를 불러오지 못했습니다.')
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
        setError('API 키는 저장했지만 상태를 새로고침하지 못했습니다.')
      }
    } catch {
      setError('API 키를 검증하지 못했습니다.')
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
        setError('API 키는 삭제했지만 상태를 새로고침하지 못했습니다.')
      }
    } catch {
      setError('API 키를 삭제하지 못했습니다.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <section className="settings-panel" aria-labelledby="api-key-settings-title">
      <div className="settings-heading">
        <div><p className="eyebrow">OPENAI</p><h2 id="api-key-settings-title">API 키 설정</h2></div>
        <span className="credential-status">{status === null ? '상태 확인 불가' : status.configured ? '설정됨' : '설정되지 않음'}</span>
      </div>
      {status?.lastValidatedAt ? <p className="settings-meta">마지막 검증: {status.lastValidatedAt}</p> : null}
      <form className="credential-form" onSubmit={save}>
        <label htmlFor="openai-api-key">OpenAI API 키</label>
        <input
          id="openai-api-key"
          type="password"
          autoComplete="off"
          value={value}
          onChange={(event) => setValue(event.target.value)}
        />
        <button type="submit" disabled={busy || value.length === 0}>
          API 키 저장
        </button>
      </form>
      <div className="danger-zone"><div><strong>저장된 API 키 삭제</strong><p>이 기기의 보안 저장소에서만 제거합니다.</p></div><button className="button-danger" type="button" disabled={busy || !status?.configured} onClick={remove}>API 키 삭제</button></div>
      {error ? <p role="alert">{error}</p> : null}
    </section>
  )
}
