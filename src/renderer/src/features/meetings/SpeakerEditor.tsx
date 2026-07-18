import { useEffect, useState } from 'react'
import type { Speaker } from '../../../../shared/contracts/meeting'
import { Button } from '../../components/ui/Button'

export function SpeakerEditor({
  speakers,
  onRename,
}: {
  speakers: readonly Speaker[]
  onRename(speakerId: string, displayName: string): Promise<void>
}) {
  const [names, setNames] = useState<Record<string, string>>(() => Object.fromEntries(speakers.map((speaker) => [speaker.id, speaker.displayName])))
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  useEffect(() => setNames(Object.fromEntries(speakers.map((speaker) => [speaker.id, speaker.displayName]))), [speakers])

  const changes = speakers.flatMap((speaker) => {
    const displayName = names[speaker.id]?.trim() ?? ''
    return displayName !== speaker.displayName ? [{ speakerId: speaker.id, displayName }] : []
  })

  async function saveAll() {
    if (speakers.some((speaker) => (names[speaker.id]?.trim() ?? '').length === 0)) {
      setError('모든 화자 이름을 입력해 주세요.')
      return
    }
    setBusy(true)
    setError(null)
    try {
      for (const change of changes) await onRename(change.speakerId, change.displayName)
    } catch {
      setError('화자 이름 일부를 적용하지 못했습니다. 다시 확인해 주세요.')
    } finally {
      setBusy(false)
    }
  }

  return <div className="speaker-grid">
    {speakers.length === 0 && <p className="muted">확인된 화자가 없습니다.</p>}
    {speakers.map((speaker) => <div className="speaker-field speaker-card" key={speaker.id}>
      <label htmlFor={`speaker-${speaker.id}`}>{speaker.displayName} 이름</label>
      <input id={`speaker-${speaker.id}`} value={names[speaker.id] ?? ''} disabled={busy} onChange={(event) => setNames((current) => ({ ...current, [speaker.id]: event.target.value }))} />
    </div>)}
    {error && <p role="alert">{error}</p>}
    {speakers.length > 0 && <div className="speaker-actions">
      <Button icon="edit" variant="primary" disabled={busy || changes.length === 0} onClick={() => void saveAll()}>{busy ? '적용 중' : '전체 적용'}</Button>
    </div>}
  </div>
}
