import type { Speaker, TranscriptSegment } from '../../../../shared/contracts/meeting'

function timestamp(value: number): string {
  const totalSeconds = Math.floor(value / 1_000)
  return `${String(Math.floor(totalSeconds / 60)).padStart(2, '0')}:${String(totalSeconds % 60).padStart(2, '0')}`
}

export function Transcript({ segments, speakers }: { segments: readonly TranscriptSegment[]; speakers: readonly Speaker[] }) {
  const names = new Map(speakers.map((speaker) => [speaker.id, speaker.displayName]))
  return <ol className="transcript-list">
    {segments.map((segment) => <li className="transcript-row" key={segment.id}>
      <div className="transcript-meta">
        <strong>{segment.speakerId === null ? '화자 미상' : names.get(segment.speakerId) ?? segment.speakerId}</strong>
        <time>{timestamp(segment.startMs)}–{timestamp(segment.endMs)}</time>
      </div>
      <p>{segment.text}</p>
    </li>)}
  </ol>
}
