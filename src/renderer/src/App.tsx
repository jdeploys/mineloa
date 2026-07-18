import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { DesktopApi } from '../../shared/contracts/desktopApi'
import type { MeetingDocument, PublicMeeting } from '../../shared/contracts/meetingsApi'
import type { RecoveryItem } from '../../shared/contracts/recovery'
import type { ProcessingStatus as ProcessingStatusValue } from '../../shared/contracts/processing'
import type { AudioPolicy } from '../../shared/contracts/meeting'
import { AppShell } from './components/layout/AppShell'
import { PageHeader } from './components/layout/PageHeader'
import { Dashboard } from './features/meetings/Dashboard'
import { MeetingDetail } from './features/meetings/MeetingDetail'
import {
  MediaRecorderController,
  RecordingTerminalError,
} from './features/recording/mediaRecorderController'
import { RecoveryDialog } from './features/recording/RecoveryDialog'
import { RecordingPanel } from './features/recording/RecordingPanel'
import { AppearanceSettings } from './features/settings/AppearanceSettings'
import { ApiKeySettings } from './features/settings/ApiKeySettings'
import { MeetingRecordSettings } from './features/settings/MeetingRecordSettings'
import { ProcessingProviderSettings } from './features/settings/ProcessingProviderSettings'
import { TemplateEditor } from './features/templates/TemplateEditor'
import { useThemePreference } from './hooks/useThemePreference'

type Screen = 'all' | 'templates' | 'settings' | 'detail'
type RecordingControllerPort = Pick<MediaRecorderController, 'start' | 'stop' | 'discard'> & Partial<Pick<MediaRecorderController, 'pause' | 'resume' | 'subscribe' | 'resumeRecovered' | 'listMicrophones'>>

