import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { Ring } from 'ldrs/react'
import 'ldrs/react/Ring.css'
import './App.css'
import {
  type StaffingDay,
} from './staffingDay'
import PasswordGate from './components/PasswordGate'
import ScheduleModal from './components/ScheduleModal'
import { getGreetingByTimeNZ } from './lib/rosterHelpers'
import { useRosterStore } from './stores/useRosterStore'
import { useUserStore } from './stores/useUserStore'
import BottomNav, { type BottomNavKey } from './components/BottomNav'
import todayIcon from './assets/logo_white.png'
import calendarIcon from './assets/calendar.png'
import eventsIcon from './assets/events_white.png'
import moonIcon from './assets/moon.png'
import sunIcon from './assets/sun_white.png'
import darkBG from './assets/darkBG.png'
import lightBG from './assets/BG_white.png'
import settingsIcon from './assets/settings.png'
import settingsWhiteIcon from './assets/settings_white.png'
import DayDetailPanel from './components/DayDetailPanel'
import MonthlyCalendar from './components/MonthlyCalendar'
import { useTheme } from './lib/useTheme'

const API_BASE_URL =
  import.meta.env.REACT_APP_API_URL?.toString().trim() || 'http://localhost:3001'

/** First/last ISO dates in the 6×7 month grid (weeks start Monday). */
function monthGridIsoRange(anchor: Date): { start: string; end: string } {
  const monthStart = new Date(anchor.getFullYear(), anchor.getMonth(), 1)
  const startDow = monthStart.getDay()
  const weekStart = 1
  const offset = (startDow - weekStart + 7) % 7
  const gridStart = new Date(monthStart)
  gridStart.setDate(monthStart.getDate() - offset)
  const gridEnd = new Date(gridStart)
  gridEnd.setDate(gridStart.getDate() + 41)
  const iso = (d: Date) => {
    const y = d.getFullYear()
    const m = String(d.getMonth() + 1).padStart(2, '0')
    const day = String(d.getDate()).padStart(2, '0')
    return `${y}-${m}-${day}`
  }
  return { start: iso(gridStart), end: iso(gridEnd) }
}

