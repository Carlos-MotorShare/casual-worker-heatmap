import { useEffect, useMemo, useState } from 'react'
import './App.css'
import HeatmapCalendar, {
  type StaffingDay,
} from './components/HeatmapCalendar'

const API_BASE_URL =
  import.meta.env.REACT_APP_API_URL?.toString().trim() || 'http://localhost:3001'

function formatGeneratedAt(value: string | null) {
  if (!value) return '—'
  const d = new Date(value)
  if (!Number.isFinite(d.getTime())) return value
  return new Intl.DateTimeFormat(undefined, {
    year: 'numeric',
    month: 'short',
    day: '2-digit',
    hour: 'numeric',
    minute: '2-digit',
  }).format(d)
}

function App() {
  const mockDays = useMemo((): StaffingDay[] => {
    const today = new Date()
    const addDays = (d: Date, n: number) => {
      const next = new Date(d)
      next.setDate(next.getDate() + n)
      return next
    }
    const toISODate = (d: Date) => d.toISOString().slice(0, 10)

    return Array.from({ length: 14 }, (_, i) => {
      const date = addDays(today, i)
      const weekday = date.getDay() // 0 Sun ... 6 Sat
      const weekend = weekday === 0 || weekday === 6

      // sample data: busier mid-week, lighter weekend
      const base = weekend ? 6 : 12
      const wave = Math.round(6 * Math.sin((i / 13) * Math.PI))

      return {
        date: toISODate(date),
        pickups: Math.max(0, base + wave + (weekday === 1 ? 4 : 0)),
        dropoffs: Math.max(
          0,
          Math.round(base * 0.7) + Math.round(wave * 0.6),
        ),
        carsToWash: Math.max(0, Math.round(base * 0.9) + (weekend ? -2 : 2)),
        staffAway: Math.max(0, (weekend ? 1 : 2) + (i % 5 === 0 ? 1 : 0)),
      }
    })
  }, [])

  const [days, setDays] = useState<StaffingDay[] | null>(null)
  const [generatedAt, setGeneratedAt] = useState<string | null>(null)
  const [liveStatus, setLiveStatus] = useState<
    'connecting' | 'connected' | 'error'
  >('connecting')

  useEffect(() => {
    const es = new EventSource(`${API_BASE_URL}/api/stream`)

    const onConnected = () => setLiveStatus('connected')

    const onData = (e: MessageEvent) => {
      try {
        const json: unknown = JSON.parse(String(e.data))
        if (json && typeof json === 'object') {
          const maybeGeneratedAt = (json as { generatedAt?: unknown }).generatedAt
          const maybeDays = (json as { days?: unknown }).days

          if (typeof maybeGeneratedAt === 'string') {
            setGeneratedAt(maybeGeneratedAt)
          }
          if (Array.isArray(maybeDays) && maybeDays.length > 0) {
            // Trust server contract; clamp to 14 in component anyway.
            setDays(maybeDays as StaffingDay[])
          }
        }
      } catch {
        // ignore malformed events
      }
    }

    es.addEventListener('connected', onConnected)
    es.addEventListener('data', onData)
    es.onerror = () => {
      setLiveStatus('error')
      // EventSource will auto-reconnect; we keep showing last known (or mock) data.
    }

    return () => {
      es.removeEventListener('connected', onConnected)
      es.removeEventListener('data', onData)
      es.close()
    }
  }, [])

  const effectiveDays = days && days.length ? days : mockDays

  return (
    <>
      <section id="center">
        <div>
          <h1>Casual worker heatmap</h1>
          <p style={{ marginTop: 8 }}>
            14‑day staffing pressure based on pickups, dropoffs, cars to wash, and
            staff away.
          </p>
        </div>
        <HeatmapCalendar days={effectiveDays} />
        <div
          style={{
            width: 'min(980px, 100%)',
            margin: '10px auto 0',
            textAlign: 'left',
            fontSize: 12,
            opacity: 0.85,
            display: 'grid',
            gap: 6,
          }}
        >
          <div>
            Data last received:{' '}
            <code>{formatGeneratedAt(generatedAt)}</code>
          </div>
          <div>
            Status:{' '}
            <code>
              {liveStatus === 'connecting'
                ? 'connecting'
                : liveStatus === 'connected'
                  ? 'connected'
                  : 'disconnected'}
            </code>
          </div>
        </div>
      </section>
    </>
  )
}

export default App
