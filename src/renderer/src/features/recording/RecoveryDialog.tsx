import { useState } from 'react'
import type { RecoveryItem } from '../../../../shared/contracts/recovery'

interface RecoveryControls {
  recover(meetingId: string): Promise<unknown>
  keepAsFile(meetingId: string): Promise<unknown>
  discard(meetingId: string, options: { explicitDelete: true }): Promise<unknown>
  exportOnly?(meetingId: string): Promise<{ status: 'success' | 'cancelled' | 'failure'; message?: string }>
}

interface RecoveryDialogProps {
  items: readonly RecoveryItem[]
  recovery: RecoveryControls
  onResolved(meetingId: string): void
  onRecover?(meetingId: string): Promise<void>
  recoverDisabled?: boolean
}

const destructiveStyle = { backgroundColor: '#b42318', color: '#ffffff' } as const

function formatDuration(durationMs: number): string {
  const seconds = Math.floor(durationMs / 1_000)
  return `${Math.floor(seconds / 60)}분 ${seconds % 60}초`
}

function formatBytes(byteCount: number): string {
  if (byteCount < 1_024) return `${byteCount} B`
  return `${Math.round(byteCount / 1_024)} KB`
}

export function RecoveryDialog({ items, recovery, onResolved, onRecover, recoverDisabled = false }: RecoveryDialogProps) {
  const [confirming, setConfirming] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  if (items.length === 0) return null

  const decide = async (meetingId: string, action: 'recover' | 'keep' | 'discard') => {
    setBusy(true)
    setError(null)
    try {
      if (action === 'recover') {
        if (onRecover === undefined) await recovery.recover(meetingId)
        else await onRecover(meetingId)
      }
      else if (action === 'keep') await recovery.keepAsFile(meetingId)
      else await recovery.discard(meetingId, { explicitDelete: true })
      setConfirming(null)
      onResolved(meetingId)
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : '복구 결정을 적용하지 못했습니다.')
    } finally {
      setBusy(false)
    }
  }

  const exportBytes = async (meetingId: string) => {
    setBusy(true)
    setError(null)
    try {
      const result = await recovery.exportOnly?.(meetingId)
      if (result?.status === 'failure') setError(result.message ?? '보존 바이트를 내보내지 못했습니다.')
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : '보존 바이트를 내보내지 못했습니다.')
    } finally { setBusy(false) }
  }

  return (
    <div role="dialog" aria-modal="true" aria-label="중단된 녹음 복구">
      <h1>중단된 녹음 복구</h1>
      <p>모든 항목을 처리할 때까지 새 녹음을 시작할 수 없습니다.</p>
      {items.map((item) => (
        <section key={item.meetingId} aria-label={`중단된 녹음 ${item.meetingId}`}>
          <time dateTime={item.createdAt}>{new Date(item.createdAt).toLocaleString()}</time>
          <span>{formatDuration(item.durationMs)}</span>
          <span>{formatBytes(item.byteCount)}</span>
          {item.kind === 'exportOnly' ? (
            <><p>매니페스트를 읽을 수 없어 원본 바이트는 내보내기 전용으로 보존됩니다.</p><button disabled={busy || confirming !== null} onClick={() => void exportBytes(item.meetingId)}>보존 바이트 내보내기</button></>
          ) : (
            <>
              {item.kind === 'recoverable' && (
                <button disabled={recoverDisabled || busy || confirming !== null} onClick={() => void decide(item.meetingId, 'recover')}>복구</button>
              )}
              <button disabled={busy || confirming !== null} onClick={() => void decide(item.meetingId, 'keep')}>현재 파일로 보관</button>
            </>
          )}
          <button style={destructiveStyle} data-destructive="true" disabled={busy || confirming !== null} onClick={() => setConfirming(item.meetingId)}>폐기</button>
        </section>
      ))}
      {error !== null && <p role="alert">{error}</p>}
      {confirming !== null && (
        <div role="alertdialog" aria-modal="true" aria-label="복구 녹음 영구 폐기">
          <p>보존된 녹음 바이트를 영구적으로 폐기할까요?</p>
          <button disabled={busy} onClick={() => setConfirming(null)}>취소</button>
          <button style={destructiveStyle} data-destructive="true" disabled={busy} onClick={() => void decide(confirming, 'discard')}>영구 폐기 확인</button>
        </div>
      )}
    </div>
  )
}
