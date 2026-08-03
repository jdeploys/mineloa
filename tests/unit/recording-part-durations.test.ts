import { describe, expect, it } from 'vitest'
import { ownDurationsMs, previousPartMarkMs } from '../../src/main/recording/recordingPartDurations'

// Observed on a 71 minute meeting that rolled every twenty minutes.
const stored = [
  { partIndex: 0, durationMs: 1_202_551 },
  { partIndex: 1, durationMs: 2_405_082 },
  { partIndex: 2, durationMs: 3_607_592 },
  { partIndex: 3, durationMs: 4_264_729 },
]

describe('ownDurationsMs', () => {
  it('reads each part as its own length rather than the meeting mark it closed at', () => {
    expect(ownDurationsMs(stored)).toEqual([1_202_551, 1_202_531, 1_202_510, 657_137])
  })

  it('adds up to the meeting duration', () => {
    expect(ownDurationsMs(stored).reduce((total, value) => total + value, 0)).toBe(4_264_729)
  })

  it('leaves a single part alone', () => {
    expect(ownDurationsMs([{ partIndex: 0, durationMs: 2_053_381 }])).toEqual([2_053_381])
  })

  it('handles no parts', () => {
    expect(ownDurationsMs([])).toEqual([])
  })

  // Marks come from a monotonic recording clock, but a corrupt manifest must not
  // produce a negative player duration.
  it('never reports a negative length', () => {
    expect(ownDurationsMs([
      { partIndex: 0, durationMs: 5_000 },
      { partIndex: 1, durationMs: 1_000 },
    ])).toEqual([5_000, 0])
  })
})

describe('previousPartMarkMs', () => {
  it('reports the mark the previous part closed at', () => {
    expect(previousPartMarkMs(stored, 3)).toBe(3_607_592)
    expect(previousPartMarkMs(stored, 1)).toBe(1_202_551)
  })

  it('starts from zero for the first part', () => {
    expect(previousPartMarkMs(stored, 0)).toBe(0)
    expect(previousPartMarkMs([], 0)).toBe(0)
  })

  it('ignores parts that come after the one asked about', () => {
    expect(previousPartMarkMs(stored, 2)).toBe(2_405_082)
  })
})
