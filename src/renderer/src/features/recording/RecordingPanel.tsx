import { useState } from 'react'

export interface RecordingPanelControls {
  start(): Promise<void>
  stop(): Promise<void>
  discard(): Promise<void>
}

interface RecordingPanelProps {
  controls: RecordingPanelControls
  onNavigate(destination: 'settings'): void
}

export function RecordingPanel({ controls, onNavigate }: RecordingPanelProps) {
  const [recording, setRecording] = useState(false)
  const [confirmingDiscard, setConfirmingDiscard] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const run = async (action: () => Promise<void>, onSuccess: () => void) => {
    setBusy(true)
    setError(null)
    try {
      await action()
      onSuccess()
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : '녹음 작업에 실패했습니다.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <section aria-label="회의 녹음">
      {!recording ? (
        <button disabled={busy} onClick={() => void run(controls.start, () => setRecording(true))}>
          녹음 시작
        </button>
      ) : (
        <>
          <p aria-live="polite">녹음 중</p>
          <button disabled={busy} onClick={() => void run(controls.stop, () => setRecording(false))}>
            종료
          </button>
          <button disabled={busy} onClick={() => setConfirmingDiscard(true)}>
            폐기
          </button>
        </>
      )}
      <button disabled={busy} onClick={() => onNavigate('settings')}>
        설정으로 이동
      </button>
      {error !== null && <p role="alert">{error}</p>}
      {confirmingDiscard && (
        <div role="dialog" aria-modal="true" aria-label="녹음 폐기">
          <p>현재 녹음과 저장된 청크를 모두 폐기할까요?</p>
          <button onClick={() => setConfirmingDiscard(false)}>취소</button>
          <button
            disabled={busy}
            onClick={() =>
              void run(controls.discard, () => {
                setConfirmingDiscard(false)
                setRecording(false)
              })
            }
          >
            녹음 폐기 확인
          </button>
        </div>
      )}
    </section>
  )
}
