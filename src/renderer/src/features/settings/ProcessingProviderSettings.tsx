import { useCallback, useEffect, useRef, useState } from 'react'
import type {
  ProcessingProviderDescriptor,
  ProcessingProviderSettings as ProcessingSettings,
  SettingsApi,
} from '../../../../shared/contracts/settings'
import { PrivacyNotice } from '../../components/help/PrivacyNotice'
import { FieldHelp } from '../../components/help/FieldHelp'
import { CodexCliStatus } from './CodexCliStatus'
import { WhisperModelSettings } from './WhisperModelSettings'

const loadError = '처리 설정을 불러오지 못했습니다. 잠시 후 다시 시도하세요.'
const updateError = '처리 설정을 저장하지 못했습니다. 잠시 후 다시 시도하세요.'
type ProviderOperation = 'persist' | 'codex_refresh'

export function ProcessingProviderSettings({ settings }: { settings: SettingsApi }) {
  const [value, setValue] = useState<ProcessingSettings | null>(null)
  const [descriptors, setDescriptors] = useState<ProcessingProviderDescriptor[]>([])
  const [error, setError] = useState<string | null>(null)
  const [pendingOperation, setPendingOperation] = useState<ProviderOperation | null>(null)
  const pendingOperationRef = useRef<ProviderOperation | null>(null)
  const generation = useRef(0)
  const descriptorGeneration = useRef(0)
  const busy = pendingOperation !== null

  const refreshDescriptors = useCallback(async () => {
    const current = ++descriptorGeneration.current
    try {
      const next = await settings.listProcessingProviderDescriptors()
      if (descriptorGeneration.current === current) setDescriptors(next)
    } catch {
      if (descriptorGeneration.current === current) setError(loadError)
    }
  }, [settings])

  const runOperation = async (operation: ProviderOperation, task: () => Promise<void>) => {
    if (pendingOperationRef.current !== null) return
    pendingOperationRef.current = operation
    setPendingOperation(operation)
    try {
      await task()
    } finally {
      pendingOperationRef.current = null
      setPendingOperation(null)
    }
  }

  useEffect(() => {
    const current = ++generation.current
    void Promise.all([
      settings.getProcessingProviders(),
      settings.listProcessingProviderDescriptors(),
    ]).then(([next, providerDescriptors]) => {
      if (generation.current !== current) return
      setValue(next)
      setDescriptors(providerDescriptors)
    }).catch(() => {
      if (generation.current === current) setError(loadError)
    })
    return () => {
      generation.current += 1
      descriptorGeneration.current += 1
    }
  }, [settings])

  const persist = async (next: ProcessingSettings) => {
    await runOperation('persist', async () => {
      const current = ++generation.current
      setError(null)
      try {
        const persisted = await settings.updateProcessingProviders(next)
        if (generation.current === current) {
          setValue(persisted)
          await refreshDescriptors()
        }
      } catch {
        if (generation.current === current) setError(updateError)
      }
    })
  }

  const refreshCodexStatus = () => runOperation('codex_refresh', refreshDescriptors)

  if (value === null) return <section className="processing-settings" aria-label="처리 방식 설정">
    <div className="settings-heading"><div><p className="eyebrow">PROCESSING</p><h2>고급 처리 옵션</h2></div></div>
    {error !== null ? <p role="alert" className="settings-alert">{error}</p> : <p className="settings-meta">처리 설정을 불러오는 중입니다.</p>}
  </section>

  const transcription = descriptors.find((item) => item.stage === 'transcription' && item.id === value.transcriptionProvider)
  const summary = descriptors.find((item) => item.stage === 'summary' && item.id === value.summaryProvider)
  const modelManager = transcription?.capabilities.includes('model_manager') === true
  const cliStatus = summary?.capabilities.includes('cli_status') === true
  const openAiCapabilities = transcription?.privacy === 'audio_cloud'
    && transcription.capabilities.includes('api_key')
    && transcription.capabilities.includes('speaker_diarization')

  return <section className="processing-settings" aria-label="처리 방식 설정">
    <details className="advanced-settings">
      <summary>
        <span><span className="eyebrow">ADVANCED</span><strong>고급 처리 옵션</strong></span>
        <span className="advanced-summary">{transcription?.displayName ?? value.transcriptionProvider} · {summary?.displayName ?? value.summaryProvider}</span>
      </summary>
      <div className="advanced-settings-content">
        <FieldHelp>변경 사항은 앞으로 시작하거나 다시 시도하는 처리에만 적용되며, 기존 결과는 다시 작성하지 않습니다.</FieldHelp>
        <div className="provider-grid">
          <label>전사 방식
            <select value={value.transcriptionProvider} disabled={busy} onChange={(event) => void persist({ ...value, transcriptionProvider: event.target.value as ProcessingSettings['transcriptionProvider'] })}>
              {descriptors.filter((item) => item.stage === 'transcription').map((item) => <option key={`${item.stage}-${item.id}`} value={item.id}>{item.displayName}</option>)}
            </select>
          </label>
          <label>요약 방식
            <select value={value.summaryProvider} disabled={busy} onChange={(event) => void persist({ ...value, summaryProvider: event.target.value as ProcessingSettings['summaryProvider'] })}>
              {descriptors.filter((item) => item.stage === 'summary').map((item) => <option key={`${item.stage}-${item.id}`} value={item.id}>{item.displayName}</option>)}
            </select>
          </label>
          {modelManager && <label>로컬 모델
            <select value={value.localWhisperModel} disabled={busy} onChange={(event) => void persist({ ...value, localWhisperModel: event.target.value as ProcessingSettings['localWhisperModel'] })}>
              <option value="base">base · 빠르고 가벼움</option>
              <option value="small">small · 더 높은 정확도</option>
            </select>
          </label>}
        </div>
        {openAiCapabilities && <PrivacyNotice title="OpenAI 처리"><p>OpenAI API 키를 사용하며 화자 분리를 지원합니다.</p></PrivacyNotice>}
        {modelManager && transcription !== undefined && <WhisperModelSettings settings={settings} modelId={value.localWhisperModel} descriptor={transcription} onAvailabilityChanged={refreshDescriptors} />}
        {cliStatus && summary !== undefined && <CodexCliStatus descriptor={summary} pending={pendingOperation === 'codex_refresh'} disabled={busy} onAvailabilityChanged={refreshCodexStatus} />}
        {error !== null && <p role="alert" className="settings-alert">{error}</p>}
      </div>
    </details>
  </section>
}
