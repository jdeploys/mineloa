import { describe, expect, it } from 'vitest'
import type { MeetingStatus } from '../../src/shared/contracts/meeting'
import { meetingStatusLabel } from '../../src/renderer/src/features/meetings/meetingStatusLabel'

describe('user-facing meeting statuses', () => {
  it('gives every meeting enum state a distinct, understandable Korean label', () => {
    const expected: Record<MeetingStatus, string> = {
      draft: '회의 준비 중',
      recording: '녹음 중',
      recoverable: '녹음 복구 필요',
      recorded: '녹음 완료',
      transcribing: '음성을 글로 변환 중',
      summarizing: '회의록 작성 중',
      completed: '회의록 생성 완료',
      failed: '회의록 생성 실패',
      deleted: '삭제됨',
    }

    expect(Object.fromEntries(Object.keys(expected).map((status) => [status, meetingStatusLabel(status as MeetingStatus)]))).toEqual(expected)
    expect(new Set(Object.values(expected)).size).toBe(9)
  })
})
