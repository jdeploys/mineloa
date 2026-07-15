import type { MeetingStatus } from '../../shared/contracts/meeting'

const allowed: Record<MeetingStatus, readonly MeetingStatus[]> = {
  draft: ['recording', 'deleted'],
  recording: ['recorded', 'recoverable', 'deleted'],
  recoverable: ['recorded', 'recording', 'deleted'],
  recorded: ['transcribing', 'deleted'],
  transcribing: ['summarizing', 'failed'],
  summarizing: ['completed', 'failed'],
  completed: ['transcribing', 'deleted'],
  failed: ['transcribing', 'summarizing', 'deleted'],
  deleted: [],
}

export class InvalidMeetingTransitionError extends Error {
  constructor(
    readonly from: MeetingStatus,
    readonly to: MeetingStatus,
    message = `Invalid meeting transition from ${from} to ${to}`,
  ) {
    super(message)
    this.name = 'InvalidMeetingTransitionError'
  }
}

export function assertMeetingTransition(
  from: MeetingStatus,
  to: MeetingStatus,
  options: { explicitDelete?: boolean } = {},
): void {
  if (to === 'deleted' && options.explicitDelete !== true) {
    throw new InvalidMeetingTransitionError(
      from,
      to,
      'Meeting deletion requires an explicit delete action',
    )
  }

  if (!allowed[from].includes(to)) {
    throw new InvalidMeetingTransitionError(from, to)
  }
}
