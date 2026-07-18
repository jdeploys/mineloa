import { useCallback, useEffect, useState } from 'react'
import type { AudioPolicy } from '../../../../shared/contracts/meeting'
import type { SummaryTemplate, TemplatesApi } from '../../../../shared/contracts/template'
import { InlineNotice } from '../../components/feedback/InlineNotice'
import { ActionBar } from '../../components/layout/ActionBar'
import { Button } from '../../components/ui/Button'
import { Icon } from '../../components/ui/Icon'
import { StatusBadge } from '../../components/ui/StatusBadge'
import {
  RecordingTerminalError,
  type MicrophoneOption,
  type RecordingSnapshot,
  type RecordingTerminalFailure,
} from './mediaRecorderController'

export interface RecordingPanelControls {
  start(options?: { selectedTemplateId: string; audioPolicy: AudioPolicy; microphoneDeviceId: string | null; farFieldMode: boolean }): Promise<void>
  stop(): Promise<void>
  discard(): Promise<void>
  pause?(): Promise<void>
  resume?(): Promise<void>
  subscribe?(listener: (snapshot: RecordingSnapshot) => void): () => void
  listMicrophones?(): Promise<MicrophoneOption[]>
}

interface RecordingPanelProps {
  controls: RecordingPanelControls
  onNavigate(destination: 'settings'): void
  settingsFocusKey?: string
  templates?: TemplatesApi
}

type PanelPhase = 'idle' | 'recording' | 'stop_pending' | 'discard_pending'

const idleSnapshot: RecordingSnapshot = {
  phase: 'idle', meetingId: null, durationMs: 0, totalBytes: 0, warn: false,
  activePartIndex: 0, partCount: 0, microphone: 'inactive', localSave: 'idle',
}

