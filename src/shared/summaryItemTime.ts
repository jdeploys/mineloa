/**
 * Where in the meeting an item came from, in the same reading as the audio
 * player's clock so the two can be compared at a glance. Minutes are not wrapped
 * into hours: a 71 minute meeting reads 61:30, matching its player.
 */
export function summaryTimeLabel(atMs: number | null): string | null {
  if (atMs === null || !Number.isFinite(atMs) || atMs < 0) return null
  const seconds = Math.floor(atMs / 1_000)
  return `${String(Math.floor(seconds / 60)).padStart(2, '0')}:${String(seconds % 60).padStart(2, '0')}`
}

/** `12:04 내용` when the item has a source, plain content when it does not. */
export function summaryItemLine(atMs: number | null, content: string): string {
  const label = summaryTimeLabel(atMs)
  return label === null ? content : `${label} ${content}`
}
