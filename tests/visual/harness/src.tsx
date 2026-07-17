import React from 'react'
import { createRoot } from 'react-dom/client'
import '@fontsource-variable/inter/index.css'
import '../../../src/renderer/src/styles/tokens.css'
import '../../../src/renderer/src/styles/themes.css'
import '../../../src/renderer/src/styles/globals.css'
import '../../../src/renderer/src/styles/app.css'
import './visual.css'
import { App } from '../../../src/renderer/src/App'
import type { DesktopApi } from '../../../src/shared/contracts/desktopApi'
import type { MeetingDocument, PublicMeeting } from '../../../src/shared/contracts/meetingsApi'
import type { RecordingSnapshot } from '../../../src/renderer/src/features/recording/mediaRecorderController'

const now = '2026-07-15T00:00:00.000Z'
const meeting = (id: string, title: string, status: 'completed' | 'recorded' | 'failed' | 'recoverable') => ({ id, title, status, createdAt: now, updatedAt: now, durationMs: 3_845_000, audioPolicy: 'keep' as const, hasAudio: status === 'completed', audioByteCount: 12_000, selectedTemplateId: null })
const templateItems = [
  { id: 'interview', name: '고객 인터뷰', isDefault: false, sections: [
    { id: '20000000-0000-4000-8000-000000000001', title: '고객의 문제', kind: 'paragraph' as const, prompt: '고객이 겪는 핵심 문제를 요약하세요.' },
    { id: '20000000-0000-4000-8000-000000000002', title: '인사이트', kind: 'bullet_list' as const, prompt: '새롭게 발견한 인사이트를 정리하세요.' },
    { id: '20000000-0000-4000-8000-000000000003', title: '후속 작업', kind: 'action_items' as const, prompt: '담당자가 있는 후속 작업을 추출하세요.' },
  ], createdAt: now, updatedAt: now },
  { id: 'default', name: '기본 템플릿', isDefault: true, sections: [{ id: '10000000-0000-4000-8000-000000000001', title: '핵심 요약', kind: 'paragraph' as const, prompt: '요약' }], createdAt: now, updatedAt: now },
]
let fixtureTemplateItems = templateItems
const templates = {
  list: async () => fixtureTemplateItems,
  create: async (input: { name: string; sections: Array<{ title: string; kind: 'paragraph' | 'bullet_list' | 'action_items'; prompt: string }> }) => {
    if (fixtureState === 'templates-create-pending') await new Promise<never>(() => undefined)
    const created = {
      id: 'new-template', name: input.name, isDefault: false,
      sections: input.sections.map((section, index) => ({
        ...section,
        id: `30000000-0000-4000-8000-${String(index + 1).padStart(12, '0')}`,
      })),
      createdAt: now, updatedAt: now,
    }
    fixtureTemplateItems = [...fixtureTemplateItems, created]
    return created
  },
  update: async (id: string, input: { name?: string; sections?: typeof templateItems[number]['sections'] }) => {
    if (fixtureState === 'templates-save-pending') await new Promise<never>(() => undefined)
    const current = fixtureTemplateItems.find((item) => item.id === id)!
    const updated = { ...current, ...input, updatedAt: now }
    fixtureTemplateItems = fixtureTemplateItems.map((item) => item.id === id ? updated : item)
    return updated
  },
  reorderSections: async (id: string, orderedSectionIds: string[]) => {
    if (fixtureState === 'templates-reorder-pending') await new Promise<never>(() => undefined)
    const current = fixtureTemplateItems.find((item) => item.id === id)!
    const byId = new Map(current.sections.map((section) => [section.id, section]))
    const updated = { ...current, sections: orderedSectionIds.map((sectionId) => byId.get(sectionId)!), updatedAt: now }
    fixtureTemplateItems = fixtureTemplateItems.map((item) => item.id === id ? updated : item)
    return updated
  },
  delete: async (id: string) => {
    if (fixtureState === 'templates-delete-pending') await new Promise<never>(() => undefined)
    fixtureTemplateItems = fixtureTemplateItems.filter((item) => item.id !== id)
  },
}
const fixtureState = new URLSearchParams(location.search).get('state') ?? 'idle'
const fixtureTheme = new URLSearchParams(location.search).get('theme')
if (fixtureTheme === 'light' || fixtureTheme === 'dark') localStorage.setItem('nnote.theme', fixtureTheme)
else localStorage.removeItem('nnote.theme')

