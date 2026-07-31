import { describe, expect, it } from 'vitest'
import {
  DEFAULT_MS_PER_AUDIO_MS,
  elapsedLabel,
  remainingEstimateMs,
  unitLabel,
} from '../../src/shared/processingEstimate'

const startedAt = '2026-07-31T07:30:00.000Z'
const start = Date.parse(startedAt)

function progress(overrides: Partial<Parameters<typeof remainingEstimateMs>[0]> = {}) {
  return {
    stage: 'transcribing' as const,
    unitStartedAt: startedAt,
    pendingAudioMs: 1_200_000,
    msPerAudioMs: null,
    nowMs: start,
    ...overrides,
  }
}

describe('remainingEstimateMs', () => {
  // Measured on this app's own successful runs: 378s of audio took 182s and
  // 1162s took 557s, both 0.48x. The default has to land in that neighbourhood.
  it('seeds from the default ratio for the stage', () => {
    expect(remainingEstimateMs(progress())).toBe(1_200_000 * DEFAULT_MS_PER_AUDIO_MS.transcribing)
    expect(remainingEstimateMs(progress({ stage: 'summarizing' })))
      .toBe(1_200_000 * DEFAULT_MS_PER_AUDIO_MS.summarizing)
  })

  it('counts down as the current unit runs', () => {
    const full = remainingEstimateMs(progress())!

    expect(remainingEstimateMs(progress({ nowMs: start + 60_000 }))).toBe(full - 60_000)
  })

  it('prefers a measured ratio over the default once a unit has finished', () => {
    // The first cut part came back at 0.41x rather than the assumed 0.45x.
    const measured = remainingEstimateMs(progress({ msPerAudioMs: 0.414 }))

    expect(measured).toBe(Math.round(1_200_000 * 0.414))
    expect(measured).toBeLessThan(remainingEstimateMs(progress())!)
  })

  it('reports no estimate rather than zero once the guess is spent', () => {
    expect(remainingEstimateMs(progress({ nowMs: start + 10 * 60 * 60 * 1_000 }))).toBeNull()
  })

  it('reports no estimate when nothing is left to send', () => {
    expect(remainingEstimateMs(progress({ pendingAudioMs: 0 }))).toBeNull()
  })

  it('ignores an unusable unit start rather than showing a wild number', () => {
    expect(remainingEstimateMs(progress({ unitStartedAt: 'not a timestamp' }))).toBeNull()
  })
})

describe('unitLabel', () => {
  it('names the piece in flight when a recording was cut', () => {
    expect(unitLabel({ completedUnits: 0, totalUnits: 2 })).toBe('2개 중 1번째')
    expect(unitLabel({ completedUnits: 1, totalUnits: 2 })).toBe('2개 중 2번째')
  })

  // A short meeting is one request. "1개 중 1번째" is noise.
  it('stays silent when there is only one piece', () => {
    expect(unitLabel({ completedUnits: 0, totalUnits: 1 })).toBeNull()
  })

  it('does not count past the total when a part cut into more pieces than planned', () => {
    expect(unitLabel({ completedUnits: 5, totalUnits: 2 })).toBe('6개 중 6번째')
  })
})

describe('elapsedLabel', () => {
  it('reads in minutes and seconds', () => {
    expect(elapsedLabel(0)).toBe('0초')
    expect(elapsedLabel(47_000)).toBe('47초')
    expect(elapsedLabel(192_000)).toBe('3분 12초')
    expect(elapsedLabel(600_000)).toBe('10분 0초')
  })

  it('never reads backwards', () => {
    expect(elapsedLabel(-5_000)).toBe('0초')
  })
})
