import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { ClaudeCli, CLAUDE_RUN_ARGS } from '../../src/main/ai/claudeCli'
import { ClaudeSummaryService, claudeSummaryPrompt } from '../../src/main/ai/claudeSummaryService'
import type { OwnedProcessRequest, OwnedProcessResult } from '../../src/main/process/runOwnedProcess'

const roots: string[] = []
afterEach(() => { for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }) })

function temporaryRoot() {
  const root = mkdtempSync(join(tmpdir(), 'mineloa-claude-test-'))
  roots.push(root)
  return root
}

const success = (stdout: string): OwnedProcessResult => ({ status: 'success', exitCode: 0, stdout, stderr: '' })

describe('ClaudeCli', () => {
  it('runs claude with customizations off, the prompt on stdin, and only allowed variables', async () => {
    const runProcess = vi.fn(async (_request: OwnedProcessRequest) => success('# 회의록\n'))
    const cli = new ClaudeCli(runProcess, temporaryRoot(), {
      HOME: '/Users/me', PATH: '/usr/bin', OPENAI_API_KEY: 'secret', CLAUDECODE: '1', ANTHROPIC_BASE_URL: 'https://proxy',
    }, '/Users/me', async (path) => path === '/Users/me/.local/bin/claude')

    await expect(cli.run('정리해 주세요')).resolves.toBe('# 회의록')

    const request = runProcess.mock.calls[0][0]
    expect(request).toMatchObject({ command: '/Users/me/.local/bin/claude', args: CLAUDE_RUN_ARGS, stdin: '정리해 주세요' })
    expect(request.args).toContain('--safe-mode')
    expect(request.env).toEqual({ HOME: '/Users/me', PATH: '/usr/bin', ANTHROPIC_BASE_URL: 'https://proxy' })
  })

  it('asks the login shell when no known location has claude, and needs a logged-in account', async () => {
    const runProcess = vi.fn(async (request: OwnedProcessRequest) => request.command === '/bin/zsh'
      ? success('Welcome!\n__MINELOA_CLAUDE__/Users/me/.nvm/bin/claude\n')
      : success('{"loggedIn":false}'))
    const cli = new ClaudeCli(runProcess, temporaryRoot(), { SHELL: '/bin/zsh' }, '/Users/me',
      async (path) => path === '/Users/me/.nvm/bin/claude')

    await expect(cli.available()).resolves.toBe(false)

    expect(runProcess.mock.calls.at(-1)?.[0]).toMatchObject({ command: '/Users/me/.nvm/bin/claude', args: ['auth', 'status', '--json'] })
  })

  it('reports claude being missing as unavailable', async () => {
    const runProcess = vi.fn(async () => success(''))
    const cli = new ClaudeCli(runProcess, temporaryRoot(), { SHELL: '/bin/zsh' }, '/Users/me', async () => false)
    await expect(cli.available()).resolves.toBe(false)
  })

  it('surfaces the first line of a failure', async () => {
    const runProcess = vi.fn(async (): Promise<OwnedProcessResult> => ({ status: 'nonzero_exit', exitCode: 1, stdout: '', stderr: 'error: unknown option --safe-mode\nmore' }))
    const cli = new ClaudeCli(runProcess, temporaryRoot(), {}, '/Users/me', async () => true)
    await expect(cli.run('x')).rejects.toThrow('Claude Code 실행에 실패했습니다: error: unknown option --safe-mode')
  })
})

describe('ClaudeSummaryService', () => {
  it('adds the humanizer guide only when it is installed', () => {
    expect(claudeSummaryPrompt('# 회의', '규칙')).toContain('<humanizer-ko>\n규칙\n</humanizer-ko>')
    expect(claudeSummaryPrompt('# 회의', null)).not.toContain('humanizer-ko')
  })

  it('shares one run between repeated requests and stores the result', async () => {
    let finish: (value: string) => void = () => undefined
    const run = vi.fn(() => new Promise<string>((resolve) => { finish = resolve }))
    const saveClaudeSummary = vi.fn((_meetingId: string, markdown: string) => ({ markdown, createdAt: '2026-11-09T00:00:00.000Z' }))
    const service = new ClaudeSummaryService(
      { findClaudeSummary: () => null, saveClaudeSummary },
      () => '# 회의',
      { available: async () => true, run },
      async () => null,
    )

    const first = service.generate('meeting-1')
    const second = service.generate('meeting-1')
    await vi.waitFor(() => expect(run).toHaveBeenCalledTimes(1))
    finish('# 정리')

    await expect(first).resolves.toEqual({ markdown: '# 정리', createdAt: '2026-11-09T00:00:00.000Z' })
    expect(second).toBe(first)
    expect(saveClaudeSummary).toHaveBeenCalledWith('meeting-1', '# 정리')
  })
})
