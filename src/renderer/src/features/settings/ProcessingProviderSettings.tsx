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
  const [applePreparationError, setApplePreparationError] = useState<string | null>(null)
  const [applePreparationSlow, setApplePreparationSlow] = useState(false)
  const [pendingOperation, setPendingOperation] = useState<ProviderOperation | null>(null)
  const pendingOperationRef = useRef<ProviderOperation | null>(null)
  const generation = useRef(0)
  const descriptorGeneration = useRef(0)
  const busy = pendingOperation !== null

  useEffect(() => {
    if (pendingOperation !== 'apple_prepare') return
    const timer = setTimeout(() => setApplePreparationSlow(true), 30_000)
    return () => clearTimeout(timer)
  }, [pendingOperation])

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
    setApplePreparationError(null)
    setApplePreparationSlow(false)
    try {
      const availability = await settings.prepareAppleSpeech()
      ++descriptorGeneration.current
      setDescriptors((current) => current.map((item) => item.id === 'apple_speech'
        ? { ...item, availability } : item))
      if (!availability.available) {
        setApplePreparationError('음성 모델 준비가 완료되지 않았습니다. 인터넷 연결을 확인한 뒤 다시 시도하세요.')
      }
    } catch {
      setApplePreparationError('음성 모델을 준비하지 못했습니다. 인터넷 연결을 확인한 뒤 다시 시도하세요. 계속 실패하면 앱을 다시 실행하세요.')
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
    {value.transcriptionProvider === 'apple_speech' && <div className="apple-speech-setup" aria-busy={pendingOperation === 'apple_prepare'}>
      <p role="status" className="settings-meta">
        {pendingOperation === 'apple_prepare'
          ? applePreparationSlow
            ? 'Apple 음성 모델 준비가 계속 진행 중입니다. 다운로드에는 수 분이 걸릴 수 있습니다. 인터넷 연결을 유지하고 완료 안내를 기다려 주세요.'
            : 'Apple 음성 모델을 확인하고 필요한 파일을 다운로드·설치하고 있습니다. 완료되면 이곳에 표시됩니다.'
          : transcription?.availability.available
            ? '음성 모델 준비 완료 · 지금 전사할 수 있습니다. 상단의 녹음 시작으로 새 회의를 녹음하고, 종료 후 해당 기록에서 회의록 만들기를 누르세요.'
            : '음성 모델 준비가 필요합니다. 아래 버튼을 누르면 이 Mac에 필요한 모델을 설치합니다.'}
      </p>
      {applePreparationError !== null && <p role="alert" className="settings-alert">{applePreparationError}</p>}
      {!transcription?.availability.available && <button type="button" disabled={busy} onClick={() => void prepareAppleSpeech()}>{pendingOperation === 'apple_prepare' ? '음성 모델 준비 중…' : applePreparationError ? '음성 모델 준비 다시 시도' : '음성 모델 준비'}</button>}
    </div>}
    {value.summaryProvider === 'apple_foundation' && <FieldHelp>API 키 없이 이 Mac에서 요약합니다. Apple silicon Mac과 macOS 26 이상이 필요합니다. 시스템 설정 → Apple Intelligence 및 Siri에서 Apple Intelligence를 켜고 모델 준비를 완료한 뒤 상태를 다시 확인하세요.</FieldHelp>}
    {summary?.id === 'apple_foundation' && summary.availability.available && <p role="status" className="settings-meta">Apple Intelligence 요약 준비 완료 · 전사가 끝나면 회의록을 자동으로 작성합니다.</p>}
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