function formatElapsed(durationMs: number): string {
  const seconds = Math.floor(durationMs / 1_000)
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`
}

export function RecordingPanel({ controls, onNavigate, settingsFocusKey, templates }: RecordingPanelProps) {
  const [phase, setPhase] = useState<PanelPhase>('idle')
  const [terminalFailure, setTerminalFailure] = useState<RecordingTerminalFailure | null>(null)
  const [confirmingDiscard, setConfirmingDiscard] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [snapshot, setSnapshot] = useState(idleSnapshot)
  const [templateItems, setTemplateItems] = useState<SummaryTemplate[]>([])
  const [selectedTemplateId, setSelectedTemplateId] = useState('default')
  const [audioPolicy, setAudioPolicy] = useState<AudioPolicy>('delete_after_processing')
  const [microphones, setMicrophones] = useState<MicrophoneOption[]>([])
  const [microphoneDeviceId, setMicrophoneDeviceId] = useState('')
  const [farFieldMode, setFarFieldMode] = useState(true)

  useEffect(() => controls.subscribe?.((next) => {
    setSnapshot(next)
    if (next.phase === 'recording' || next.phase === 'paused') setPhase('recording')
    if (next.phase === 'failed') { setPhase('stop_pending'); setTerminalFailure('stop_failed') }
    if (next.phase === 'idle' && next.meetingId === null) setPhase('idle')
  }), [controls])

  useEffect(() => {
    if (templates === undefined) return
    let active = true
    void templates.list().then((items) => {
      if (!active) return
      setTemplateItems(items)
      setSelectedTemplateId(items.find((item) => item.isDefault)?.id ?? items[0]?.id ?? 'default')
    }).catch(() => { if (active) setError('요약 템플릿을 불러오지 못했습니다.') })
    return () => { active = false }
  }, [templates])

  const refreshMicrophones = useCallback(async () => {
    if (controls.listMicrophones === undefined) return
    try { setMicrophones(await controls.listMicrophones()) } catch { setMicrophones([]) }
  }, [controls])

  useEffect(() => { void refreshMicrophones() }, [refreshMicrophones])

  const start = async () => {
    setBusy(true)
    setError(null)
    try {
      await controls.start({ selectedTemplateId, audioPolicy, microphoneDeviceId: microphoneDeviceId || null, farFieldMode })
      setPhase('recording')
    } catch (cause) {
      if (cause instanceof RecordingTerminalError && cause.state === 'capture_failed') {
        setTerminalFailure('capture_failed')
        setPhase('stop_pending')
      }
      setError(cause instanceof Error ? cause.message : '녹음을 시작하지 못했습니다.')
    } finally {
      setBusy(false)
    }
  }

  const togglePause = async () => {
    setBusy(true)
    setError(null)
    try {
      if (snapshot.phase === 'paused') await controls.resume?.()
      else await controls.pause?.()
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : '녹음 상태를 바꾸지 못했습니다.')
    } finally { setBusy(false) }
  }

  const stop = async () => {
    setBusy(true)
    setError(null)
    try {
      await controls.stop()
      setPhase('idle')
      setTerminalFailure(null)
    } catch (cause) {
      const failure =
        cause instanceof RecordingTerminalError ? cause.state : ('stop_failed' as const)
      setTerminalFailure(failure)
      setPhase('stop_pending')
      setError(cause instanceof Error ? cause.message : '녹음 저장을 완료하지 못했습니다.')
    } finally {
      setBusy(false)
    }
  }

  const discard = async () => {
    setBusy(true)
    setError(null)
    setConfirmingDiscard(false)
    try {
      await controls.discard()
      setPhase('idle')
      setTerminalFailure(null)
    } catch (cause) {
      setTerminalFailure('discard_failed')
      setPhase('discard_pending')
      setError(cause instanceof Error ? cause.message : '녹음 폐기를 완료하지 못했습니다.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <section className="recording-panel" aria-label="회의 녹음">
      {phase === 'idle' && (
        <div className="recording-options">
          <div className="recording-fields">
            {templates !== undefined && <label>요약 템플릿 <span className="recording-select-control"><select aria-label="요약 템플릿" value={selectedTemplateId} onChange={(event) => setSelectedTemplateId(event.target.value)}>{templateItems.map((template) => <option key={template.id} value={template.id}>{template.name}</option>)}</select><Icon name="down" size={20} /></span></label>}
            <label>원본 오디오 <span className="recording-select-control"><select aria-label="원본 오디오" value={audioPolicy} onChange={(event) => setAudioPolicy(event.target.value as AudioPolicy)}><option value="delete_after_processing">처리 후 삭제</option><option value="keep">계속 보관</option></select><Icon name="down" size={20} /></span></label>
            <label className="recording-microphone-field">마이크 <span className="recording-select-control"><select aria-label="마이크" value={microphoneDeviceId} onFocus={() => void refreshMicrophones()} onChange={(event) => setMicrophoneDeviceId(event.target.value)}><option value="">시스템 기본 마이크</option>{microphones.map((microphone) => <option key={microphone.deviceId} value={microphone.deviceId}>{microphone.label}</option>)}</select><Icon name="down" size={20} /></span></label>
            <div className="recording-quality-field">
              <span>녹음 품질</span>
              <label className="recording-checkbox"><input type="checkbox" checked={farFieldMode} onChange={(event) => setFarFieldMode(event.currentTarget.checked)} /><span><strong>원거리 음성 강화</strong><small>먼 목소리를 더 잘 담습니다.</small></span></label>
            </div>
          </div>
          <ActionBar>
            <Button icon="microphone" variant="primary" disabled={busy || (templates !== undefined && templateItems.length === 0)} onClick={() => void start()}>
              녹음 시작
            </Button>
            <Button icon="settings" variant="tertiary" data-focus-key={settingsFocusKey} disabled={busy} onClick={() => onNavigate('settings')}>
              설정으로 이동
            </Button>
          </ActionBar>
        </div>
      )}
      {phase === 'recording' && (
        <div className="recording-active">
          <div className="live-status-row" aria-live="polite">
            <StatusBadge label={snapshot.phase === 'paused' ? '일시정지됨' : '녹음 중'} tone="active" />
            <span>{snapshot.microphone === 'paused' ? '마이크 일시정지' : snapshot.microphone === 'active' ? '마이크 연결됨' : '마이크 확인 중'}</span>
          </div>
          <p className="recording-elapsed" aria-label={`경과 시간 ${formatElapsed(snapshot.durationMs)}`}>{formatElapsed(snapshot.durationMs)}</p>
          <dl className="recording-telemetry">
            <div><dt>저장 크기</dt><dd>{(snapshot.totalBytes / (1024 * 1024)).toFixed(1)} MiB</dd></div>
            <div><dt>녹음 파트</dt><dd>파트 {Math.max(1, snapshot.partCount)}</dd></div>
            <div><dt>로컬 저장</dt><dd>{snapshot.localSave === 'saving' ? '로컬 저장 중' : snapshot.localSave === 'saved' ? '로컬 저장 완료' : '로컬 저장 대기'}</dd></div>
          </dl>
          {snapshot.warn && <InlineNotice tone="warning" title="파트 전환 준비"><p role="status">22 MiB를 넘어 새 파트 전환을 준비합니다.</p></InlineNotice>}
          <ActionBar danger={<Button icon="delete" variant="danger" disabled={busy} onClick={() => setConfirmingDiscard(true)}>폐기</Button>}>
            {controls.pause !== undefined && controls.resume !== undefined && <Button icon={snapshot.phase === 'paused' ? 'play' : 'pause'} variant="secondary" disabled={busy} onClick={() => void togglePause()}>{snapshot.phase === 'paused' ? '재개' : '일시정지'}</Button>}
            <Button icon="stop" variant="primary" disabled={busy} onClick={() => void stop()}>종료</Button>
            <Button icon="settings" variant="tertiary" data-focus-key={settingsFocusKey} disabled={busy} onClick={() => onNavigate('settings')}>설정으로 이동</Button>
          </ActionBar>
        </div>
      )}
      {phase === 'stop_pending' && (
        <div className="recording-pending">
          <InlineNotice tone="warning" title="저장 완료 대기"><p aria-live="polite">녹음은 중지되었지만 저장 완료를 기다리고 있습니다.</p></InlineNotice>
          <ActionBar danger={terminalFailure === 'capture_failed' ? <Button icon="delete" variant="danger" disabled={busy} onClick={() => setConfirmingDiscard(true)}>폐기</Button> : undefined}>
            {terminalFailure !== 'capture_failed' && <Button icon="retry" variant="primary" disabled={busy} onClick={() => void stop()}>종료 재시도</Button>}
            <Button icon="settings" variant="tertiary" data-focus-key={settingsFocusKey} disabled={busy} onClick={() => onNavigate('settings')}>설정으로 이동</Button>
          </ActionBar>
        </div>
      )}
      {phase === 'discard_pending' && (
        <div className="recording-pending">
          <InlineNotice tone="error" title="폐기 실패"><p aria-live="polite">녹음은 중지되었지만 폐기를 완료하지 못했습니다.</p></InlineNotice>
          <ActionBar danger={<Button icon="retry" variant="danger" disabled={busy} onClick={() => void discard()}>폐기 재시도</Button>}>
            <Button icon="settings" variant="tertiary" data-focus-key={settingsFocusKey} disabled={busy} onClick={() => onNavigate('settings')}>설정으로 이동</Button>
          </ActionBar>
        </div>
      )}
      {error !== null && <InlineNotice tone="error" title="녹음 작업 실패"><p>{error}</p></InlineNotice>}
      {confirmingDiscard && (
        <div className="dialog-scrim">
          <div className="dialog-panel dialog-panel-compact" role="dialog" aria-modal="true" aria-label="녹음 폐기">
            <header className="dialog-heading"><h2>녹음을 폐기할까요?</h2><p>현재 녹음과 저장된 청크를 모두 폐기합니다.</p></header>
            <ActionBar danger={<Button icon="delete" variant="danger" disabled={busy} onClick={() => void discard()}>녹음 폐기 확인</Button>}>
              <Button icon="close" variant="secondary" onClick={() => setConfirmingDiscard(false)}>취소</Button>
            </ActionBar>
          </div>
        </div>
      )}
    </section>
  )
}