function App() {
  const user = useUserStore((s) => s.user)
  const rowsByDate = useRosterStore((s) => s.rowsByDate)
  const loadRosterRange = useRosterStore((s) => s.loadRange)
  const loadAdminUsers = useRosterStore((s) => s.loadAdminUsers)
  const { theme, toggle: toggleTheme } = useTheme()
  const [scheduleDay, setScheduleDay] = useState<StaffingDay | null>(null)
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [settingsEntered, setSettingsEntered] = useState(false)
  const [activeTab, setActiveTab] = useState<BottomNavKey>('today')
  const prevTabRef = useRef<BottomNavKey>('today')
  const [leavingTab, setLeavingTab] = useState<BottomNavKey | null>(null)
  const [staffsAway, setStaffsAway] = useState<
    Array<{ staffName: string; startDate: string; endDate: string; reason: string }>
  >([])
  const [dirtyCars, setDirtyCars] = useState<
    Array<{ vehicleName: string; nextPickupDateTime: string | null }>
  >([])
  const [staffColourByLowerName, setStaffColourByLowerName] = useState<
    Record<string, string>
  >({})
  const [calendarMonth, setCalendarMonth] = useState(() => {
    const n = new Date()
    return new Date(n.getFullYear(), n.getMonth(), 1)
  })

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
  const [liveStatus, setLiveStatus] = useState<
    'connecting' | 'connected' | 'error'
  >('connecting')
  /** Hide loader only after SSE is connected *and* at least this long (avoids flash). */
  const [minMainLoadDone, setMinMainLoadDone] = useState(false)

  useEffect(() => {
    const id = window.setTimeout(() => setMinMainLoadDone(true), 1000)
    return () => window.clearTimeout(id)
  }, [])

  // Force enable interaction after 5 seconds even if not connected
  const [forceEnableAfterTimeout, setForceEnableAfterTimeout] = useState(false)
  useEffect(() => {
    const id = window.setTimeout(() => setForceEnableAfterTimeout(true), 5000)
    return () => window.clearTimeout(id)
  }, [])

  useEffect(() => {
    if (!user) {
      setStaffColourByLowerName({})
      return
    }
    // Load admin users for weekend roster modal caching
    void loadAdminUsers(user.id)
    
    let cancelled = false
    void (async () => {
      try {
        const res = await fetch(`${API_BASE_URL}/api/staff-colours`)
        if (!res.ok) return
        const json = (await res.json()) as {
          rows?: Array<{ username: string; colour: string | null }>
        }
        const rows = Array.isArray(json.rows) ? json.rows : []
        const map: Record<string, string> = {}
        for (const r of rows) {
          const u = typeof r.username === 'string' ? r.username.trim() : ''
          const c = typeof r.colour === 'string' ? r.colour.trim() : ''
          if (u && c) map[u.toLowerCase()] = c
        }
        if (user.username?.trim() && user.colour) {
          map[user.username.trim().toLowerCase()] = user.colour
        }
        if (!cancelled) setStaffColourByLowerName(map)
      } catch {
        // ignore
      }
    })()
    return () => {
      cancelled = true
    }
  }, [user, loadAdminUsers])

  useEffect(() => {
    const es = new EventSource(`${API_BASE_URL}/api/stream`)

    const onConnected = () => setLiveStatus('connected')

    const onData = (e: MessageEvent) => {
      try {
        const json: unknown = JSON.parse(String(e.data))
        if (json && typeof json === 'object') {
          const maybeGeneratedAt = (json as { generatedAt?: unknown }).generatedAt
          const maybeDays = (json as { days?: unknown }).days
          const maybeStaffsAway = (json as { staffsAway?: unknown }).staffsAway

          // generatedAt received but no longer displayed
          void maybeGeneratedAt
          if (Array.isArray(maybeDays) && maybeDays.length > 0) {
            // Trust server contract; clamp to 14 in component anyway.
            setDays(maybeDays as StaffingDay[])
          }
          const topLevelFiltered = Array.isArray(maybeStaffsAway)
            ? maybeStaffsAway.filter(
                (
                  x,
                ): x is { staffName: string; startDate: string; endDate: string; reason: string } =>
                  Boolean(x) &&
                  typeof x === 'object' &&
                  typeof (x as { staffName?: unknown }).staffName === 'string' &&
                  typeof (x as { startDate?: unknown }).startDate === 'string' &&
                  typeof (x as { endDate?: unknown }).endDate === 'string' &&
                  typeof (x as { reason?: unknown }).reason === 'string',
              )
            : null

          // If away data is nested inside each day, flatten it for the monthly calendar overlay.
          const nestedFlattened: Array<{
            staffName: string
            startDate: string
            endDate: string
            reason: string
          }> = []
          
          // Extract dirty cars from first day (if present)
          let dirtyCarsFromFirstDay: Array<{ vehicleName: string; nextPickupDateTime: string | null }> = []
          
          if (Array.isArray(maybeDays)) {
            for (const d of maybeDays) {
              if (!d || typeof d !== 'object') continue
              const o = d as Record<string, unknown>
              const arr = (o.staffsAway ?? o.staffs_away ?? o.staffsData ?? o.staffs_data) as unknown
              if (!Array.isArray(arr)) continue
              for (const x of arr) {
                if (!x || typeof x !== 'object') continue
                const xa = x as Record<string, unknown>
                const staffName = typeof xa.staffName === 'string' ? xa.staffName : ''
                const startDate = typeof xa.startDate === 'string' ? xa.startDate : ''
                const endDate = typeof xa.endDate === 'string' ? xa.endDate : ''
                const reason = typeof xa.reason === 'string' ? xa.reason : ''
                if (!staffName || !startDate || !endDate) continue
                nestedFlattened.push({ staffName, startDate, endDate, reason })
              }
            }
            
            // Extract dirty cars from the first day
            const firstDay = maybeDays[0]
            if (firstDay && typeof firstDay === 'object') {
              const firstDayObj = firstDay as Record<string, unknown>
              const dirtyCarsRaw = (firstDayObj.dirtyCars ?? firstDayObj.dirty_cars) as unknown
              if (Array.isArray(dirtyCarsRaw)) {
                dirtyCarsFromFirstDay = dirtyCarsRaw.filter(
                  (x): x is { vehicleName: string; nextPickupDateTime: string | null } =>
                    Boolean(x) &&
                    typeof x === 'object' &&
                    (typeof (x as { vehicleName?: unknown }).vehicleName === 'string' ||
                      typeof (x as { vehicle_name?: unknown }).vehicle_name === 'string'),
                ).map((x) => {
                  const xo = x as Record<string, unknown>
                  return {
                    vehicleName: typeof xo.vehicleName === 'string' ? xo.vehicleName : String(xo.vehicle_name ?? ''),
                    nextPickupDateTime: typeof xo.nextPickupDateTime === 'string' ? xo.nextPickupDateTime : (typeof xo.next_pickup_date_time === 'string' ? xo.next_pickup_date_time : null),
                  }
                })
              }
            }
          }

          const chosen = topLevelFiltered && topLevelFiltered.length > 0 ? topLevelFiltered : nestedFlattened
          setStaffsAway(chosen)
          setDirtyCars(dirtyCarsFromFirstDay)
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
  const showMainLoader = !(liveStatus === 'connected' && minMainLoadDone) && !forceEnableAfterTimeout

  const effectiveDays = days && days.length ? days : mockDays

  const rosterWindow = useMemo(() => {
    const list = effectiveDays.map((d) => d.date).sort()
    if (!list.length) return { start: '', end: '' }
    return { start: list[0], end: list[list.length - 1] }
  }, [effectiveDays])

  useEffect(() => {
    if (!user) return
    if (!rosterWindow.start || !rosterWindow.end) return
    const grid = monthGridIsoRange(calendarMonth)
    const start =
      rosterWindow.start < grid.start ? rosterWindow.start : grid.start
    const end = rosterWindow.end > grid.end ? rosterWindow.end : grid.end
    void loadRosterRange(start, end)
  }, [user, rosterWindow.start, rosterWindow.end, calendarMonth, loadRosterRange])

  const reloadAllRosters = () => {
    if (!user) return
    const grid = monthGridIsoRange(calendarMonth)
    if (!rosterWindow.start || !rosterWindow.end) {
      void loadRosterRange(grid.start, grid.end)
      return
    }
    const start =
      rosterWindow.start < grid.start ? rosterWindow.start : grid.start
    const end = rosterWindow.end > grid.end ? rosterWindow.end : grid.end
    void loadRosterRange(start, end)
  }

  /** Casual workers schedule themselves; admins do not use this control. */
  const canSchedule = Boolean(
    user && user.admin !== true,
  )
  const greeting =
    user && user.username ? getGreetingByTimeNZ(user.username) : null

  const todayIsoNZ = useMemo(() => {
    const parts = new Intl.DateTimeFormat('en-CA', {
      timeZone: 'Pacific/Auckland',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).formatToParts(new Date())
    const y = parts.find((p) => p.type === 'year')?.value ?? '0000'
    const m = parts.find((p) => p.type === 'month')?.value ?? '01'
    const d = parts.find((p) => p.type === 'day')?.value ?? '01'
    return `${y}-${m}-${d}`
  }, [])

  const todayDay = useMemo(() => {
    const hit = effectiveDays.find((d) => d.date === todayIsoNZ)
    if (hit) return hit
    // Fallback: nearest future day in stream (or first item).
    const sorted = [...effectiveDays].sort((a, b) => a.date.localeCompare(b.date))
    return sorted.find((d) => d.date >= todayIsoNZ) ?? sorted[0] ?? null
  }, [effectiveDays, todayIsoNZ])

  const navItems = useMemo(
    () => [
      { key: 'events' as const, label: 'Events', iconSrc: eventsIcon },
      { key: 'today' as const, label: 'Today', iconSrc: todayIcon },
      { key: 'calendar' as const, label: 'Calendar', iconSrc: calendarIcon },
    ],
    [],
  )

  const switchTab = (next: BottomNavKey) => {
    if (next === activeTab) return
    prevTabRef.current = activeTab
    setLeavingTab(activeTab)
    setActiveTab(next)
    window.setTimeout(() => {
      setLeavingTab((cur) => (cur === prevTabRef.current ? null : cur))
    }, 260)
  }

  useEffect(() => {
    // Scroll the active page to the top whenever the tab changes
    // Use requestAnimationFrame to ensure the DOM has updated and the scroll happens after layout
    const id = requestAnimationFrame(() => {
      const activePage = document.querySelector('.page--active')
      if (activePage) {
        activePage.scrollTop = 0
      }
    })
    return () => cancelAnimationFrame(id)
  }, [activeTab])

  /* ── Settings popup enter animation ── */
  useEffect(() => {
    if (!settingsOpen) {
      setSettingsEntered(false)
      return
    }
    setSettingsEntered(false)
    const id = requestAnimationFrame(() => setSettingsEntered(true))
    return () => cancelAnimationFrame(id)
  }, [settingsOpen])

  /* ── Close settings on Escape ── */
  const closeSettings = useCallback(() => setSettingsOpen(false), [])
  useEffect(() => {
    if (!settingsOpen) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') closeSettings()
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [settingsOpen, closeSettings])

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
          <div className="appShell">
            <div className="pageViewport" aria-label="Pages">
              <div
                className={[
                  'page',
                  activeTab === 'events' ? 'page--active' : '',
                  leavingTab === 'events' ? 'page--leaving' : '',
                ]
                  .filter(Boolean)
                  .join(' ')}
                aria-hidden={activeTab !== 'events'}
              >
                <section className="center">
                  <div style={{ width: 'min(980px, 100%)', textAlign: 'left' }}>
                    <h1 style={{ marginBottom: 12 }}>Events</h1>
                    <p style={{ marginBottom: 18, opacity: 0.6 }}>
                      Coming soon.
                    </p>
                  </div>
                </section>
              </div>

              <div
                className={[
                  'page',
                  activeTab === 'today' ? 'page--active' : '',
                  leavingTab === 'today' ? 'page--leaving' : '',
                ]
                  .filter(Boolean)
                  .join(' ')}
                aria-hidden={activeTab !== 'today'}
              >
                <div className="todayTopRightActions">
                  <button
                    type="button"
                    className="themeToggleBtn"
                    onClick={() => setSettingsOpen(true)}
                    aria-label="Open settings"
                    title="Settings"
                  >
                    <img
                      src={theme === 'dark' ? settingsWhiteIcon : settingsIcon}
                      alt=""
                      aria-hidden="true"
                      className="themeToggleIcon"
                    />
                  </button>
                  <button
                    type="button"
                    className="themeToggleBtn"
                    onClick={toggleTheme}
                    aria-label={theme === 'dark' ? 'Switch to light mode' : 'Switch to dark mode'}
                    title={theme === 'dark' ? 'Light mode' : 'Dark mode'}
                  >
                    <img
                      src={theme === 'dark' ? sunIcon : moonIcon}
                      alt=""
                      aria-hidden="true"
                      className="themeToggleIcon"
                    />
                  </button>
                </div>
                <section className="center">
                  <div style={{ width: 'min(980px, 100%)', textAlign: 'left' }}>
                    <img
                      src={theme === 'dark' ? darkBG : lightBG}
                      alt="Logo"
                      className="todayPageLogo"
                    />
                    {greeting ? (
                      <p
                        style={{
                          marginBottom: 8,
                          fontSize: '1.1rem',
                          fontWeight: 600,
                          color: 'var(--text-h)',
                        }}
                      >
                        {greeting}
                      </p>
                    ) : null}
                    <h1 style={{ marginBottom: 12 }}>Today</h1>
                    <p style={{ marginBottom: 18, opacity: 0.9 }}>
                      Current-day schedule, roster, and workload.
                    </p>
                  </div>
                  {todayDay ? (
                    <DayDetailPanel
                      day={todayDay}
                      rosterRows={rowsByDate?.[todayDay.date] ?? []}
                      canSchedule={canSchedule}
                      staffsAway={staffsAway}
                      dirtyCars={dirtyCars}
                      currentUser={user}
                      onRosterBlockDeleted={reloadAllRosters}
                      onScheduleClick={() => setScheduleDay(todayDay)}
                      variant="today"
                      staffColourByLowerName={staffColourByLowerName}
                      rosterRowsByDate={rowsByDate}
                    />
                  ) : (
                    <div style={{ width: 'min(980px, 100%)', textAlign: 'left' }}>
                      <p>No day data available.</p>
                    </div>
                  )}
                </section>
              </div>

              <div
                className={[
                  'page',
                  activeTab === 'calendar' ? 'page--active' : '',
                  leavingTab === 'calendar' ? 'page--leaving' : '',
                ]
                  .filter(Boolean)
                  .join(' ')}
                aria-hidden={activeTab !== 'calendar'}
              >
                <section className="center">
                  <div style={{ width: 'min(980px, 100%)', textAlign: 'left' }}>
                    <h1 style={{ marginBottom: 12 }}>Calendar</h1>
                    <p style={{ marginBottom: 18, opacity: 0.9 }}>
                      Swipe to navigate between months.
                    </p>
                  </div>
                  <MonthlyCalendar
                    onMonthChange={setCalendarMonth}
                    days={effectiveDays}
                    staffsAway={staffsAway}
                    dirtyCars={dirtyCars}
                    staffColourByLowerName={staffColourByLowerName}
                    rosterRowsByDate={rowsByDate}
                    currentUser={user}
                    onRosterChanged={reloadAllRosters}
                    onScheduleRequest={(d) => setScheduleDay(d)}
                  />
                </section>
              </div>
            </div>

            <BottomNav active={activeTab} onChange={switchTab} items={navItems} />
          </div>

          <ScheduleModal
            open={!!scheduleDay && !!user}
            dateIso={scheduleDay?.date ?? ''}
            userId={user?.id ?? ''}
            onClose={() => setScheduleDay(null)}
            onSaved={reloadAllRosters}
          />
        </div>

        {/* ── Settings top-sheet popup ── */}
        {settingsOpen
          ? createPortal(
              <div
                className={`settingsBackdrop${settingsEntered ? ' settingsBackdrop--visible' : ''}`}
                role="presentation"
                onClick={(e) => {
                  if (e.target === e.currentTarget) closeSettings()
                }}
              >
                <div
                  className={`settingsPanel${settingsEntered ? ' settingsPanel--visible' : ''}`}
                  role="dialog"
                  aria-modal="true"
                  aria-label="Settings"
                >
                  <div className="settingsHeader">
                    <h2 className="settingsTitle">Settings</h2>
                    <button
                      type="button"
                      className="settingsClose"
                      onClick={closeSettings}
                      aria-label="Close settings"
                    >
                      ×
                    </button>
                  </div>
                  <div className="settingsBody">
                    <p className="settingsLabel">WhatsApp notifications</p>
                    <p className="settingsSubtext">Coming soon</p>
                  </div>
                </div>
              </div>,
              document.body,
            )
          : null}

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
              color={theme === 'dark' ? 'white' : '#1a1a2e'}
            />
          </div>
        ) : null}
      </>
    </PasswordGate>
  )
}

export default App