export function App({
  desktopApi = window.desktopApi,
  recordingController,
}: {
  desktopApi?: DesktopApi
  recordingController?: RecordingControllerPort
} = {}) {
  const [recoveries, setRecoveries] = useState<RecoveryItem[] | null>(null)
  const [meetings, setMeetings] = useState<PublicMeeting[]>([])
  const [document, setDocument] = useState<MeetingDocument | null>(null)
  const [processingStatus, setProcessingStatus] = useState<ProcessingStatusValue | null>(null)
  const [recoveredActive, setRecoveredActive] = useState(false)
  const [screen, setScreen] = useState<Screen>('all')
  const [error, setError] = useState<string | null>(null)
  const [archiveNotice, setArchiveNotice] = useState<string | null>(null)
  const routeHeading = useRef<HTMLHeadingElement>(null)
  const returnFocusKey = useRef<string | null>(null)
  const { preference, setPreference } = useThemePreference()
  const controller = useMemo(
    () => recordingController ?? new MediaRecorderController(desktopApi.recording),
    [desktopApi, recordingController],
  )

  const refreshMeetings = useCallback(async () => {
    if (desktopApi.meetings === undefined) return
    setMeetings(await desktopApi.meetings.list())
  }, [desktopApi])

  useEffect(() => {
    if (controller.subscribe === undefined) return
    let activeMeeting: string | null = null
    return controller.subscribe((snapshot) => {
      if (snapshot.meetingId !== null) activeMeeting = snapshot.meetingId
      if (snapshot.phase === 'idle' && snapshot.meetingId === null && activeMeeting !== null) {
        activeMeeting = null
        setRecoveredActive(false)
        void refreshMeetings()
      }
    })
  }, [controller, refreshMeetings])

  useEffect(() => {
    let current = true
    void desktopApi.recovery.scan().then(async (items) => {
      if (!current) return
      setRecoveries(items)
      await refreshMeetings()
    }).catch((cause) => {
      if (current) setError(cause instanceof Error ? cause.message : '중단된 녹음을 확인하지 못했습니다.')
    })
    return () => { current = false }
  }, [desktopApi, refreshMeetings])

  useEffect(() => {
    if (screen !== 'all') {
      globalThis.scrollTo?.({ top: 0, left: 0, behavior: 'auto' })
      routeHeading.current?.focus({ preventScroll: true })
      return
    }
    const key = returnFocusKey.current
    if (key === null) return
    documentQuery(`[data-focus-key="${key.replace(/["\\]/g, '')}"]`)?.focus()
    returnFocusKey.current = null
  }, [screen])

  const recordingControls = useMemo(() => ({
    start: async (options?: { selectedTemplateId: string; audioPolicy: AudioPolicy; microphoneDeviceId: string | null; farFieldMode: boolean }) => {
      const created = await desktopApi.meetings.createRecording({
        title: `새 회의 ${new Intl.DateTimeFormat('ko-KR', { dateStyle: 'medium' }).format(new Date())}`,
        audioPolicy: options?.audioPolicy ?? 'delete_after_processing', selectedTemplateId: options?.selectedTemplateId ?? 'default',
      })
      try {
        await controller.start(created.id, {
          microphoneDeviceId: options?.microphoneDeviceId ?? null,
          farFieldMode: options?.farFieldMode ?? true,
        })
      } catch (startError) {
        if (startError instanceof RecordingTerminalError && startError.state === 'capture_failed') {
          await refreshMeetings()
          throw startError
        }
        try {
          await desktopApi.recording.cancelStart(created.id)
        } catch (cleanupError) {
          throw new AggregateError([startError, cleanupError], '녹음 시작 실패 후 빈 기록을 정리하지 못했습니다.')
        } finally {
          await refreshMeetings()
        }
        throw startError
      }
      await refreshMeetings()
    },
    stop: async () => { await controller.stop(); setRecoveredActive(false); await refreshMeetings() },
    discard: async () => { await controller.discard(); setRecoveredActive(false); await refreshMeetings() },
    pause: async () => { await controller.pause?.() },
    resume: async () => { await controller.resume?.() },
    subscribe: controller.subscribe === undefined ? undefined : controller.subscribe.bind(controller),
    listMicrophones: controller.listMicrophones === undefined ? undefined : controller.listMicrophones.bind(controller),
  }), [controller, desktopApi, refreshMeetings])

  function navigate(destination: 'all' | 'templates' | 'settings', originFocusKey?: string) {
    if (destination !== 'all') returnFocusKey.current = originFocusKey ?? `nav-${destination}`
    setScreen(destination)
  }

  async function openMeeting(meetingId: string) {
    try {
      returnFocusKey.current = `meeting-${meetingId}`
      const [nextDocument, nextStatus] = await Promise.all([
        desktopApi.meetings.get(meetingId), desktopApi.processing.getStatus(meetingId),
      ])
      setDocument(nextDocument)
      setProcessingStatus(nextStatus)
      setScreen('detail')
      setError(null)
    } catch (cause) {
      returnFocusKey.current = null
      setError(cause instanceof Error ? cause.message : '회의 기록을 열지 못했습니다.')
    }
  }

  async function refreshOpenMeeting() {
    if (document === null) return
    const [nextDocument, nextStatus] = await Promise.all([
      desktopApi.meetings.get(document.meeting.id), desktopApi.processing.getStatus(document.meeting.id),
    ])
    setDocument(nextDocument)
    setProcessingStatus(nextStatus)
    await refreshMeetings()
  }

  async function renameOpenMeeting(meetingId: string, title: string) {
    const updated = await desktopApi.meetings.renameMeeting(meetingId, title)
    setDocument((current) => current?.meeting.id === meetingId
      ? { ...current, meeting: updated }
      : current)
    setMeetings((current) => current.map((meeting) => meeting.id === meetingId ? updated : meeting))
    return updated
  }

  async function importMeeting() {
    setArchiveNotice(null)
    try {
      const result = await desktopApi.archive.importMeeting()
      if (result.status === 'failure') { setArchiveNotice(result.message); return }
      if (result.status === 'success' && result.meetingId !== undefined) {
        await refreshMeetings()
        await openMeeting(result.meetingId)
      }
    } catch (cause) {
      setArchiveNotice(cause instanceof Error ? cause.message : '회의 기록을 가져오지 못했습니다.')
    }
  }

  async function recoverCapture(meetingId: string) {
    const progress = await desktopApi.recovery.recover(meetingId)
    try {
      if (controller.resumeRecovered === undefined) throw new Error('복구 녹음 연결을 지원하지 않습니다.')
      await controller.resumeRecovered(meetingId, progress)
      setRecoveredActive(true)
    } catch (cause) {
      await desktopApi.recovery.suspend(meetingId)
      throw cause
    }
  }

  function backToAll() { setScreen('all') }

  if (error !== null) return <main className="document-shell" role="alert">복구 또는 기록 확인에 실패했습니다. 새 녹음을 시작하지 않았습니다: {error}</main>
  if (recoveries === null) return <main className="document-shell" aria-busy="true">복구 확인 중</main>
  if (recoveries.length > 0) return <>
    <RecoveryDialog
      items={recoveries}
      recovery={desktopApi.recovery}
      recoverDisabled={recoveredActive}
      onRecover={recoverCapture}
      onResolved={(meetingId) => {
        setRecoveries((items) => items?.filter((item) => item.meetingId !== meetingId) ?? [])
        void refreshMeetings()
      }}
    />
    {recoveredActive && <RecordingPanel controls={recordingControls} templates={desktopApi.templates} onNavigate={() => undefined} />}
  </>

  const activeNavigation = screen === 'templates' || screen === 'settings' ? screen : 'all'

  return <AppShell active={activeNavigation} onNavigate={navigate}>
    <div hidden={screen !== 'all'}>
      <Dashboard
        meetings={meetings}
        recordingControls={recordingControls}
        templates={desktopApi.templates}
        onSearch={(input) => desktopApi.meetings.search(input)}
        onOpenMeeting={(id) => void openMeeting(id)}
        onNavigate={navigate}
      />
    </div>
    {screen === 'settings' && <main className="page-container settings-page">
      <PageHeader ref={routeHeading} eyebrow="SETTINGS" title="설정" description="Mineloa가 기록과 AI 처리를 사용하는 방식을 관리합니다." backLabel="전체 기록" onBack={backToAll} />
      <AppearanceSettings preference={preference} onChange={setPreference} />
      <ApiKeySettings settings={desktopApi.settings} />
      <ProcessingProviderSettings settings={desktopApi.settings} />
      <MeetingRecordSettings
        error={archiveNotice}
        onImport={() => void importMeeting()}
        onDismissError={() => setArchiveNotice(null)}
      />
    </main>}
    {screen === 'detail' && document !== null && <MeetingDetail
      document={document}
      headingRef={routeHeading}
      onBack={backToAll}
      onRenameMeeting={renameOpenMeeting}
      onRenameSpeaker={desktopApi.meetings.renameSpeaker}
      processing={desktopApi.processing}
      initialProcessingStatus={processingStatus ?? undefined}
      archive={desktopApi.archive}
      onRefresh={refreshOpenMeeting}
    />}
    {screen === 'templates' && <main className="page-container template-page">
      <PageHeader ref={routeHeading} eyebrow="TEMPLATES" title="요약 템플릿" description="회의 종류에 맞는 요약 구조와 지시문을 관리합니다." backLabel="전체 기록" onBack={backToAll} />
      <TemplateEditor templates={desktopApi.templates} />
    </main>}
  </AppShell>
}

function documentQuery(selector: string): HTMLElement | null {
  return globalThis.document?.querySelector<HTMLElement>(selector) ?? null
}
