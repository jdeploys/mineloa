import React from 'react'
import { createRoot } from 'react-dom/client'
import '../../../src/renderer/src/styles/tokens.css'
import '../../../src/renderer/src/styles/app.css'
import './visual.css'
import { Dashboard } from '../../../src/renderer/src/features/meetings/Dashboard'
import { MeetingDetail } from '../../../src/renderer/src/features/meetings/MeetingDetail'

const now = '2026-07-15T00:00:00.000Z'
const meeting = (id: string, title: string, status: 'completed' | 'recorded' | 'failed' | 'recoverable') => ({ id, title, status, createdAt: now, updatedAt: now, durationMs: 3_845_000, audioPolicy: 'keep' as const, hasAudio: status === 'completed', audioByteCount: 12_000, selectedTemplateId: null })
const controls = { start: async () => {}, stop: async () => {}, discard: async () => {}, pause: async () => {}, resume: async () => {} }
const templates = { list: async () => [{ id: 'default', name: '기본 템플릿', isDefault: true, sections: [{ id: '10000000-0000-4000-8000-000000000001', title: '핵심 요약', kind: 'paragraph' as const, prompt: '요약' }], createdAt: now, updatedAt: now }], create: async () => { throw new Error() }, update: async () => { throw new Error() }, reorderSections: async () => { throw new Error() }, delete: async () => {} }
const archive = { exportMeeting: async () => ({ status: 'cancelled' as const }), exportMarkdown: async () => ({ status: 'cancelled' as const }), importMeeting: async () => ({ status: 'cancelled' as const }) }
const processing = { getStatus: async () => ({ meetingId: 'meeting-1', state: 'completed' as const, failedStage: null, retryable: false, audioRequired: false, error: null }), process: async () => ({ meetingId: 'meeting-1', state: 'completed' as const, failedStage: null, retryable: false, audioRequired: false, error: null }), retry: async () => ({ meetingId: 'meeting-1', state: 'completed' as const, failedStage: null, retryable: false, audioRequired: false, error: null }), onProgress: () => () => {} }
const state = new URLSearchParams(location.search).get('state') ?? 'idle'
const common = state === 'failed' ? [meeting('failed', '주간 운영 회의', 'failed'), meeting('done', '제품 방향성 회의', 'completed')]
  : state === 'recoverable' ? [meeting('recover', '중단된 고객 인터뷰', 'recoverable'), meeting('done', '제품 방향성 회의', 'completed')]
    : [meeting('done', '제품 방향성 회의', 'completed'), meeting('recorded', '디자인 리뷰', 'recorded')]
const detail = {
  meeting: meeting('meeting-1', '제품 방향성 회의', 'completed'), audioUrl: 'nnote-media://meeting/bWVldGluZy0x',
  speakers: [{ id: '0:A', meetingId: 'meeting-1', displayName: '수현' }, { id: '0:B', meetingId: 'meeting-1', displayName: '민지' }],
  transcript: [
    { id: '1', meetingId: 'meeting-1', speakerId: '0:A', startMs: 12_000, endMs: 29_000, text: '온보딩에서 사용자가 가치를 더 빨리 경험하도록 첫 화면을 단순화하면 좋겠습니다.' },
    { id: '2', meetingId: 'meeting-1', speakerId: '0:B', startMs: 31_000, endMs: 48_000, text: '다음 주까지 두 가지 흐름을 비교할 수 있는 초안을 준비하겠습니다.' },
  ],
  summarySections: [
    { id: 'a', title: '핵심 요약', meetingId: 'meeting-1', templateSectionId: '10000000-0000-4000-8000-000000000001', kind: 'paragraph' as const, text: '온보딩 흐름을 단순화하고 핵심 가치를 앞당겨 보여주기로 했습니다.', items: [], orderIndex: 0 },
    { id: 'b', title: '결정사항', meetingId: 'meeting-1', templateSectionId: '10000000-0000-4000-8000-000000000002', kind: 'bullet_list' as const, text: '', items: ['첫 화면의 선택지를 세 개에서 하나로 줄입니다.'], orderIndex: 1 },
    { id: 'action', title: '할 일', meetingId: 'meeting-1', templateSectionId: '10000000-0000-4000-8000-000000000003', kind: 'action_items' as const, text: '', items: [], orderIndex: 2 },
    { id: 'c', title: '주요 논의', meetingId: 'meeting-1', templateSectionId: '10000000-0000-4000-8000-000000000004', kind: 'bullet_list' as const, text: '', items: ['초기 이탈 지표와 첫 가치 도달 시간을 함께 확인합니다.'], orderIndex: 3 },
  ],
  actionItems: [{ id: 'x', meetingId: 'meeting-1', content: '온보딩 흐름 초안 작성', assigneeSpeakerId: '0:B', dueAt: null, completed: false }],
}
const view = state === 'completed'
  ? <MeetingDetail document={detail} archive={archive} processing={processing} initialProcessingStatus={{ meetingId: 'meeting-1', state: 'completed', failedStage: null, retryable: false, audioRequired: false, error: null }} onBack={() => {}} onRenameSpeaker={async () => detail.speakers[1]} />
  : <Dashboard meetings={state === 'idle' ? [] : common} recordingControls={controls} templates={templates} onImport={() => {}} onOpenMeeting={() => {}} onNavigate={() => {}} />
createRoot(document.getElementById('root')!).render(view)
