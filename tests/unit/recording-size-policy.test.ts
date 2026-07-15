import { describe, expect, it } from 'vitest'
import { evaluateRecordingSize } from '../../src/main/recording/recordingTypes'

describe('recording size policy', () => {
  it('warns at 22 MiB without rolling the part', () => {
    expect(evaluateRecordingSize(22 * 1024 * 1024)).toEqual({ warn: true, rollPart: false })
  })

  it('rolls at 24 MiB without deleting completed bytes', () => {
    expect(evaluateRecordingSize(24 * 1024 * 1024)).toEqual({ warn: true, rollPart: true })
  })
})
