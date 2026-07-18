import { useEffect, useRef, useState } from 'react'
import type { ProcessingApi, ProcessingStatus as Status } from '../../../../shared/contracts/processing'
import { InlineNotice } from '../../components/feedback/InlineNotice'
import { Button } from '../../components/ui/Button'
import { Icon } from '../../components/ui/Icon'
import { meetingStatusLabel } from './meetingStatusLabel'

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
  const label = pending ? '회의록 생성 시작 중'
    : status.state === 'transcribing' ? meetingStatusLabel('transcribing')
    : status.state === 'summarizing' ? meetingStatusLabel('summarizing')
      : status.failedStage === 'transcribing' ? '음성 변환 실패'
        : status.failedStage === 'summarizing' ? '회의록 작성 실패'
          : status.failedStage === 'cleanup' ? '원본 오디오 정리 실패'
            : status.state === 'completed' ? meetingStatusLabel('completed') : meetingStatusLabel('recorded')
  const action = status.failedStage === 'transcribing' ? '음성 변환 다시 시도'
    : status.failedStage === 'summarizing' ? '회의록 작성 다시 시도'
      : status.failedStage === 'cleanup' ? '오디오 정리 다시 시도' : '회의록 만들기'
  const tone = status.state === 'completed' ? 'success'
    : active ? 'info'
      : status.failedStage !== null ? (status.retryable ? 'warning' : 'error') : 'info'

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
        setError('처리 요청을 완료하지 못했습니다.')
      }
    } finally {
      if (currentMeeting.current === requestedMeeting && requestGeneration.current === generation) {
        setPending(false)
      }
    }
  }

  return <InlineNotice tone={tone} title="회의록 생성 상태">
    <div className="processing-panel">
      <div className="processing-copy">
        <strong aria-label={status.state === 'completed' ? label : undefined}>{status.state === 'completed' ? <Icon name="success" /> : label}</strong>
        {pending ? <span>회의록 생성을 시작하고 있습니다.</span>
          : status.state === 'transcribing' ? <span>녹음된 음성을 읽을 수 있는 글로 바꾸고 있습니다.</span>
            : status.state === 'summarizing' ? <span>대화 내용으로 회의록을 작성하고 있습니다.</span>
              : status.state === 'recorded' ? <span>녹음이 끝났습니다. 회의록을 만들 수 있습니다.</span>
                : status.state === 'completed' ? <span>음성 변환과 회의록 작성을 모두 마쳤습니다.</span> : null}
        {status.error && <span>{status.retryable ? '일시적인 오류가 발생했습니다. 다시 시도해 주세요.' : '현재 설정으로 다시 처리할 수 없는 오류가 발생했습니다.'}</span>}
      </div>
      {active ? <span className="processing-active" role="status" aria-label="처리 중"><Icon name="processing" />처리 중</span>
        : status.state !== 'completed' && (status.failedStage === null || status.retryable) ? <Button icon={status.failedStage === null ? 'play' : 'retry'} variant="primary" onClick={() => void submit()}>{action}</Button>
          : null}
    </div>
    {error && <p className="processing-error" role="alert">{error}</p>}
  </InlineNotice>
}
