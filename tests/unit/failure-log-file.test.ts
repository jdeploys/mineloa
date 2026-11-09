import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { FAILURE_LOG_LIMIT_BYTES, failureLogFile } from '../../src/main/ai/failureLogFile'

const roots: string[] = []
afterEach(() => { for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }) })

function logDirectory() {
  const root = mkdtempSync(join(tmpdir(), 'mineloa-failure-log-'))
  roots.push(root)
  return join(root, 'Logs')
}

describe('failureLogFile', () => {
  it('appends timestamped lines, creating the folder and moving a full log aside', () => {
    vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    const directory = logDirectory()
    const write = failureLogFile(directory, () => new Date('2026-11-09T06:15:21.537Z'))

    write('[apple-helper] APPLE_HELPER_FAILED first')
    writeFileSync(join(directory, 'main.log'), 'x'.repeat(FAILURE_LOG_LIMIT_BYTES + 1))
    write('[apple-helper] APPLE_HELPER_FAILED second')

    expect(readFileSync(join(directory, 'main.log'), 'utf8')).toBe('2026-11-09T06:15:21.537Z [apple-helper] APPLE_HELPER_FAILED second\n')
    expect(readFileSync(join(directory, 'main.log.1'), 'utf8')).toHaveLength(FAILURE_LOG_LIMIT_BYTES + 1)
  })
})
