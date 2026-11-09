import { useCallback, useEffect, useState, type Ref } from 'react'
import type { ClaudeSummary, ClaudeSummaryApi, PublicMeeting } from '../../../../shared/contracts/meetingsApi'
import { InlineNotice } from '../../components/feedback/InlineNotice'
import { ActionBar } from '../../components/layout/ActionBar'
import { PageHeader } from '../../components/layout/PageHeader'
import { Button } from '../../components/ui/Button'

function failureMessage(cause: unknown): string {
  const message = cause instanceof Error ? cause.message : ''
  return message.replace(/^Error invoking remote method '[^']+': (Error: )?/, '') || 'Claude 요약본을 만들지 못했습니다.'
}

export function ClaudeSummaryPage({ meeting, api, headingRef, onBack }: {
  meeting: PublicMeeting
  api: ClaudeSummaryApi
  headingRef?: Ref<HTMLHeadingElement>
  onBack(): void
}) {
  const [summary, setSummary] = useState<ClaudeSummary | null>(null)
  const [generating, setGenerating] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [copied, setCopied] = useState(false)

  const generate = useCallback(async () => {
    setGenerating(true)
    setError(null)
    try {
      setSummary(await api.generate(meeting.id))
    } catch (cause) {
      setError(failureMessage(cause))
    } finally {
      setGenerating(false)
    }
  }, [api, meeting.id])

  useEffect(() => {
    let active = true
    api.get(meeting.id).then((stored) => {
      if (!active) return
      if (stored === null) void generate()
      else setSummary(stored)
    }, (cause: unknown) => { if (active) setError(failureMessage(cause)) })
    return () => { active = false }
  }, [api, meeting.id, generate])

  async function copy() {
    if (summary === null) return
    await navigator.clipboard.writeText(summary.markdown)
    setCopied(true)
  }

  const createdAt = summary === null ? undefined
    : `${new Intl.DateTimeFormat('ko-KR', { dateStyle: 'long', timeStyle: 'short' }).format(new Date(summary.createdAt))}에 만듦`

  return <main className="page-container meeting-page">
    <PageHeader ref={headingRef} eyebrow="CLAUDE 요약본" backLabel={meeting.title} onBack={onBack} title={meeting.title} description={createdAt} />
    <ActionBar>
      <Button icon={generating ? 'processing' : 'retry'} variant="tertiary" disabled={generating} onClick={() => void generate()}>{generating ? '만드는 중' : '다시 만들기'}</Button>
      <Button icon="save" variant="tertiary" disabled={summary === null} onClick={() => void copy()}>{copied ? '복사함' : '복사'}</Button>
    </ActionBar>
    {error === null ? null : <InlineNotice tone="error" title="Claude 요약본을 만들지 못했습니다"><p>{error}</p></InlineNotice>}
    {generating ? <p className="muted" role="status">Claude Code가 회의록을 정리하고 있습니다. 회의 길이에 따라 몇 분 걸릴 수 있습니다.</p> : null}
    {summary === null ? null : <article className="meeting-document" aria-label="Claude 요약본">
      <div className="document-section claude-summary-body">{summary.markdown}</div>
    </article>}
  </main>
}
