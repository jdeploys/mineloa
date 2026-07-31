import { describe, expect, it } from 'vitest'
import { evaluateRecordingPart } from '../../src/main/recording/recordingTypes'

const MINUTE_MS = 60 * 1_000

describe('recording part policy', () => {
  it('warns at 22 MiB without rolling the part', () => {
    expect(evaluateRecordingPart(22 * 1024 * 1024, 0)).toEqual({ warn: true, rollPart: false })
  })

  it('rolls at 24 MiB without deleting completed bytes', () => {
    expect(evaluateRecordingPart(24 * 1024 * 1024, 0)).toEqual({ warn: true, rollPart: true })
  })

  // A 34 minute meeting compresses to about 16 MiB, so only a length limit
  // keeps it out of a single upload the transcription model refuses.
  it('rolls at twenty minutes even when the part is far below the size limit', () => {
    expect(evaluateRecordingPart(1_024, 20 * MINUTE_MS)).toEqual({ warn: false, rollPart: true })
  })

  it('leaves a shorter part alone', () => {
    expect(evaluateRecordingPart(1_024, 19 * MINUTE_MS)).toEqual({ warn: false, rollPart: false })
  })
})
