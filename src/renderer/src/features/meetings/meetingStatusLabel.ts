import type { MeetingStatus } from '../../../../shared/contracts/meeting'

const labels: Record<MeetingStatus, string> = {
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

export function meetingStatusLabel(status: MeetingStatus): string {
  return labels[status]
}
