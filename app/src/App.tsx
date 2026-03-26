import { useEffect, useMemo, useState } from 'react'
import { Ring } from 'ldrs/react'
import 'ldrs/react/Ring.css'
import './App.css'
import HeatmapCalendar, {
  type StaffingDay,
} from './components/HeatmapCalendar'
import PasswordGate from './components/PasswordGate'
import ScheduleModal from './components/ScheduleModal'
import darkBG from './assets/darkBG.png'
import { getGreetingByTimeNZ } from './lib/rosterHelpers'
import { useRosterStore } from './stores/useRosterStore'
import { useUserStore } from './stores/useUserStore'

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
  const user = useUserStore((s) => s.user)
  const rowsByDate = useRosterStore((s) => s.rowsByDate)
  const loadRosterRange = useRosterStore((s) => s.loadRange)
  const [scheduleDay, setScheduleDay] = useState<StaffingDay | null>(null)

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
      const staffAwayWeighted = Math.max(
        0,
        (weekend ? 1 : 2) + (i % 5 === 0 ? 1 : 0),
      )

      const pickupsList =
        i === 0
          ? [
              { id: 'demo-p1', time: '9:30 AM', vehicle: 'Silver Corolla' },
              { id: 'demo-p2', time: '2:15 PM', vehicle: 'Blue SUV' },
            ]
          : i === 1
            ? [{ id: 'demo-p1', time: '11:00 AM', vehicle: 'White hatch' }]
            : i === 3
              ? [
                  { id: 'demo-p1', time: '10:30 AM', vehicle: 'Van' },
                  { id: 'demo-p2', time: '10:30 AM', vehicle: 'Sedan' },
                  { id: 'demo-p3', time: '10:30 AM' },
                  { id: 'demo-p4', time: '10:30 AM' },
                  { id: 'demo-p5', time: '10:30 AM' },
                  { id: 'demo-p6', time: '3:00 PM', vehicle: 'UTE' },
                ]
              : undefined

      const dropoffsList =
        i === 0
          ? [
              { id: 'demo-d1', time: '10:00 AM', vehicle: 'Red Mazda' },
              { id: 'demo-d2', time: '4:30 PM' },
            ]
          : i === 2
            ? [{ id: 'demo-d1', time: '1:45 PM', vehicle: 'Grey wagon' }]
            : undefined

      return {
        date: toISODate(date),
        pickups: Math.max(0, base + wave + (weekday === 1 ? 4 : 0)),
        dropoffs: Math.max(
          0,
          Math.round(base * 0.7) + Math.round(wave * 0.6),
        ),
        carsToWash: Math.max(0, Math.round(base * 0.9) + (weekend ? -2 : 2)),
        staffAwayWeighted,
        staffAwayCount: staffAwayWeighted,
        pickupsList,
        dropoffsList,
      }
    })
  }, [])

  const [days, setDays] = useState<StaffingDay[] | null>(null)
  const [generatedAt, setGeneratedAt] = useState<string | null>(null)
  const [liveStatus, setLiveStatus] = useState<
    'connecting' | 'connected' | 'error'
  >('connecting')
  /** Hide loader only after SSE is connected *and* at least this long (avoids flash). */
  const [minMainLoadDone, setMinMainLoadDone] = useState(false)

  useEffect(() => {
    const id = window.setTimeout(() => setMinMainLoadDone(true), 1000)
    return () => window.clearTimeout(id)
  }, [])

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

  /** Blur + spinner until connected and at least 1s on screen (no sub-second flash). */
  const showMainLoader = !(liveStatus === 'connected' && minMainLoadDone)

  const effectiveDays = days && days.length ? days : mockDays

  const rosterWindow = useMemo(() => {
    const list = effectiveDays.map((d) => d.date).sort()
    if (!list.length) return { start: '', end: '' }
    return { start: list[0], end: list[list.length - 1] }
  }, [effectiveDays])

  useEffect(() => {
    if (!user) return
    if (!rosterWindow.start || !rosterWindow.end) return
    void loadRosterRange(rosterWindow.start, rosterWindow.end)
  }, [user, rosterWindow.start, rosterWindow.end, loadRosterRange])

  /** Casual workers schedule themselves; admins do not use this control. */
  const canSchedule = Boolean(
    user && user.admin !== true,
  )
  const greeting =
    user && user.username ? getGreetingByTimeNZ(user.username) : null

  return (
    <PasswordGate>
      <>
        <div
          style={{
            filter: showMainLoader ? 'blur(10px)' : 'none',
            transition: 'filter 180ms ease',
            pointerEvents: showMainLoader ? 'none' : 'auto',
          }}
        >
          <section id="center">
            <div
              className="rosterHeroImageWrap"
              style={{
                width: 'min(980px, 100%)',
                boxShadow: 'var(--shadow)',
                overflow: 'hidden',
              }}
              aria-label="Roster image"
            >
              <img
                src={darkBG}
                alt=""
                style={{
                  width: 'clamp(160px, 22vw, 280px)',
                  maxWidth: '32%',
                  height: 'auto',
                  display: 'block',
                  opacity: 1,
                  margin: '0 auto',
                }}
                onError={(e) => {
                  ;(e.currentTarget as HTMLImageElement).style.display = 'none'
                }}
              />
            </div>

            <div style={{ width: 'min(980px, 100%)' }}>
              <h1>Casual Worker Roster</h1>

              <p style={{ marginBottom: greeting ? 20 : 20 }}>
                14‑day staffing pressure based on pickups, dropoffs, cars to wash,
                and staff away.
              </p>

              {greeting ? (
                <p
                  style={{
                    marginTop: 10,
                    marginBottom: 10,
                    fontSize: '1.20rem',
                    fontWeight: 600,
                    color: 'var(--text-h)',
                  }}
                >
                  {greeting}
                </p>
              ) : null}
            </div>

            <HeatmapCalendar
              days={effectiveDays}
              rosterByDate={rowsByDate}
              canSchedule={canSchedule}
              currentUser={user}
              onRosterBlockDeleted={() => {
                if (rosterWindow.start && rosterWindow.end) {
                  void loadRosterRange(rosterWindow.start, rosterWindow.end)
                }
              }}
              onScheduleRequest={(d) => setScheduleDay(d)}
            />

            <ScheduleModal
              open={!!scheduleDay && !!user}
              dateIso={scheduleDay?.date ?? ''}
              userId={user?.id ?? ''}
              onClose={() => setScheduleDay(null)}
              onSaved={() => {
                if (rosterWindow.start && rosterWindow.end) {
                  void loadRosterRange(rosterWindow.start, rosterWindow.end)
                }
              }}
            />
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
        </div>
        {showMainLoader ? (
          <div
            role="presentation"
            style={{
              position: 'fixed',
              inset: 0,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              zIndex: 999998,
              background: 'color-mix(in srgb, var(--bg-900), transparent 55%)',
              backdropFilter: 'blur(10px)',
              WebkitBackdropFilter: 'blur(10px)',
            }}
          >
            <Ring
              size="40"
              stroke="6"
              bgOpacity="0"
              speed="1.6"
              color="white"
            />
          </div>
        ) : null}
      </>
    </PasswordGate>
  )
}

export default App
