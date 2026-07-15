import { useEffect, useState } from 'react'
import type { Speaker } from '../../../../shared/contracts/meeting'

export function SpeakerEditor({
  speakers,
  onRename,
}: {
  speakers: readonly Speaker[]
  onRename(speakerId: string, displayName: string): Promise<void>
}) {
  const [names, setNames] = useState<Record<string, string>>(() => Object.fromEntries(speakers.map((speaker) => [speaker.id, speaker.displayName])))
  const [pendingId, setPendingId] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  useEffect(() => setNames(Object.fromEntries(speakers.map((speaker) => [speaker.id, speaker.displayName]))), [speakers])

  async function save(speaker: Speaker) {
    const next = names[speaker.id]?.trim() ?? ''
    if (next.length === 0) { setError('화자 이름을 입력하세요.'); return }
    setPendingId(speaker.id)
    setError(null)
    try { await onRename(speaker.id, next) }
    catch { setError('화자 이름을 저장하지 못했습니다.') }
    finally { setPendingId(null) }
  }

  return <div className="speaker-grid">
    {speakers.length === 0 && <p className="muted">확인된 화자가 없습니다.</p>}
    {speakers.map((speaker) => <div className="speaker-field speaker-card" key={speaker.id}>
      <label htmlFor={`speaker-${speaker.id}`}>{speaker.displayName} 이름</label>
      <div>
        <input id={`speaker-${speaker.id}`} value={names[speaker.id] ?? ''} onChange={(event) => setNames((current) => ({ ...current, [speaker.id]: event.target.value }))} />
        <button type="button" disabled={pendingId !== null} onClick={() => void save(speaker)}>{speaker.displayName} 이름 저장</button>
      </div>
    </div>)}
    {error && <p role="alert">{error}</p>}
  </div>
}
