import { useRef, useState } from 'react'
import { Button } from '../../components/ui/Button'

function formatPlaybackTime(durationMs: number): string {
  const seconds = Math.max(0, Math.floor(durationMs / 1_000))
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`
}

export function AudioPlayer({ src, durationMs, label }: {
  src: string
  durationMs: number
  label: string
}) {
  const audioRef = useRef<HTMLAudioElement>(null)
  const [currentMs, setCurrentMs] = useState(0)
  const [playing, setPlaying] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const safeDurationMs = Math.max(0, durationMs)

  const updateCurrentTime = () => {
    const audio = audioRef.current
    if (audio === null || !Number.isFinite(audio.currentTime)) return
    setCurrentMs(Math.min(safeDurationMs, Math.max(0, Math.round(audio.currentTime * 1_000))))
  }

  const togglePlayback = async () => {
    const audio = audioRef.current
    if (audio === null) return
    setError(null)
    if (!audio.paused) {
      audio.pause()
      return
    }
    try {
      await audio.play()
    } catch {
      setError('오디오를 재생하지 못했습니다.')
    }
  }

  const seek = (nextMs: number) => {
    const audio = audioRef.current
    setCurrentMs(nextMs)
    if (audio !== null) audio.currentTime = nextMs / 1_000
  }

  return (
    <div className="audio-player">
      <audio
        ref={audioRef}
        className="audio-player-source"
        aria-label={label}
        preload="metadata"
        src={src}
        onTimeUpdate={updateCurrentTime}
        onSeeked={updateCurrentTime}
        onPlay={() => setPlaying(true)}
        onPause={() => setPlaying(false)}
        onEnded={() => { setPlaying(false); setCurrentMs(safeDurationMs) }}
        onError={() => setError('오디오를 불러오지 못했습니다.')}
      />
      <Button
        className="audio-player-toggle"
        icon={playing ? 'pause' : 'play'}
        type="button"
        aria-label={playing ? '일시정지' : '재생'}
        onClick={() => void togglePlayback()}
      />
      <span className="audio-player-time" aria-live="off">
        {formatPlaybackTime(currentMs)} / {formatPlaybackTime(safeDurationMs)}
      </span>
      <input
        className="audio-player-range"
        type="range"
        min="0"
        max={safeDurationMs}
        step="100"
        value={currentMs}
        aria-label={`${label} 재생 위치`}
        aria-valuetext={`${formatPlaybackTime(currentMs)} / ${formatPlaybackTime(safeDurationMs)}`}
        disabled={safeDurationMs === 0}
        onChange={(event) => seek(Number(event.currentTarget.value))}
      />
      {error === null ? null : <span className="audio-player-error" role="alert">{error}</span>}
    </div>
  )
}
