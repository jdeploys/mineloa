import { useRef, useState, type FormEvent } from 'react'
import type { MeetingSearchInput, PublicMeeting } from '../../../../shared/contracts/meetingsApi'
import type { TemplatesApi } from '../../../../shared/contracts/template'
import { EmptyState } from '../../components/feedback/EmptyState'
import { Button } from '../../components/ui/Button'
import { StatusBadge } from '../../components/ui/StatusBadge'
import { SurfaceCard } from '../../components/ui/SurfaceCard'
import { Icon, type IconName } from '../../components/ui/Icon'
import { RecordingPanel, type RecordingPanelControls } from '../recording/RecordingPanel'
import { meetingStatusLabel } from './meetingStatusLabel'

interface DashboardProps {
  meetings: readonly PublicMeeting[]
  recordingControls: RecordingPanelControls
  onOpenMeeting(meetingId: string): void
  onNavigate(destination: 'all' | 'templates' | 'settings', originFocusKey?: string): void
  onSearch?(input: MeetingSearchInput): Promise<PublicMeeting[]>
  templates?: TemplatesApi
  onImport?(): void
}

function formatDate(value: string): string {
  return new Intl.DateTimeFormat('ko-KR', { dateStyle: 'medium' }).format(new Date(value))
}

function formatDuration(durationMs: number): string {
  const minutes = Math.floor(durationMs / 60_000)
  const seconds = Math.floor((durationMs % 60_000) / 1_000)
  return `${minutes}:${String(seconds).padStart(2, '0')}`
}

function statusTone(status: PublicMeeting['status']): 'success' | 'warning' | 'danger' | 'active' {
  if (status === 'completed' || status === 'recorded') return 'success'
  if (status === 'failed') return 'danger'
  if (status === 'recording') return 'active'
  return 'warning'
}

function statusIcon(status: PublicMeeting['status']): IconName {
  if (status === 'completed' || status === 'recorded') return 'success'
  if (status === 'failed') return 'error'
  if (status === 'recording') return 'recording'
  return 'warning'
}

function localDayStart(value: string): string {
  return new Date(`${value}T00:00:00`).toISOString()
}

function localDayEndExclusive(value: string): string {
  const date = new Date(`${value}T00:00:00`)
  date.setDate(date.getDate() + 1)
  return date.toISOString()
}

