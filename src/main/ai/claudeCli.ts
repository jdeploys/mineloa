import { constants } from 'node:fs'
import { access, mkdtemp, realpath, rm } from 'node:fs/promises'
import { homedir } from 'node:os'
import { join } from 'node:path'
import type { OwnedProcessRequest, OwnedProcessResult } from '../process/runOwnedProcess'

type ProcessRunner = (request: OwnedProcessRequest) => Promise<OwnedProcessResult>

const SHELL_MARK = '__MINELOA_CLAUDE__'
const SHELL_QUERY = `printf '${SHELL_MARK}%s\\n' "$(command -v claude)"`
// The login shell skips ~/.zshrc, where some installs put claude on PATH.
const SHELL_TRIES = [['-lc', 5_000], ['-ilc', 10_000]] as const
const RUN_TIMEOUT_MS = 10 * 60 * 1_000
const RUN_OUTPUT_CAP_BYTES = 4 * 1024 * 1024

// Only these reach claude: meeting text should not leak into hooks or tools
// configured through variables the app happened to inherit.
const ENV_ALLOW = [
  /^(PATH|HOME|USER|LOGNAME|SHELL|TMPDIR|TZ|LANG|LANGUAGE)$/,
  /^LC_[A-Z]+$/,
  /^__CF_USER_TEXT_ENCODING$/,
  /^(https?|all|no)_proxy$/i,
  /^(NODE_EXTRA_CA_CERTS|SSL_CERT_FILE|SSL_CERT_DIR)$/,
  /^CLAUDE_CONFIG_DIR$/,
  /^ANTHROPIC_[A-Z0-9_]+$/,
]

// --safe-mode turns off CLAUDE.md, skills, plugins, hooks and MCP, so the
// answer depends on the prompt alone, not on whoever's setup runs it.
export const CLAUDE_RUN_ARGS = ['-p', '--safe-mode', '--tools', '', '--no-session-persistence', '--output-format', 'text'] as const

export function childEnv(env: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  return Object.fromEntries(Object.entries(env).filter(([key]) => ENV_ALLOW.some((pattern) => pattern.test(key))))
}

// Apps opened from Finder get a short PATH, so look where installers put claude.
export function claudeCandidates(env: NodeJS.ProcessEnv, home: string): string[] {
  return [
    env.CLAUDE_PATH,
    join(home, '.local/bin/claude'),
    join(home, '.claude/local/claude'),
    '/opt/homebrew/bin/claude',
    '/usr/local/bin/claude',
    join(home, '.npm-global/bin/claude'),
  ].filter((path): path is string => Boolean(path))
}

export function shellAnswer(stdout: string): string | null {
  const line = stdout.split(/\r?\n/).find((value) => value.startsWith(SHELL_MARK))
  return line?.slice(SHELL_MARK.length).trim() || null
}

async function isExecutableFile(path: string): Promise<boolean> {
  try {
    await access(path, constants.X_OK)
    return true
  } catch {
    return false
  }
}

export class ClaudeCli {
  private found: string | null = null

  constructor(
    private readonly runProcess: ProcessRunner,
    private readonly temporaryRoot: string,
    private readonly env: NodeJS.ProcessEnv = process.env,
    private readonly home: string = homedir(),
    private readonly isExecutable: (path: string) => Promise<boolean> = isExecutableFile,
  ) {}

  async available(): Promise<boolean> {
    const path = await this.find()
    if (path === null) return false
    const status = await this.inFreshDirectory((cwd) => this.runProcess({
      command: path, args: ['auth', 'status', '--json'], cwd, env: childEnv(this.env), timeoutMs: 15_000,
    }))
    if (status.status !== 'success') return false
    try {
      return (JSON.parse(status.stdout) as { loggedIn?: unknown }).loggedIn === true
    } catch {
      return false
    }
  }

  async run(prompt: string): Promise<string> {
    const path = await this.find()
    if (path === null) throw new Error('Claude Code를 찾지 못했습니다.')
    const result = await this.inFreshDirectory((cwd) => this.runProcess({
      command: path, args: CLAUDE_RUN_ARGS, cwd, env: childEnv(this.env), stdin: prompt,
      timeoutMs: RUN_TIMEOUT_MS, outputCapBytes: RUN_OUTPUT_CAP_BYTES,
    }))
    if (result.status === 'success' && result.stdout.trim().length > 0) return result.stdout.trim()
    if (result.status === 'timeout') throw new Error('Claude Code가 10분 안에 끝나지 않아 멈췄습니다.')
    const detail = result.status === 'nonzero_exit' ? (result.stderr || result.stdout).trim().split('\n')[0] : result.status
    throw new Error(`Claude Code 실행에 실패했습니다${detail ? `: ${detail}` : '.'}`)
  }

  private async find(): Promise<string | null> {
    if (this.found !== null && await this.isExecutable(this.found)) return this.found
    for (const candidate of claudeCandidates(this.env, this.home)) {
      if (await this.isExecutable(candidate)) return (this.found = candidate)
    }
    const shell = /^\/\S*\/(zsh|bash)$/.test(this.env.SHELL ?? '') ? this.env.SHELL! : '/bin/zsh'
    for (const [flags, timeoutMs] of SHELL_TRIES) {
      const answer = await this.runProcess({ command: shell, args: [flags, SHELL_QUERY], cwd: this.home, timeoutMs })
      const path = answer.status === 'success' ? shellAnswer(answer.stdout) : null
      if (path !== null && await this.isExecutable(path)) return (this.found = path)
    }
    return null
  }

  // An empty directory keeps a project's CLAUDE.md and .claude settings out.
  private async inFreshDirectory<T>(work: (cwd: string) => Promise<T>): Promise<T> {
    const directory = await mkdtemp(join(await realpath(this.temporaryRoot), 'mineloa-claude-'))
    try {
      return await work(directory)
    } finally {
      await rm(directory, { recursive: true, force: true })
    }
  }
}
