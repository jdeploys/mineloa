import { describe, expect, it } from 'vitest'
import { redactSecrets } from '../../src/main/ai/redactSecrets'

describe('redactSecrets', () => {
  it('removes authorization values, OpenAI keys, and absolute recording paths', () => {
    const windowsPath = String.raw`C:\Users\person\Nnote\recordings\meeting.part-0.webm`
    const unixPath = '/Users/person/Nnote/recordings/meeting.part-1.webm'
    const value = `Authorization: Bearer sk-project-secret failed for ${windowsPath} and ${unixPath}`

    const redacted = redactSecrets(value, [windowsPath, unixPath])

    expect(redacted).toContain('[REDACTED]')
    expect(redacted).not.toContain('sk-project-secret')
    expect(redacted).not.toContain(windowsPath)
    expect(redacted).not.toContain(unixPath)
    expect(redacted).not.toMatch(/Authorization:\s*Bearer/i)
  })

  it('redacts punctuation-bearing keys and authorization values in common serialized forms', () => {
    const value = [
      'sk-secret.,;)]}',
      'Authorization: Bearer opaque-plain-token',
      '{"authorization":"Bearer opaque-json-token"}',
      "{ headers: { Authorization: 'Bearer opaque-nested-token' } }",
      'authorization=opaque-equals-token',
    ].join('\n')

    const redacted = redactSecrets(value)

    expect(redacted).not.toMatch(/sk-/)
    expect(redacted).not.toContain('opaque-plain-token')
    expect(redacted).not.toContain('opaque-json-token')
    expect(redacted).not.toContain('opaque-nested-token')
    expect(redacted).not.toContain('opaque-equals-token')
    expect(redacted.match(/\[REDACTED\]/g)?.length).toBeGreaterThanOrEqual(5)
  })

  it('redacts complete Basic and Bearer values without consuming adjacent serialized fields', () => {
    const value = [
      'Authorization: Basic opaque plain secret, with comma',
      '{"authorization":"Basic opaque json, secret","next":"keep-json"}',
      "{ headers: { Authorization: 'Basic opaque nested, secret', next: 'keep-nested' } }",
      'authorization=Basic opaque equals secret;next=keep-equals',
      '[["Authorization","Bearer opaque tuple, secret"],["X-Trace","keep-tuple"]]',
    ].join('\n')

    const redacted = redactSecrets(value)

    for (const fragment of ['opaque', 'plain secret', 'json, secret', 'nested, secret', 'equals secret', 'tuple, secret']) {
      expect(redacted).not.toContain(fragment)
    }
    expect(redacted).toContain('"next":"keep-json"')
    expect(redacted).toContain("next: 'keep-nested'")
    expect(redacted).toContain('next=keep-equals')
    expect(redacted).toContain('["X-Trace","keep-tuple"]')
  })

  it('does not alter a safe user-facing error', () => {
    expect(redactSecrets('The audio file is invalid.')).toBe('The audio file is invalid.')
  })
})
