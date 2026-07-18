// @vitest-environment jsdom

import '@testing-library/jest-dom/vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { MeetingDocument } from '../../src/shared/contracts/meetingsApi'
import { MeetingDetail } from '../../src/renderer/src/features/meetings/MeetingDetail'

const documentFixture = (): MeetingDocument => ({
  meeting: {
    id: 'meeting-1', title: '제품 회의', status: 'completed',
    createdAt: '2026-07-15T00:00:00.000Z', updatedAt: '2026-07-15T00:01:00.000Z',
    durationMs: 65_000, audioPolicy: 'keep', hasAudio: true,
    audioByteCount: 10, selectedTemplateId: 'default',
  },
  audioUrl: 'nnote-media://meeting/bWVldGluZy0x',
  speakers: [{ id: '0:B', meetingId: 'meeting-1', displayName: '화자 B' }],
  transcript: [{ id: 's1', meetingId: 'meeting-1', speakerId: '0:B', startMs: 1_000, endMs: 2_500, text: '원본 발언입니다.' }],
  summarySections: [
    { id: 'a', title: '핵심 요약', meetingId: 'meeting-1', templateSectionId: '10000000-0000-4000-8000-000000000001', kind: 'paragraph', text: '0:B가 제안을 설명했습니다.', items: [], orderIndex: 0 },
    { id: 'b', title: '결정사항', meetingId: 'meeting-1', templateSectionId: '10000000-0000-4000-8000-000000000002', kind: 'bullet_list', text: '', items: ['제안을 채택합니다.'], orderIndex: 1 },
    { id: 'action-section', title: '할 일', meetingId: 'meeting-1', templateSectionId: '10000000-0000-4000-8000-000000000003', kind: 'action_items', text: '', items: ['이 문구는 주요 논의가 아닙니다.'], orderIndex: 2 },
    { id: 'c', title: '주요 논의', meetingId: 'meeting-1', templateSectionId: '10000000-0000-4000-8000-000000000004', kind: 'bullet_list', text: '', items: ['근거를 검토했습니다.'], orderIndex: 3 },
  ],
  actionItems: [{ id: 'todo', meetingId: 'meeting-1', content: '초안 작성', assigneeSpeakerId: '0:B', dueAt: null, completed: false }],
})

