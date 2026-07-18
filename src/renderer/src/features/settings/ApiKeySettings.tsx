import { useEffect, useRef, useState, type FormEvent } from 'react'
import type { ApiKeyStatus, SettingsApi } from '../../../../shared/contracts/settings'
import { StatusIndicator } from '../../components/feedback/StatusIndicator'
import { ActionBar } from '../../components/layout/ActionBar'
import { Button } from '../../components/ui/Button'
import { SurfaceCard } from '../../components/ui/SurfaceCard'
import { Icon } from '../../components/ui/Icon'

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
        <div><p className="eyebrow">OPENAI</p><h2 id="api-key-settings-title"><Icon name="key" />API 키 설정</h2></div>
      </div>
      <SurfaceCard labelledBy="api-key-credential-title" className="credential-card">
        <div className="credential-card-heading">
          <h3 id="api-key-credential-title">OpenAI API 자격 증명</h3>
          <StatusIndicator available={status?.configured === true}>
            {status === null ? '상태 확인 불가' : status.configured ? '설정됨' : '설정되지 않음'}
          </StatusIndicator>
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
          <ActionBar danger={status?.configured ? <Button icon="delete" variant="danger" type="button" disabled={busy} onClick={() => void remove()}>API 키 삭제</Button> : undefined}>
            <Button icon="key" variant="primary" type="submit" disabled={busy || value.length === 0}>
              API 키 저장
            </Button>
          </ActionBar>
        </form>
        {error ? <p role="alert" className="settings-alert">{error}</p> : null}
      </SurfaceCard>
    </section>
  )
}