const providerSettings = fixtureState.startsWith('whisper-')
  ? { transcriptionProvider: 'local_whisper' as const, summaryProvider: 'openai' as const, localWhisperModel: 'base' as const }
  : fixtureState.startsWith('codex-')
    ? { transcriptionProvider: 'openai' as const, summaryProvider: 'codex_cli' as const, localWhisperModel: 'base' as const }
    : { transcriptionProvider: 'openai' as const, summaryProvider: 'openai' as const, localWhisperModel: 'base' as const }
const providerDescriptors = [
  { id: 'openai' as const, stage: 'transcription' as const, displayName: 'OpenAI API', availability: { available: true, code: null, message: null }, privacy: 'audio_cloud' as const, capabilities: ['api_key', 'speaker_diarization'] as const },
  { id: 'local_whisper' as const, stage: 'transcription' as const, displayName: '로컬 Whisper', availability: { available: fixtureState !== 'whisper-downloading', code: fixtureState === 'whisper-downloading' ? 'LOCAL_WHISPER_MODEL_UNAVAILABLE' : null, message: null }, privacy: 'local' as const, capabilities: ['model_manager'] as const },
  { id: 'openai' as const, stage: 'summary' as const, displayName: 'OpenAI API', availability: { available: true, code: null, message: null }, privacy: 'text_cloud' as const, capabilities: ['api_key'] as const },
  { id: 'codex_cli' as const, stage: 'summary' as const, displayName: 'Codex CLI', availability: fixtureState !== 'codex-unavailable' && fixtureState !== 'codex-refresh-pending' ? { available: true, code: null, message: null } : { available: false, code: 'CODEX_CONFIG_INVALID', message: null }, privacy: 'text_cloud' as const, capabilities: ['cli_status'] as const },
]
const baseBytes = 147_951_465
let descriptorLoadCount = 0
const settings = {
  getApiKeyStatus: async () => ({ configured: true, lastValidatedAt: '2026-07-14T08:30:00.000Z' }),
  saveApiKey: async () => {},
  deleteApiKey: async () => {},
  getProcessingProviders: async () => providerSettings,
  updateProcessingProviders: async (input: { transcriptionProvider: 'openai' | 'local_whisper'; summaryProvider: 'openai' | 'codex_cli'; localWhisperModel: 'base' | 'small' }) => input,
  listProcessingProviderDescriptors: async () => {
    descriptorLoadCount += 1
    if (fixtureState === 'codex-refresh-pending' && descriptorLoadCount > 1) await new Promise<never>(() => undefined)
    return providerDescriptors
  },
  listWhisperModels: async () => [
    { modelId: 'base' as const, state: fixtureState === 'whisper-installed' ? 'installed' as const : fixtureState === 'whisper-downloading' ? 'downloading' as const : 'not_installed' as const, expectedBytes: baseBytes, receivedBytes: fixtureState === 'whisper-downloading' ? 73_975_732 : fixtureState === 'whisper-installed' ? baseBytes : 0, error: null },
    { modelId: 'small' as const, state: 'not_installed' as const, expectedBytes: 487_601_967, receivedBytes: 0, error: null },
  ],
  downloadWhisperModel: async () => { throw new Error() },
  deleteWhisperModel: async () => { throw new Error() },
  onWhisperModelProgress: (listener: (progress: { modelId: 'base' | 'small'; receivedBytes: number; totalBytes: number }) => void) => {
    if (fixtureState === 'whisper-downloading') queueMicrotask(() => listener({ modelId: 'base', receivedBytes: 73_975_732, totalBytes: baseBytes }))
    return () => {}
  },
}
const archive = { exportMeeting: async () => ({ status: 'cancelled' as const }), exportMarkdown: async () => ({ status: 'cancelled' as const }), importMeeting: async () => ({ status: 'cancelled' as const }) }
const processing = { getStatus: async () => ({ meetingId: 'meeting-1', state: 'completed' as const, failedStage: null, retryable: false, audioRequired: false, error: null }), process: async () => ({ meetingId: 'meeting-1', state: 'completed' as const, failedStage: null, retryable: false, audioRequired: false, error: null }), retry: async () => ({ meetingId: 'meeting-1', state: 'completed' as const, failedStage: null, retryable: false, audioRequired: false, error: null }), onProgress: () => () => {} }
const common = fixtureState === 'failed' ? [meeting('failed', '주간 운영 회의', 'failed'), meeting('done', '제품 방향성 회의', 'completed')]
  : fixtureState === 'recoverable' ? [meeting('recover', '중단된 고객 인터뷰', 'recoverable'), meeting('done', '제품 방향성 회의', 'completed')]
    : [meeting('done', '제품 방향성 회의', 'completed'), meeting('recorded', '디자인 리뷰', 'recorded')]
