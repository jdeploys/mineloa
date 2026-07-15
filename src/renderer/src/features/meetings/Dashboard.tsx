import type { PublicMeeting } from '../../../../shared/contracts/meetingsApi'
import type { TemplatesApi } from '../../../../shared/contracts/template'
import { RecordingPanel, type RecordingPanelControls } from '../recording/RecordingPanel'

interface DashboardProps {
  meetings: readonly PublicMeeting[]
  recordingControls: RecordingPanelControls
  onOpenMeeting(meetingId: string): void
  onNavigate(destination: 'all' | 'templates' | 'settings', originFocusKey?: string): void
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

export function Dashboard({ meetings, recordingControls, onOpenMeeting, onNavigate, templates, onImport }: DashboardProps) {
  return <div className="app-shell">
    <header className="topbar">
      <button className="brand" type="button" onClick={() => onNavigate('all')} aria-label="Nnote 홈">Nnote</button>
      <nav aria-label="주요 메뉴">
        <button type="button" onClick={() => onNavigate('all')}>전체 기록</button>
        <button type="button" data-focus-key="nav-templates" onClick={() => onNavigate('templates')}>요약 템플릿</button>
        <button type="button" data-focus-key="nav-settings" onClick={() => onNavigate('settings')}>설정</button>
        {onImport !== undefined && <button type="button" onClick={onImport}>.nnote 가져오기</button>}
      </nav>
    </header>
    <main className="dashboard">
      <span className="visually-hidden">Nnote</span>
      <section className="recording-card" aria-labelledby="new-meeting-heading">
        <p className="eyebrow">NEW MEETING</p>
        <h1 id="new-meeting-heading">새 회의</h1>
        <p className="muted">노트북 마이크로 녹음하고 이 기기에 안전하게 저장합니다.</p>
        <RecordingPanel
          controls={recordingControls}
          templates={templates}
          settingsFocusKey="recording-settings"
          onNavigate={() => onNavigate('settings', 'recording-settings')}
        />
      </section>
      <section className="recent-card" aria-labelledby="recent-heading">
        <div className="section-heading">
          <div>
            <p className="eyebrow">LIBRARY</p>
            <h2 id="recent-heading">최근 기록</h2>
          </div>
          <span className="meeting-count">{meetings.length}</span>
        </div>
        {meetings.length === 0 ? <p className="empty-state">최근 기록이 없습니다.</p> :
          <ul className="meeting-list">
            {meetings.map((meeting) => <li key={meeting.id}>
              <button className="meeting-row" data-focus-key={`meeting-${meeting.id}`} type="button" onClick={() => onOpenMeeting(meeting.id)}>
                <span className="meeting-copy">
                  <strong>{meeting.title}</strong>
                  <span>{formatDate(meeting.createdAt)} · {formatDuration(meeting.durationMs)}</span>
                </span>
                <span className={`status status-${meeting.status}`}>{meeting.status}</span>
              </button>
            </li>)}
          </ul>}
      </section>
    </main>
  </div>
}
