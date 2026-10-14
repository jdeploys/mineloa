import { useCallback, useEffect, useRef, useState } from 'react'
import type {
  ProcessingProviderDescriptor,
  ProcessingProviderSettings as ProcessingSettings,
  SettingsApi,
} from '../../../../shared/contracts/settings'
import { PrivacyNotice } from '../../components/help/PrivacyNotice'
import { FieldHelp } from '../../components/help/FieldHelp'
import { Icon } from '../../components/ui/Icon'
import { CodexCliStatus } from './CodexCliStatus'
import { ApiKeySettings } from './ApiKeySettings'
import { WhisperModelSettings } from './WhisperModelSettings'

const loadError = '처리 설정을 불러오지 못했습니다. 잠시 후 다시 시도하세요.'
const updateError = '처리 설정을 저장하지 못했습니다. 잠시 후 다시 시도하세요.'
type ProviderOperation = 'persist' | 'codex_refresh' | 'apple_prepare'

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
  const prepareAppleSpeech = () => runOperation('apple_prepare', async () => {
    setError(null)
    try {
      await settings.prepareAppleSpeech()
      await refreshDescriptors()
    } catch {
      setError('음성 모델을 준비하지 못했습니다. 잠시 후 다시 시도하세요.')
    }
  })

  if (value === null) return <section className="processing-settings" aria-label="처리 방식 설정">
    <div className="settings-heading"><div><p className="eyebrow">PROCESSING</p><h2><Icon name="model" />처리 방식</h2></div></div>
    {error !== null ? <p role="alert" className="settings-alert">{error}</p> : <p className="settings-meta">처리 설정을 불러오는 중입니다.</p>}
  </section>

  const transcription = descriptors.find((item) => item.stage === 'transcription' && item.id === value.transcriptionProvider)
  const summary = descriptors.find((item) => item.stage === 'summary' && item.id === value.summaryProvider)
  const modelManager = transcription?.capabilities.includes('model_manager') === true
  const cliStatus = summary?.capabilities.includes('cli_status') === true
  const usesOpenAi = value.transcriptionProvider === 'openai' || value.summaryProvider === 'openai'

  return <section className="processing-settings" aria-label="처리 방식 설정">
    <div className="settings-heading"><div><p className="eyebrow">PROCESSING</p><h2><Icon name="model" />처리 방식</h2></div></div>
    <FieldHelp>변경 사항은 앞으로 시작하거나 다시 시도하는 처리에만 적용되며, 기존 결과는 다시 작성하지 않습니다.</FieldHelp>
    <div className="provider-grid">
      <label>음성 변환 방식
        <select value={value.transcriptionProvider} disabled={busy} onChange={(event) => void persist({ ...value, transcriptionProvider: event.target.value as ProcessingSettings['transcriptionProvider'] })}>
          {descriptors.filter((item) => item.stage === 'transcription').map((item) => <option key={item.id} value={item.id}>{item.displayName}</option>)}
        </select>
      </label>
      <label>회의록 작성 방식
        <select value={value.summaryProvider} disabled={busy} onChange={(event) => void persist({ ...value, summaryProvider: event.target.value as ProcessingSettings['summaryProvider'] })}>
          {descriptors.filter((item) => item.stage === 'summary').map((item) => <option key={item.id} value={item.id}>{item.displayName}</option>)}
        </select>
      </label>
    </div>
    {transcription?.id === 'apple_speech' && transcription.availability.available === false && <p role="status" className="settings-meta">{transcription.availability.message}</p>}
    {summary?.id === 'apple_foundation' && summary.availability.available === false && <p role="status" className="settings-meta">{summary.availability.message}</p>}
    {value.transcriptionProvider === 'apple_speech' && <FieldHelp>Apple 음성 전사는 화자를 자동 구분하지 않습니다. Mac의 기본 언어가 한국어이면 한국어, 그 외에는 영어 음성 모델을 준비합니다. 모델 준비에는 인터넷이 필요할 수 있습니다.</FieldHelp>}
    {value.transcriptionProvider === 'apple_speech' && <button type="button" disabled={busy} onClick={() => void prepareAppleSpeech()}>{pendingOperation === 'apple_prepare' ? '준비 중…' : '음성 모델 준비'}</button>}
    {value.summaryProvider === 'apple_foundation' && <FieldHelp>API 키 없이 이 Mac에서 요약합니다. Apple silicon Mac과 macOS 26 이상이 필요합니다. 시스템 설정 → Apple Intelligence 및 Siri에서 Apple Intelligence를 켜고 모델 준비를 완료한 뒤 상태를 다시 확인하세요.</FieldHelp>}
    {(value.transcriptionProvider === 'apple_speech' || value.summaryProvider === 'apple_foundation') && <button type="button" disabled={busy} onClick={() => void refreshDescriptors()}>상태 다시 확인</button>}
    {usesOpenAi && <div className="openai-settings" role="region" aria-label="OpenAI 설정">
      <div className="local-settings-heading">
        <span><span className="eyebrow">OPENAI</span><strong><Icon name="key" />OpenAI 설정</strong></span>
      </div>
      <ApiKeySettings settings={settings} embedded />
    </div>}
    {(modelManager || cliStatus || (value.transcriptionProvider !== 'openai' && value.summaryProvider === 'openai')) && <div className="local-settings" role="region" aria-label="로컬 설정">
      <div className="local-settings-heading">
        <span><span className="eyebrow">LOCAL</span><strong><Icon name="model" />로컬 설정</strong></span>
        <span className="advanced-summary">{transcription?.displayName ?? value.transcriptionProvider} · {summary?.displayName ?? value.summaryProvider}</span>
      </div>
      <div className="local-settings-content">
        <FieldHelp>변경 사항은 앞으로 시작하거나 다시 시도하는 처리에만 적용되며, 기존 결과는 다시 작성하지 않습니다.</FieldHelp>
        <div className="provider-grid">
          {modelManager && <label>로컬 모델
            <select value={value.localWhisperModel} disabled={busy} onChange={(event) => void persist({ ...value, localWhisperModel: event.target.value as ProcessingSettings['localWhisperModel'] })}>
              <option value="base">base · 빠르고 가벼움</option>
              <option value="small">small · 더 높은 정확도</option>
            </select>
          </label>}
        </div>
        {summary?.id === 'openai' && transcription?.privacy === 'local' && <PrivacyNotice title="OpenAI 요약"><p>음성은 이 Mac에서 처리하고, 변환된 전사문은 OpenAI로 전송합니다.</p></PrivacyNotice>}
        {modelManager && transcription !== undefined && <WhisperModelSettings settings={settings} modelId={value.localWhisperModel} descriptor={transcription} onAvailabilityChanged={refreshDescriptors} />}
        {cliStatus && summary !== undefined && <CodexCliStatus descriptor={summary} pending={pendingOperation === 'codex_refresh'} disabled={busy} onAvailabilityChanged={refreshCodexStatus} />}
      </div>
    </div>}
    {error !== null && <p role="alert" className="settings-alert">{error}</p>}
  </section>
}
