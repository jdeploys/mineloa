// A recording part stores the meeting duration reached when it closed, not its
// own length, because the recorder only ever knows how long the meeting has been
// running. Every reader has to undo that, and the rule was restated at each one
// until a player showed part 2 of a 71 minute meeting as 40:05.

interface PartMark {
  partIndex: number
  durationMs: number
}

/** Meeting duration already covered before this part started. */
export function previousPartMarkMs(parts: readonly PartMark[], partIndex: number): number {
  const previous = parts.filter((part) => part.partIndex < partIndex).at(-1)
  return previous?.durationMs ?? 0
}

/** Each part's own length, in the order given. */
export function ownDurationsMs(parts: readonly PartMark[]): number[] {
  return parts.map((part) => Math.max(0, part.durationMs - previousPartMarkMs(parts, part.partIndex)))
}
