import { describe, expect, it } from 'vitest'
import { formatProviderFailure } from '../../src/main/ai/providerDiagnostics'

describe('formatProviderFailure', () => {
  // The sentence that identified the real fault was thrown away with the rest
  // of the provider response, leaving only "could not process this audio file".
  it('keeps the provider sentence that explains the failure', () => {
    const error = Object.assign(
      new Error('400 audio duration 2053.381 seconds is longer than 1400 seconds which is the maximum for this model'),
      { status: 400 },
    )

    const line = formatProviderFailure('openai.transcribe', 'OPENAI_AUDIO_TOO_LONG', error)

    expect(line).toContain('OPENAI_AUDIO_TOO_LONG')
    expect(line).toContain('status=400')
    expect(line).toContain('longer than 1400 seconds')
  })

  it('removes the API key and the recording path before anything is written', () => {
    const filePath = '/Users/person/Library/Application Support/Nnote/recordings/meeting.part-0.webm'
    const error = new Error(`Authorization: Bearer sk-live-secret rejected ${filePath}`)

    const line = formatProviderFailure('openai.transcribe', 'OPENAI_UNAUTHORIZED', error, [filePath])

    expect(line).not.toContain('sk-live-secret')
    expect(line).not.toContain(filePath)
    expect(line).toContain('OPENAI_UNAUTHORIZED')
  })

  it('bounds a runaway provider message to one log line', () => {
    const line = formatProviderFailure('openai.transcribe', 'OPENAI_UNKNOWN', new Error(`${'x'.repeat(5_000)}\nsecond line`))

    expect(line.length).toBeLessThan(600)
    expect(line).not.toContain('\n')
  })
})