export function Dashboard({ meetings, recordingControls, onOpenMeeting, onNavigate, onSearch, templates }: DashboardProps) {
  const [query, setQuery] = useState('')
  const [fromDate, setFromDate] = useState('')
  const [toDate, setToDate] = useState('')
  const [searchResults, setSearchResults] = useState<PublicMeeting[] | null>(null)
  const [searching, setSearching] = useState(false)
  const [searchError, setSearchError] = useState<string | null>(null)
  const searchRequest = useRef(0)
  const visibleMeetings = searchResults ?? meetings

  async function runSearch(nextQuery: string, nextFromDate: string, nextToDate: string) {
    if (onSearch === undefined) return
    if (nextFromDate !== '' && nextToDate !== '' && nextFromDate > nextToDate) {
      searchRequest.current += 1
      setSearchError('시작일은 종료일보다 늦을 수 없습니다.')
      setSearching(false)
      return
    }
    if (nextQuery.trim() === '' && nextFromDate === '' && nextToDate === '') {
      searchRequest.current += 1
      setSearchResults(null)
      setSearchError(null)
      setSearching(false)
      return
    }
    const requestId = ++searchRequest.current
    setSearching(true)
    setSearchError(null)
    try {
      const results = await onSearch({
        query: nextQuery.trim(),
        from: nextFromDate === '' ? null : localDayStart(nextFromDate),
        toExclusive: nextToDate === '' ? null : localDayEndExclusive(nextToDate),
      })
      if (requestId === searchRequest.current) setSearchResults(results)
    } catch {
      if (requestId === searchRequest.current) setSearchError('기록을 검색하지 못했습니다. 다시 시도해 주세요.')
    } finally {
      if (requestId === searchRequest.current) setSearching(false)
    }
  }

  async function submitSearch(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    await runSearch(query, fromDate, toDate)
  }

  function changeFromDate(value: string) {
    setFromDate(value)
    void runSearch(query, value, toDate)
  }

  function changeToDate(value: string) {
    setToDate(value)
    void runSearch(query, fromDate, value)
  }

  function resetSearch() {
    searchRequest.current += 1
    setQuery('')
    setFromDate('')
    setToDate('')
    setSearchResults(null)
    setSearchError(null)
  }

  return <main className="dashboard page-container">
      <span className="visually-hidden">Mineloa</span>
      <SurfaceCard className="new-meeting-card" labelledBy="new-meeting-heading">
        <header className="card-heading">
          <p className="eyebrow">NEW MEETING</p>
          <h1 id="new-meeting-heading">새 회의</h1>
          <p>노트북 마이크로 녹음하고 이 기기에 안전하게 저장합니다.</p>
        </header>
        <RecordingPanel
          controls={recordingControls}
          templates={templates}
          settingsFocusKey="recording-settings"
          onNavigate={() => onNavigate('settings', 'recording-settings')}
        />
      </SurfaceCard>
      <SurfaceCard className="recent-card" labelledBy="recent-heading">
        <header className="section-heading">
          <div>
            <p className="eyebrow">LIBRARY</p>
            <h2 id="recent-heading">최근 기록</h2>
          </div>
          <span className="meeting-count">{visibleMeetings.length}</span>
        </header>
        {onSearch === undefined ? null : <form className="meeting-search" onSubmit={(event) => void submitSearch(event)}>
          <label className="meeting-search-keyword">
            <span>키워드</span>
            <input type="search" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="제목 또는 내용" />
          </label>
          <div className="meeting-search-dates">
            <label>
              <span>시작일</span>
              <input type="date" value={fromDate} onChange={(event) => changeFromDate(event.target.value)} />
            </label>
            <span aria-hidden="true">–</span>
            <label>
              <span>종료일</span>
              <input type="date" value={toDate} onChange={(event) => changeToDate(event.target.value)} />
            </label>
          </div>
          <div className="meeting-search-actions">
            {(query !== '' || fromDate !== '' || toDate !== '' || searchResults !== null) &&
              <Button type="button" variant="tertiary" onClick={resetSearch}>초기화</Button>}
            <Button type="submit" disabled={searching}>{searching ? '검색 중' : '검색'}</Button>
          </div>
        </form>}
        {searchError === null ? null : <p className="meeting-search-error" role="alert">{searchError}</p>}
        {visibleMeetings.length === 0 ? <EmptyState
          title={searchResults === null ? '최근 기록이 없습니다.' : '검색 결과가 없습니다.'}
          description={searchResults === null ? '첫 회의를 녹음하면 여기에 안전하게 모입니다.' : '다른 키워드나 날짜로 다시 검색해 보세요.'}
        /> :
          <ul className="meeting-list">
            {visibleMeetings.map((meeting) => <li key={meeting.id}>
              <button className="meeting-row" data-focus-key={`meeting-${meeting.id}`} type="button" onClick={() => onOpenMeeting(meeting.id)}>
                <span className="meeting-copy">
                  <strong>{meeting.title}</strong>
                  <span>{formatDate(meeting.createdAt)} · {formatDuration(meeting.durationMs)}</span>
                </span>
                <span className="meeting-row-end">
                  <StatusBadge label={meetingStatusLabel(meeting.status)} tone={statusTone(meeting.status)} icon={statusIcon(meeting.status)} iconOnly={meeting.status === 'completed'} />
                  <Icon name="forward" />
                </span>
              </button>
            </li>)}
          </ul>}
      </SurfaceCard>
    </main>
}
