import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { getWindowWebPreferences } from '../../src/main/window/createMainWindow'
import { isTutorialExternalUrl, TUTORIAL_SOURCE_URL, TUTORIAL_LICENSE_URL } from '../../src/shared/tutorialMeeting'

describe('desktop window security', () => {
  it('only opens the two fixed tutorial attribution links externally', () => {
    expect(isTutorialExternalUrl(TUTORIAL_SOURCE_URL)).toBe(true)
    expect(isTutorialExternalUrl(TUTORIAL_LICENSE_URL)).toBe(true)
    expect(isTutorialExternalUrl('https://example.com')).toBe(false)
    expect(isTutorialExternalUrl(`${TUTORIAL_SOURCE_URL}?redirect=https://example.com`)).toBe(false)
    expect(isTutorialExternalUrl('file:///tmp/file')).toBe(false)
  })
  it('ships a renderer CSP that blocks remote scripts while allowing local media parts', () => {
    const html = readFileSync(join(process.cwd(), 'src/renderer/index.html'), 'utf8')
    expect(html).toContain("default-src 'self'")
    expect(html).toContain("script-src 'self'")
    expect(html).toContain('media-src')
    expect(html).toContain('nnote-media:')
    expect(html).not.toContain("'unsafe-eval'")
    expect(html).not.toMatch(/script-src[^;]*https?:/)
  })
  it('isolates the renderer and disables Node integration', () => {
    expect(getWindowWebPreferences('/tmp/preload.js')).toMatchObject({
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      preload: '/tmp/preload.js',
    })
  })
})
