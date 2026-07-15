import { useEffect, useRef, useState } from 'react'
import type { ProcessingApi, ProcessingStatus as Status } from '../../../../shared/contracts/processing'

export function ProcessingStatus({ meetingId, processing, initialStatus, onStatusChange }: { meetingId: string; processing: ProcessingApi; initialStatus: Status; onStatusChange?(status: Status): void }) {
  const [status, setStatus] = useState(initialStatus)
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const currentMeeting = useRef(meetingId)
  const requestGeneration = useRef(0)
  currentMeeting.current = meetingId

  useEffect(() => processing.onProgress((next) => { if (next.meetingId === meetingId) { setStatus(next); onStatusChange?.(next) } }), [meetingId, onStatusChange, processing])
  useEffect(() => {
    requestGeneration.current += 1
    setStatus(initialStatus)
    setPending(false)
    setError(null)
  }, [meetingId, initialStatus])

  const active = pending || status.state === 'transcribing' || status.state === 'summarizing'
  const label = status.state === 'transcribing' ? '전사 중'
    : status.state === 'summarizing' ? '요약 중'
      : status.failedStage === 'transcribing' ? '전사 실패'
        : status.failedStage === 'summarizing' ? '요약 실패'
          : status.failedStage === 'cleanup' ? '오디오 정리 실패'
            : status.state === 'completed' ? '처리 완료' : '처리 대기'
  const action = status.failedStage === 'transcribing' ? '전사 다시 시도'
    : status.failedStage === 'summarizing' ? '요약 다시 시도'
      : status.failedStage === 'cleanup' ? '오디오 정리 다시 시도' : '전사 및 요약 시작'

  async function submit() {
    if (active) return
    const requestedMeeting = meetingId
    const generation = ++requestGeneration.current
    setPending(true)
    setError(null)
    try {
      const next = status.failedStage === null ? await processing.process(meetingId) : await processing.retry(meetingId)
      if (currentMeeting.current === requestedMeeting && requestGeneration.current === generation) {
        setStatus(next)
        onStatusChange?.(next)
      }
    } catch (cause) {
      if (currentMeeting.current === requestedMeeting && requestGeneration.current === generation) {
        setError(cause instanceof Error ? cause.message : '처리 요청에 실패했습니다.')
      }
    } finally {
      if (currentMeeting.current === requestedMeeting && requestGeneration.current === generation) {
        setPending(false)
      }
    }
  }

  return <section aria-label="AI 처리 상태">
    <p>{label}</p>
    <p>{status.audioRequired ? '원본 오디오 필요' : '원본 오디오 불필요'}</p>
    {status.error && <p>{status.error.message}</p>}
    {error && <p role="alert">{error}</p>}
    {status.state !== 'completed' && <button type="button" disabled={active || (status.failedStage !== null && !status.retryable)} onClick={() => void submit()}>
      {active ? '처리 중' : action}
    </button>}
  </section>
}
