import { describe, expect, it } from 'vitest'
import {
  InvalidMeetingTransitionError,
  assertMeetingTransition,
} from '../../src/main/domain/meetingState'

describe('meeting state transitions', () => {
  it('allows a recorded meeting to start transcription', () => {
    expect(() => assertMeetingTransition('recorded', 'transcribing')).not.toThrow()
  })

  it('does not treat navigation as a destructive meeting transition', () => {
    expect(() => assertMeetingTransition('recording', 'deleted')).toThrow(/explicit delete/i)
  })

  it('allows an explicit delete transition', () => {
    expect(() =>
      assertMeetingTransition('recording', 'deleted', { explicitDelete: true }),
    ).not.toThrow()
  })

  it('throws a typed error for an unsupported transition', () => {
    expect(() => assertMeetingTransition('draft', 'completed')).toThrow(
      InvalidMeetingTransitionError,
    )
  })
})
