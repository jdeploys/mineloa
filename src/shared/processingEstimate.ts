// Waiting without a number on screen is the complaint this answers. There is no
// progress signal from the provider — a diarized request returns nothing until
// it is finished — so the estimate comes from how long this app's own runs have
// taken: 378s of audio transcribed in 182s and 1162s in 557s, both 0.48x, and
// their summaries took 0.06x and 0.05x. Seed from those, then replace the guess
// with what the run itself measures as soon as one piece finishes.
export const DEFAULT_MS_PER_AUDIO_MS = {
  transcribing: 0.45,
  summarizing: 0.055,
} as const

export type EstimatedStage = keyof typeof DEFAULT_MS_PER_AUDIO_MS

export interface RemainingEstimateInput {
  stage: EstimatedStage
  /** Start of the piece being sent right now. */
  unitStartedAt: string
  /** Audio still to be sent, including the piece in flight. */
  pendingAudioMs: number
  /** Ratio measured from the pieces this run already finished. */
  msPerAudioMs: number | null
  nowMs: number
}

/**
 * Milliseconds still expected, or null when there is nothing left to predict —
 * either nothing is pending or the run has already outlasted the estimate. A
 * spent estimate must not read as "0분 남음", which would look like a freeze.
 */
export function remainingEstimateMs(input: RemainingEstimateInput): number | null {
  if (!(input.pendingAudioMs > 0)) return null
  const unitStart = Date.parse(input.unitStartedAt)
  if (!Number.isFinite(unitStart)) return null
  const ratio = input.msPerAudioMs === null || !(input.msPerAudioMs > 0)
    ? DEFAULT_MS_PER_AUDIO_MS[input.stage]
    : input.msPerAudioMs
  const remaining = Math.round(input.pendingAudioMs * ratio) - (input.nowMs - unitStart)
  return remaining > 0 ? remaining : null
}

export function unitLabel(units: { completedUnits: number; totalUnits: number }): string | null {
  const current = units.completedUnits + 1
  // A part can cut into one more piece than its length predicted. Follow the
  // real count rather than reporting "2개 중 3번째".
  const total = Math.max(units.totalUnits, current)
  return total <= 1 ? null : `${total}개 중 ${current}번째`
}

export function elapsedLabel(elapsedMs: number): string {
  const total = Math.max(0, Math.floor(elapsedMs / 1_000))
  const minutes = Math.floor(total / 60)
  return minutes === 0 ? `${total}초` : `${minutes}분 ${total % 60}초`
}

export function remainingLabel(remainingMs: number | null): string {
  if (remainingMs === null) return '예상보다 오래 걸리고 있습니다'
  const minutes = Math.ceil(remainingMs / 60_000)
  return `남은 시간 약 ${minutes}분`
}