const detail: MeetingDocument = {
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

function desktopApiFor(state: string): DesktopApi {
  const meetings = state === 'completed'
    ? [detail.meeting]
    : state === 'idle'
      ? []
      : common

  return {
    settings,
    templates,
    processing,
    archive,
    meetings: {
      list: async () => meetings as PublicMeeting[],
      get: async () => detail,
      createRecording: async (input) => ({
        ...meeting('active-meeting', input.title, 'recorded'),
        audioPolicy: input.audioPolicy ?? 'delete_after_processing',
        selectedTemplateId: input.selectedTemplateId ?? null,
      }),
      renameSpeaker: async (_meetingId, speakerId, displayName) => ({
        id: speakerId,
        meetingId: detail.meeting.id,
        displayName,
      }),
    },
    recording: {
      start: async () => ({ totalBytes: 0, durationMs: 0, warn: false, rolledToPartIndex: null, activePartIndex: 0, nextChunkIndex: 0 }),
      cancelStart: async () => {},
      appendChunk: async () => ({ totalBytes: 0, durationMs: 0, warn: false, rolledToPartIndex: null, activePartIndex: 0, nextChunkIndex: 1 }),
      pause: async () => {},
      resume: async () => ({ totalBytes: 0, durationMs: 0, warn: false, rolledToPartIndex: null, activePartIndex: 0, nextChunkIndex: 1 }),
      stop: async () => {},
      discard: async () => {},
    },
    recovery: {
      scan: async () => fixtureState === 'recovery-dialog'
        ? [{ meetingId: 'recover-startup', createdAt: now, durationMs: 184_000, byteCount: 8_388_608, kind: 'recoverable' as const }]
        : [],
      recover: async () => ({ totalBytes: 0, durationMs: 0, warn: false, rolledToPartIndex: null, activePartIndex: 0, nextChunkIndex: 0 }),
      suspend: async () => {},
      keepAsFile: async () => {},
      exportOnly: async () => ({ status: 'cancelled' }),
      discard: async () => {},
    },
  }
}

function recordingControllerFor(_state: string) {
  const listeners = new Set<(snapshot: RecordingSnapshot) => void>()
  let snapshot: RecordingSnapshot = {
    phase: 'idle', meetingId: null, durationMs: 0, totalBytes: 0, warn: false,
    activePartIndex: 0, partCount: 0, microphone: 'inactive', localSave: 'idle',
  }
  const publish = (patch: Partial<RecordingSnapshot>) => {
    snapshot = { ...snapshot, ...patch }
    for (const listener of listeners) listener(snapshot)
  }
  const reset = () => publish({
    phase: 'idle', meetingId: null, durationMs: 0, totalBytes: 0, warn: false,
    activePartIndex: 0, partCount: 0, microphone: 'inactive', localSave: 'idle',
  })

  return {
    subscribe(listener: (snapshot: RecordingSnapshot) => void) {
      listeners.add(listener)
      listener(snapshot)
      return () => listeners.delete(listener)
    },
    start: async (meetingId: string) => publish({
      phase: 'recording', meetingId, durationMs: 75_000, totalBytes: 1_572_864,
      activePartIndex: 0, partCount: 1, microphone: 'active', localSave: 'saved',
    }),
    stop: async () => reset(),
    discard: async () => reset(),
    pause: async () => publish({ phase: 'paused', microphone: 'paused' }),
    resume: async () => publish({ phase: 'recording', microphone: 'active' }),
  }
}

const fixtureApi = desktopApiFor(fixtureState)
const fixtureController = recordingControllerFor(fixtureState)

createRoot(document.getElementById('root')!).render(
  <App desktopApi={fixtureApi} recordingController={fixtureController} />,
)
