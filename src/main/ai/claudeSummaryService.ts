import { readFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { join } from 'node:path'
import type { MeetingRepository } from '../db/meetingRepository'
import type { ClaudeSummary } from '../../shared/contracts/meetingsApi'
import type { ClaudeCli } from './claudeCli'

// Claude runs with skills off, so the app hands it the humanizer-ko guide itself.
export async function readHumanizerGuide(env: NodeJS.ProcessEnv = process.env, home = homedir()): Promise<string | null> {
  const configDirectory = env.CLAUDE_CONFIG_DIR ?? join(home, '.claude')
  for (const path of [
    join(configDirectory, 'skills/humanizer-ko/SKILL.md'),
    join(configDirectory, 'plugins/marketplaces/humanizer-ko/skills/humanizer-ko/SKILL.md'),
  ]) {
    try {
      return await readFile(path, 'utf8')
    } catch {
      continue
    }
  }
  return null
}

export function claudeSummaryPrompt(meetingMarkdown: string, humanizerGuide: string | null): string {
  return [
    '아래 회의 기록에는 이미 만든 요약과 전체 대화가 들어 있습니다.',
    '회의에 없던 동료가 읽을 회의록으로 한국어 마크다운 문서를 다시 정리하세요.',
    '- 대화에 근거한 내용만 쓰세요. 기존 요약에서 빠졌거나 틀린 내용은 대화를 기준으로 바로잡으세요.',
    '- 결정 사항, 할 일과 담당자, 남은 질문이 있으면 각각 모으세요.',
    '- 근거가 된 대화 시각을 [mm:ss]로 붙이세요.',
    '- 마크다운 문서만 출력하세요. 앞뒤 설명이나 코드 펜스를 붙이지 마세요.',
    ...(humanizerGuide === null ? [] : [
      '',
      '정리한 뒤 아래 humanizer-ko 지침으로 문장을 다듬으세요. 사실, 숫자, 이름, 시각은 바꾸지 마세요.',
      '<humanizer-ko>', humanizerGuide.trim(), '</humanizer-ko>',
    ]),
    '',
    '<meeting>', meetingMarkdown.trim(), '</meeting>',
  ].join('\n')
}

export class ClaudeSummaryService {
  private readonly running = new Map<string, Promise<ClaudeSummary>>()

  constructor(
    private readonly meetings: Pick<MeetingRepository, 'findClaudeSummary' | 'saveClaudeSummary'>,
    private readonly meetingMarkdown: (meetingId: string) => string,
    private readonly claude: Pick<ClaudeCli, 'available' | 'run'>,
    private readonly readGuide: () => Promise<string | null> = readHumanizerGuide,
  ) {}

  available(): Promise<boolean> {
    return this.claude.available()
  }

  get(meetingId: string): ClaudeSummary | null {
    return this.meetings.findClaudeSummary(meetingId)
  }

  generate(meetingId: string): Promise<ClaudeSummary> {
    const current = this.running.get(meetingId)
    if (current !== undefined) return current
    const next = (async () => {
      const prompt = claudeSummaryPrompt(this.meetingMarkdown(meetingId), await this.readGuide())
      return this.meetings.saveClaudeSummary(meetingId, await this.claude.run(prompt))
    })().finally(() => this.running.delete(meetingId))
    this.running.set(meetingId, next)
    return next
  }
}
