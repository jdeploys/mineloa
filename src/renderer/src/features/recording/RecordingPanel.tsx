import { useEffect, useState } from 'react'
import type { AudioPolicy } from '../../../../shared/contracts/meeting'
import type { SummaryTemplate, TemplatesApi } from '../../../../shared/contracts/template'
import {
  RecordingTerminalError,
  type RecordingSnapshot,
  type RecordingTerminalFailure,
} from './mediaRecorderController'

export interface RecordingPanelControls {
  start(options?: { selectedTemplateId: string; audioPolicy: AudioPolicy }): Promise<void>
  stop(): Promise<void>
  discard(): Promise<void>
  pause?(): Promise<void>
  resume?(): Promise<void>
  subscribe?(listener: (snapshot: RecordingSnapshot) => void): () => void
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

  const start = async () => {
    setBusy(true)
    setError(null)
    try {
      await controls.start({ selectedTemplateId, audioPolicy })
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
    <section aria-label="회의 녹음">
      {phase === 'idle' && (
        <>
          {templates !== undefined && <label>요약 템플릿 <select aria-label="요약 템플릿" value={selectedTemplateId} onChange={(event) => setSelectedTemplateId(event.target.value)}>{templateItems.map((template) => <option key={template.id} value={template.id}>{template.name}</option>)}</select></label>}
          <label>원본 오디오 <select aria-label="원본 오디오" value={audioPolicy} onChange={(event) => setAudioPolicy(event.target.value as AudioPolicy)}><option value="delete_after_processing">처리 후 삭제</option><option value="keep">계속 보관</option></select></label>
          <button disabled={busy || (templates !== undefined && templateItems.length === 0)} onClick={() => void start()}>
            녹음 시작
          </button>
        </>
      )}
      {phase === 'recording' && (
        <>
          <p aria-live="polite">녹음 중</p>
          <dl className="recording-telemetry">
            <div><dt>경과 시간</dt><dd>{formatElapsed(snapshot.durationMs)}</dd></div>
            <div><dt>저장 크기</dt><dd>{(snapshot.totalBytes / (1024 * 1024)).toFixed(1)} MiB</dd></div>
            <div><dt>녹음 파트</dt><dd>파트 {Math.max(1, snapshot.partCount)}</dd></div>
          </dl>
          <p>{snapshot.microphone === 'paused' ? '마이크 일시정지' : snapshot.microphone === 'active' ? '마이크 연결됨' : '마이크 확인 중'}</p>
          <p>{snapshot.localSave === 'saving' ? '로컬 저장 중' : snapshot.localSave === 'saved' ? '로컬 저장 완료' : '로컬 저장 대기'}</p>
          {snapshot.warn && <p role="status">22 MiB를 넘어 새 파트 전환을 준비합니다.</p>}
          {controls.pause !== undefined && controls.resume !== undefined && <button disabled={busy} onClick={() => void togglePause()}>{snapshot.phase === 'paused' ? '재개' : '일시정지'}</button>}
          <button disabled={busy} onClick={() => void stop()}>
            종료
          </button>
          <button disabled={busy} onClick={() => setConfirmingDiscard(true)}>
            폐기
          </button>
        </>
      )}
      {phase === 'stop_pending' && (
        <>
          <p aria-live="polite">녹음은 중지되었지만 저장 완료를 기다리고 있습니다.</p>
          {terminalFailure === 'capture_failed' ? (
            <button disabled={busy} onClick={() => setConfirmingDiscard(true)}>
              폐기
            </button>
          ) : (
            <button disabled={busy} onClick={() => void stop()}>
              종료 재시도
            </button>
          )}
        </>
      )}
      {phase === 'discard_pending' && (
        <>
          <p aria-live="polite">녹음은 중지되었지만 폐기를 완료하지 못했습니다.</p>
          <button disabled={busy} onClick={() => void discard()}>
            폐기 재시도
          </button>
        </>
      )}
      <button data-focus-key={settingsFocusKey} disabled={busy} onClick={() => onNavigate('settings')}>
        설정으로 이동
      </button>
      {error !== null && <p role="alert">{error}</p>}
      {confirmingDiscard && (
        <div role="dialog" aria-modal="true" aria-label="녹음 폐기">
          <p>현재 녹음과 저장된 청크를 모두 폐기할까요?</p>
          <button onClick={() => setConfirmingDiscard(false)}>취소</button>
          <button disabled={busy} onClick={() => void discard()}>
            녹음 폐기 확인
          </button>
        </div>
      )}
    </section>
  )
}