describe('single-document meeting detail', () => {
  afterEach(cleanup)

  it('renders meeting status and processing actions before summary content', () => {
    render(<MeetingDetail document={documentFixture()} onBack={vi.fn()} onRenameSpeaker={vi.fn()} />)
    const main = screen.getByRole('main')
    const text = main.textContent ?? ''
    expect(text.indexOf('오디오 및 처리')).toBeLessThan(text.indexOf('핵심 요약'))
    expect(screen.getByLabelText('회의록 생성 완료')).toHaveAttribute('data-tone', 'success')
  })

  it('uses the stored recording duration for custom playback progress', () => {
    render(<MeetingDetail document={documentFixture()} onBack={vi.fn()} onRenameSpeaker={vi.fn()} />)
    const audio = screen.getByLabelText('회의 오디오') as HTMLAudioElement
    const range = screen.getByRole('slider', { name: '회의 오디오 재생 위치' })

    expect(range).toHaveAttribute('max', '65000')
    expect(screen.getByText('0:00 / 1:05')).toBeInTheDocument()
    Object.defineProperty(audio, 'currentTime', { configurable: true, value: 12 })
    fireEvent.timeUpdate(audio)
    expect(screen.getByText('0:12 / 1:05')).toBeInTheDocument()
  })

  it('renames the meeting inline without a separate save action', async () => {
    const user = userEvent.setup()
    const source = documentFixture()
    const renameMeeting = vi.fn(async (_meetingId: string, title: string) => ({ ...source.meeting, title }))
    render(<MeetingDetail document={source} onBack={vi.fn()} onRenameMeeting={renameMeeting} onRenameSpeaker={vi.fn()} />)

    await user.click(screen.getByRole('button', { name: '제품 회의 제목 수정' }))
    const input = screen.getByLabelText('회의 제목')
    await user.clear(input)
    await user.type(input, '고객 인터뷰{Enter}')

    expect(renameMeeting).toHaveBeenCalledWith('meeting-1', '고객 인터뷰')
    expect(await screen.findByRole('button', { name: '고객 인터뷰 제목 수정' })).toBeVisible()
    expect(screen.queryByRole('button', { name: '회의 제목 저장' })).not.toBeInTheDocument()
  })

  it('keeps retry, speaker rename and both export actions reachable', async () => {
    const user = userEvent.setup()
    const source = documentFixture()
    const rename = vi.fn(async (_meetingId: string, _speakerId: string, displayName: string) => ({ ...source.speakers[0]!, displayName }))
    const processing = {
      getStatus: vi.fn(), process: vi.fn(),
      retry: vi.fn(async () => ({ meetingId: 'meeting-1', state: 'completed' as const, failedStage: null, retryable: false, audioRequired: false, error: null })),
      onProgress: vi.fn(() => () => undefined),
    }
    const archive = {
      exportMeeting: vi.fn(async () => ({ status: 'success' as const, includedAudio: true, audioCoverage: 'all-parts' as const })),
      exportMarkdown: vi.fn(async () => ({ status: 'success' as const })), importMeeting: vi.fn(),
    }
    render(<MeetingDetail document={source} initialProcessingStatus={{ meetingId: 'meeting-1', state: 'failed', failedStage: 'summarizing', retryable: true, audioRequired: false, error: { code: 'OPENAI_NETWORK', message: 'retry' } }} processing={processing} archive={archive} onRefresh={vi.fn()} onBack={vi.fn()} onRenameSpeaker={rename} />)
    for (const name of ['회의록 작성 다시 시도', '전체 적용', '회의 내보내기', 'Markdown 내보내기']) {
      expect(screen.getByRole('button', { name }).querySelector('.ui-icon')).toBeVisible()
    }
    for (const name of ['회의 내보내기', 'Markdown 내보내기']) {
      expect(screen.getByRole('button', { name })).toHaveAttribute('data-variant', 'tertiary')
    }
    await user.click(screen.getByRole('button', { name: '회의록 작성 다시 시도' }))
    await user.clear(screen.getByLabelText('화자 B 이름'))
    await user.type(screen.getByLabelText('화자 B 이름'), '민지')
    await user.click(screen.getByRole('button', { name: '전체 적용' }))
    await user.click(screen.getByRole('button', { name: '회의 내보내기' }))
    await user.click(screen.getByRole('button', { name: 'Markdown 내보내기' }))
    expect(processing.retry).toHaveBeenCalledTimes(1)
    expect(rename).toHaveBeenCalledTimes(1)
    expect(archive.exportMeeting).toHaveBeenCalledTimes(1)
    expect(archive.exportMarkdown).toHaveBeenCalledTimes(1)
  })

  it('meeting-detail-shows-completed-document-in-approved-order', () => {
    render(<MeetingDetail document={documentFixture()} onBack={vi.fn()} onRenameSpeaker={vi.fn()} />)
    const headings = screen.getAllByRole('heading').map((node) => node.textContent)
    expect(headings).toEqual(['제품 회의', '오디오 및 처리', '핵심 요약', '결정사항', '할 일', '주요 논의', '화자 이름', '전체 대화 내용'])
    expect(screen.getByLabelText('회의 오디오')).toHaveAttribute('src', 'nnote-media://meeting/bWVldGluZy0x')
    expect(screen.getByRole('article', { name: '회의 문서' })).toHaveClass('meeting-document')
    expect(screen.getByText('Markdown 미리보기').closest('details')).not.toHaveAttribute('open')
    expect(screen.getByTestId('markdown-preview')).toHaveClass('markdown-code')
  })

  it('meeting-detail-shows-renamed-speaker-everywhere-without-changing-transcript', async () => {
    const user = userEvent.setup()
    const source = documentFixture()
    const original = structuredClone(source.transcript)
    const rename = vi.fn(async (_meetingId: string, _speakerId: string, displayName: string) => ({
      ...source.speakers[0], displayName,
    }))
    render(<MeetingDetail document={source} onBack={vi.fn()} onRenameSpeaker={rename} />)

    await user.clear(screen.getByLabelText('화자 B 이름'))
    await user.type(screen.getByLabelText('화자 B 이름'), '민지')
    await user.click(screen.getByRole('button', { name: '전체 적용' }))

    expect(await screen.findAllByText(/민지/)).not.toHaveLength(0)
    expect(screen.getByText('민지가 제안을 설명했습니다.')).toBeVisible()
    expect(screen.getAllByText(/담당: 민지/)[0]).toBeVisible()
    expect(screen.getByTestId('markdown-preview')).toHaveTextContent('민지')
    expect(source.transcript).toEqual(original)
    expect(source.transcript[0]).toMatchObject({ text: '원본 발언입니다.', startMs: 1_000, endMs: 2_500 })
  })

  it('applies every changed speaker name with one action', async () => {
    const user = userEvent.setup()
    const source = documentFixture()
    source.speakers.push({ id: '0:C', meetingId: 'meeting-1', displayName: '화자 C' })
    const rename = vi.fn(async (_meetingId: string, speakerId: string, displayName: string) => ({
      ...source.speakers.find((speaker) => speaker.id === speakerId)!, displayName,
    }))
    render(<MeetingDetail document={source} onBack={vi.fn()} onRenameSpeaker={rename} />)

    await user.clear(screen.getByLabelText('화자 B 이름'))
    await user.type(screen.getByLabelText('화자 B 이름'), '민지')
    await user.clear(screen.getByLabelText('화자 C 이름'))
    await user.type(screen.getByLabelText('화자 C 이름'), '준호')
    expect(screen.getAllByRole('button', { name: '전체 적용' })).toHaveLength(1)
    await user.click(screen.getByRole('button', { name: '전체 적용' }))

    expect(rename).toHaveBeenNthCalledWith(1, 'meeting-1', '0:B', '민지')
    expect(rename).toHaveBeenNthCalledWith(2, 'meeting-1', '0:C', '준호')
  })

  it('keeps transcript text and timestamps visible after a speaker rename', async () => {
    const source = documentFixture()
    render(<MeetingDetail document={source} onBack={vi.fn()} onRenameSpeaker={async (_m, _s, name) => ({ ...source.speakers[0], displayName: name })} />)
    const user = userEvent.setup()
    await user.clear(screen.getByLabelText('화자 B 이름'))
    await user.type(screen.getByLabelText('화자 B 이름'), '민지')
    await user.click(screen.getByRole('button', { name: '전체 적용' }))
    expect(screen.getByText('00:01–00:02')).toBeVisible()
    expect(screen.getByText('원본 발언입니다.')).toBeVisible()
  })

  it('syncs completed document speakers into every rendered speaker reference after a recorded document rerender', () => {
    const recorded = documentFixture()
    recorded.meeting = { ...recorded.meeting, status: 'recorded' }
    recorded.speakers = []
    recorded.transcript = []
    recorded.summarySections = []
    recorded.actionItems = []
    const completed = documentFixture()
    const archive = { exportMeeting: vi.fn(), exportMarkdown: vi.fn(), importMeeting: vi.fn() }
    const { rerender } = render(<MeetingDetail document={recorded} archive={archive} onBack={vi.fn()} onRenameSpeaker={vi.fn()} />)

    expect(screen.queryByRole('article', { name: '회의 문서' })).not.toBeInTheDocument()
    expect(screen.queryByText('화자 이름')).not.toBeInTheDocument()
    expect(screen.queryByText('전체 대화 내용')).not.toBeInTheDocument()
    expect(screen.queryByText('Markdown 미리보기')).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: '회의 내보내기' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Markdown 내보내기' })).not.toBeInTheDocument()
    rerender(<MeetingDetail document={completed} archive={archive} onBack={vi.fn()} onRenameSpeaker={vi.fn()} />)

    expect(screen.getByRole('button', { name: '회의 내보내기' })).toBeVisible()
    expect(screen.getByRole('button', { name: 'Markdown 내보내기' })).toBeVisible()
    expect(screen.getByText('화자 B가 제안을 설명했습니다.')).toBeVisible()
    expect(screen.getByText('담당: 화자 B')).toBeVisible()
    expect(screen.getByLabelText('화자 B 이름')).toHaveValue('화자 B')
    expect(screen.getByText('화자 B')).toBeVisible()
    expect(screen.getByTestId('markdown-preview')).toHaveTextContent('화자 B가 제안을 설명했습니다.')
    expect(screen.getByTestId('markdown-preview')).toHaveTextContent('담당: 화자 B')
    expect(screen.getByTestId('markdown-preview')).toHaveTextContent('화자 B: 원본 발언입니다.')
  })

  it('preserves a locally confirmed speaker rename when a stale document rerenders', async () => {
    const user = userEvent.setup()
    const source = documentFixture()
    const rename = vi.fn(async (_meetingId: string, _speakerId: string, displayName: string) => ({
      ...source.speakers[0]!, displayName,
    }))
    const { rerender } = render(<MeetingDetail document={source} onBack={vi.fn()} onRenameSpeaker={rename} />)
    await user.clear(screen.getByLabelText('화자 B 이름'))
    await user.type(screen.getByLabelText('화자 B 이름'), '민지')
    await user.click(screen.getByRole('button', { name: '전체 적용' }))
    expect(await screen.findByText('민지가 제안을 설명했습니다.')).toBeVisible()

    rerender(<MeetingDetail document={{ ...source }} onBack={vi.fn()} onRenameSpeaker={rename} />)

    expect(screen.getByText('민지가 제안을 설명했습니다.')).toBeVisible()
    expect(screen.getByText('담당: 민지')).toBeVisible()
    expect(screen.getByLabelText('민지 이름')).toHaveValue('민지')
    expect(screen.getByTestId('markdown-preview')).toHaveTextContent('민지: 원본 발언입니다.')
  })

  it('maps the real default action and discussion sections by stable identity in Markdown', () => {
    render(<MeetingDetail document={documentFixture()} onBack={vi.fn()} onRenameSpeaker={vi.fn()} />)
    const preview = screen.getByTestId('markdown-preview')
    expect(preview).toHaveTextContent('## 주요 논의')
    expect(preview).toHaveTextContent('근거를 검토했습니다.')
    expect(preview).not.toHaveTextContent('이 문구는 주요 논의가 아닙니다.')
  })

  it('renders every custom section in order, all audio parts, processing, and export actions', async () => {
    const user = userEvent.setup()
    const source = documentFixture()
    source.audioParts = [
      { partIndex: 0, url: 'nnote-media://meeting/bWVldGluZy0x/part/0', byteCount: 5, durationMs: 30_000 },
      { partIndex: 1, url: 'nnote-media://meeting/bWVldGluZy0x/part/1', byteCount: 5, durationMs: 35_000 },
    ]
    source.summarySections = [
      { id: 'x', title: '위험 요소', meetingId: 'meeting-1', templateSectionId: '30000000-0000-4000-8000-000000000001', kind: 'bullet_list', text: '', items: ['일정'], orderIndex: 0 },
      { id: 'y', title: '후속 조치', meetingId: 'meeting-1', templateSectionId: '30000000-0000-4000-8000-000000000002', kind: 'action_items', text: '', items: [], orderIndex: 1 },
      { id: 'z', title: '결론', meetingId: 'meeting-1', templateSectionId: '30000000-0000-4000-8000-000000000003', kind: 'paragraph', text: '진행', items: [], orderIndex: 2 },
    ]
    const processing = {
      getStatus: vi.fn(), process: vi.fn(async () => ({ meetingId: 'meeting-1', state: 'completed' as const, failedStage: null, retryable: false, audioRequired: false, error: null })), retry: vi.fn(), onProgress: vi.fn(() => () => undefined),
    }
    const archive = {
      exportMeeting: vi.fn(async () => ({ status: 'success' as const, includedAudio: true, audioCoverage: 'all-parts' as const })),
      exportMarkdown: vi.fn(async () => ({ status: 'success' as const })), importMeeting: vi.fn(),
    }
    render(<MeetingDetail document={source} initialProcessingStatus={{ meetingId: 'meeting-1', state: 'recorded', failedStage: null, retryable: false, audioRequired: true, error: null }} processing={processing} archive={archive} onRefresh={vi.fn()} onBack={vi.fn()} onRenameSpeaker={vi.fn()} />)

    expect(screen.getAllByLabelText(/회의 오디오 파트/, { selector: 'audio' })).toHaveLength(2)
    const headings = screen.getAllByRole('heading').map((node) => node.textContent)
    expect(headings.indexOf('위험 요소')).toBeLessThan(headings.indexOf('후속 조치'))
    expect(headings.indexOf('후속 조치')).toBeLessThan(headings.indexOf('결론'))
    expect(screen.getAllByText(/초안 작성/)[0]).toBeVisible()
    await user.click(screen.getByRole('button', { name: '회의록 만들기' }))
    expect(processing.process).toHaveBeenCalledWith('meeting-1')
    await user.click(screen.getByRole('button', { name: '회의 내보내기' }))
    await user.click(screen.getByRole('button', { name: 'Markdown 내보내기' }))
    expect(archive.exportMeeting).toHaveBeenCalledWith('meeting-1')
    expect(archive.exportMarkdown).toHaveBeenCalledWith('meeting-1')
  })
})
