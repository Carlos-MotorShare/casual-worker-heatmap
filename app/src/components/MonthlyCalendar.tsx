import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react'
import { createPortal } from 'react-dom'
import './MonthlyCalendar.css'
import DayDetailPanel from './DayDetailPanel'
import type { RosterRow, User } from '../lib/rosterTypes'
import type { DirtyCar, StaffingDay } from '../staffingDay'
import { calculateStaffingPressureScoreRaw } from '../staffingDay'
import { rosterRowsForHeatmap } from '../lib/rosterHelpers'

function startOfMonth(d: Date) {
  return new Date(d.getFullYear(), d.getMonth(), 1)
}

function addMonths(d: Date, delta: number) {
  return new Date(d.getFullYear(), d.getMonth() + delta, 1)
}

function isoDateLocal(d: Date) {
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}

type Cell = {
  date: Date
  iso: string
  inMonth: boolean
}

export type StaffAway = {
  staffName: string
  startDate: string
  endDate: string
  reason: string
}

function buildMonthGrid(anchorMonth: Date, weekStartsOnMonday: boolean): Cell[] {
  const monthStart = startOfMonth(anchorMonth)
  const monthEnd = new Date(anchorMonth.getFullYear(), anchorMonth.getMonth() + 1, 0)

  // JS: 0 Sun..6 Sat. We want offset from week start.
  const startDow = monthStart.getDay()
  const weekStart = weekStartsOnMonday ? 1 : 0
  const offset = (startDow - weekStart + 7) % 7

  const gridStart = new Date(monthStart)
  gridStart.setDate(monthStart.getDate() - offset)

  const cells: Cell[] = []
  for (let i = 0; i < 42; i++) {
    const d = new Date(gridStart)
    d.setDate(gridStart.getDate() + i)
    const inMonth = d >= monthStart && d <= monthEnd
    cells.push({ date: d, iso: isoDateLocal(d), inMonth })
  }
  return cells
}

export type MonthlyCalendarProps = {
  initialMonth?: Date
  onMonthChange?: (month: Date) => void
  days?: StaffingDay[]
  staffsAway?: StaffAway[]
  dirtyCars?: DirtyCar[]
  /** Lowercased username → CSS colour (from `/api/staff-colours`). */
  staffColourByLowerName?: Record<string, string>
  rosterRowsByDate?: Record<string, RosterRow[]>
  currentUser?: User | null
  onRosterChanged?: () => void
  onScheduleRequest?: (day: StaffingDay) => void
}

function isoDayOnly(iso: string) {
  const m = iso.match(/^(\d{4}-\d{2}-\d{2})/)
  return m ? m[1] : iso.slice(0, 10)
}

function parseIsoDateLocal(iso: string) {
  // Treat YYYY-MM-DD as local date (avoid TZ drift). Supports timestamps by taking first 10 chars.
  const day = isoDayOnly(iso)
  const [y, m, d] = day.split('-').map((v) => Number(v))
  return new Date(y ?? 1970, (m ?? 1) - 1, d ?? 1)
}

function addDaysLocal(d: Date, n: number) {
  const next = new Date(d)
  next.setDate(next.getDate() + n)
  return next
}

function isoAddDays(iso: string, delta: number): string {
  return isoDateLocal(addDaysLocal(parseIsoDateLocal(iso), delta))
}

function isAwayOnDate(sa: StaffAway, iso: string): boolean {
  const d = isoDayOnly(iso)
  return isoDayOnly(sa.startDate) <= d && isoDayOnly(sa.endDate) >= d
}

function isWeekendCellDate(d: Date) {
  const day = d.getDay()
  return day === 0 || day === 6
}

function uniqueAdminRosterRows(rows: RosterRow[] | undefined): RosterRow[] {
  if (!rows?.length) return []
  const seen = new Set<string>()
  const out: RosterRow[] = []
  for (const r of rows) {
    if (r.rosterUserIsAdmin !== true) continue
    if (seen.has(r.userId)) continue
    seen.add(r.userId)
    out.push(r)
  }
  return out
}

/** Non-admin roster rows (casual self-roster), deduplicated by userId. */
function uniqueNonAdminRosterRows(rows: RosterRow[] | undefined): RosterRow[] {
  if (!rows?.length) return []
  const seen = new Set<string>()
  const out: RosterRow[] = []
  for (const r of rows) {
    if (r.rosterUserIsAdmin === true) continue
    if (seen.has(r.userId)) continue
    seen.add(r.userId)
    out.push(r)
  }
  return out
}

function hashStringToInt(s: string) {
  // Small, stable hash for palette selection.
  let h = 2166136261
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i)
    h = Math.imul(h, 16777619)
  }
  return h >>> 0
}

const FALLBACK_STAFF_PALETTE = [
  '#22c55e', // green
  '#3b82f6', // blue
  '#f59e0b', // amber
  '#ef4444', // red
  '#a855f7', // purple
  '#06b6d4', // cyan
  '#f97316', // orange
  '#84cc16', // lime
  '#ec4899', // pink
] as const

function colorForStaffName(
  staffName: string,
  staffColourByLowerName?: Record<string, string>,
  rosterRowsByDate?: Record<string, RosterRow[]>,
) {
  const key = staffName.trim()
  const lower = key.toLowerCase()
  const fromUsers = staffColourByLowerName?.[lower]
  if (fromUsers) return fromUsers
  if (rosterRowsByDate) {
    for (const rows of Object.values(rosterRowsByDate)) {
      for (const r of rows) {
        if (r.username.trim().toLowerCase() === lower && r.colour) return r.colour
      }
    }
  }
  const idx = hashStringToInt(key) % FALLBACK_STAFF_PALETTE.length
  return FALLBACK_STAFF_PALETTE[idx] ?? '#ffffff'
}

function clamp(n: number, min: number, max: number) {
  return Math.max(min, Math.min(max, n))
}

/* ── Heatmap colour helpers ── */
function colorForScore(score0to100: number) {
  const s = clamp(score0to100, 0, 100)
  if (s <= 33) return '#16a34a' // green
  if (s <= 66) return '#f59e0b' // amber
  return '#ef4444' // red
}

function heatmapBgStyle(score0to100: number) {
  const base = colorForScore(score0to100)
  return {
    background: [
      `radial-gradient(140% 120% at 15% 15%, color-mix(in srgb, ${base}, white 37%) 0%, color-mix(in srgb, ${base}, white 50%) 40%, color-mix(in srgb, ${base}, white 60%) 100%)`,
      `radial-gradient(100% 80% at 85% 85%, color-mix(in srgb, ${base}, black 8%) 0%, transparent 60%)`,
      'linear-gradient(180deg, rgba(255,255,255,0.25), rgba(255,255,255,0.05))',
      'linear-gradient(180deg, rgba(0,0,0,0.05), rgba(0,0,0,0.015))',
    ].join(', '),
  }
}

export default function MonthlyCalendar({
  initialMonth,
  onMonthChange,
  days = [],
  staffsAway = [],
  dirtyCars: _dirtyCarsUnused = [],
  staffColourByLowerName,
  rosterRowsByDate,
  currentUser = null,
  onRosterChanged,
  onScheduleRequest,
}: MonthlyCalendarProps) {
  const isAdmin = currentUser?.admin === true
  const [month, setMonth] = useState<Date>(() => startOfMonth(initialMonth ?? new Date()))
  const [incomingMonth, setIncomingMonth] = useState<Date | null>(null)
  const [transitionDir, setTransitionDir] = useState<1 | -1>(1)
  const [isAnimating, setIsAnimating] = useState(false)
  const [bottomSheetIso, setBottomSheetIso] = useState<string | null>(null)
  const [bottomSheetEntered, setBottomSheetEntered] = useState(false)
  const [heatmapEnabled, setHeatmapEnabled] = useState(true)
  const [legendOpen, setLegendOpen] = useState(false)
  const [legendEntered, setLegendEntered] = useState(false)
  const dragRef = useRef<{
    startX: number
    startY: number
    active: boolean
    blocked: boolean
    pointerId: number | null
  }>({ startX: 0, startY: 0, active: false, blocked: false, pointerId: null })

  useEffect(() => {
    onMonthChange?.(month)
  }, [month, onMonthChange])

  /* ── Bottom sheet enter animation ── */
  useEffect(() => {
    if (!bottomSheetIso) {
      setBottomSheetEntered(false)
      return
    }
    setBottomSheetEntered(false)
    const id = requestAnimationFrame(() => setBottomSheetEntered(true))
    return () => cancelAnimationFrame(id)
  }, [bottomSheetIso])

  useEffect(() => {
    if (!bottomSheetIso) return
    const prev = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => { document.body.style.overflow = prev }
  }, [bottomSheetIso])

  /* ── Legend popup enter animation ── */
  useEffect(() => {
    if (!legendOpen) {
      setLegendEntered(false)
      return
    }
    setLegendEntered(false)
    const id = requestAnimationFrame(() => setLegendEntered(true))
    return () => cancelAnimationFrame(id)
  }, [legendOpen])

  const weekStartsOnMonday = true
  const currentCells = useMemo(() => buildMonthGrid(month, weekStartsOnMonday), [month])
  const nextCells = useMemo(
    () => (incomingMonth ? buildMonthGrid(incomingMonth, weekStartsOnMonday) : null),
    [incomingMonth],
  )

  const monthLabel = useMemo(
    () => month.toLocaleDateString(undefined, { month: 'long', year: 'numeric' }),
    [month],
  )

  const todayIso = useMemo(() => isoDateLocal(new Date()), [])
  const yesterdayIso = useMemo(() => {
    const d = new Date()
    d.setDate(d.getDate() - 1)
    return isoDateLocal(d)
  }, [])

  const weekdays = weekStartsOnMonday
    ? ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']
    : ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']

  /* ── Days data indexed by ISO ── */
  const dayByIso = useMemo(() => {
    const map: Record<string, StaffingDay> = {}
    for (const d of days) map[d.date] = d
    return map
  }, [days])

  /* ── Heatmap scoring (normalized across visible days) ── */
  const heatmapScoreByIso = useMemo(() => {
    if (days.length === 0) return {} as Record<string, number>
    // If days[0] is today, include it; otherwise skip it (it's a stale "yesterday" row)
    const scored = days[0]?.date === todayIso ? days : days.slice(1)
    if (scored.length === 0) return {} as Record<string, number>
    const raws = scored.map((d) => calculateStaffingPressureScoreRaw(d))
    const minRaw = Math.min(...raws)
    const maxRaw = Math.max(...raws)
    const denom = maxRaw - minRaw
    const out: Record<string, number> = {}
    scored.forEach((d, idx) => {
      const raw = raws[idx] ?? 0
      out[d.date] = denom <= 0 ? 0 : Math.round(clamp(((raw - minRaw) / denom) * 100, 0, 100))
    })
    return out
  }, [days, todayIso])

  const currentAwayByIso = useMemo(() => {
    const start = currentCells[0]?.date ? new Date(currentCells[0].date) : startOfMonth(month)
    const end = currentCells[currentCells.length - 1]?.date
      ? new Date(currentCells[currentCells.length - 1].date)
      : new Date(month.getFullYear(), month.getMonth() + 1, 0)

    const out = new Map<string, StaffAway[]>()
    if (!staffsAway.length) {
      return out
    }
    for (const sa of staffsAway) {
      const s = parseIsoDateLocal(sa.startDate)
      const e = parseIsoDateLocal(sa.endDate)
      if (!Number.isFinite(s.getTime()) || !Number.isFinite(e.getTime())) continue

      const rangeStart = s > start ? s : start
      const rangeEnd = e < end ? e : end
      if (rangeEnd < rangeStart) continue

      for (let d = new Date(rangeStart); d <= rangeEnd; d = addDaysLocal(d, 1)) {
        const iso = isoDateLocal(d)
        const list = out.get(iso)
        if (list) list.push(sa)
        else out.set(iso, [sa])
      }
    }

    for (const [iso, list] of out.entries()) {
      list.sort((a, b) => a.staffName.localeCompare(b.staffName))
      out.set(iso, list)
    }

    return out
  }, [staffsAway, currentCells, month])

  const runMonthTransition = (delta: number) => {
    if (isAnimating) return
    const next = addMonths(month, delta)
    setTransitionDir(delta > 0 ? 1 : -1)
    setIncomingMonth(next)
    requestAnimationFrame(() => setIsAnimating(true))
    setBottomSheetIso(null)
  }

  useEffect(() => {
    if (!isAnimating || !incomingMonth) return
    const id = window.setTimeout(() => {
      setMonth(incomingMonth)
      setIncomingMonth(null)
      setIsAnimating(false)
    }, 240)
    return () => window.clearTimeout(id)
  }, [incomingMonth, isAnimating])

  const commitSwipe = (deltaX: number) => {
    const threshold = 60
    if (Math.abs(deltaX) < threshold) return
    runMonthTransition(deltaX < 0 ? 1 : -1)
  }

  /* ── Cell interaction ── */
  const handleCellTap = useCallback((c: Cell) => {
    if (!c.inMonth) return
    // All days (weekday + weekend) → open bottom sheet day panel
    setBottomSheetIso((prev) => (prev === c.iso ? null : c.iso))
  }, [])

  /* ── Bottom sheet day data ── */
  const sheetDayReal = bottomSheetIso ? dayByIso[bottomSheetIso] ?? null : null
  /** Synthesize a minimal StaffingDay for days with no SSE data so
   *  weekend roster + absence sections still render. */
  const sheetDay: StaffingDay | null = bottomSheetIso
    ? sheetDayReal ?? {
        date: bottomSheetIso,
        pickups: 0,
        dropoffs: 0,
        carsToWash: 0,
        staffAwayWeighted: 0,
        staffAwayCount: 0,
      }
    : null
  const sheetDayHasRealData = sheetDayReal !== null && bottomSheetIso !== yesterdayIso
  const sheetDayRosterRows = bottomSheetIso
    ? rosterRowsForHeatmap(rosterRowsByDate?.[bottomSheetIso] ?? [])
    : []
  const canScheduleSheet = Boolean(
    currentUser && currentUser.admin !== true && bottomSheetIso,
  )

  /* ── Render a single calendar cell ── */
  const renderCell = (c: Cell, layerPrefix: string) => {
    const awayList = currentAwayByIso.get(c.iso) ?? []
    const weekendAdmins = uniqueAdminRosterRows(rosterRowsByDate?.[c.iso])
    const casualRosters = uniqueNonAdminRosterRows(rosterRowsByDate?.[c.iso])
    const dayData = dayByIso[c.iso]
    const heatScore = heatmapScoreByIso[c.iso]
    const showHeatmap = isAdmin && heatmapEnabled && heatScore !== undefined && c.inMonth
    const isExpanded = c.iso === bottomSheetIso

    return (
      <div
        key={`${layerPrefix}-${c.iso}`}
        className={[
          'monthCalCell',
          c.inMonth ? 'monthCalCell--in' : 'monthCalCell--out',
          c.iso === todayIso ? 'monthCalCell--today' : '',
          isExpanded ? 'monthCalCell--expanded' : '',
        ]
          .filter(Boolean)
          .join(' ')}
        role="gridcell"
        tabIndex={0}
        aria-label={c.iso}
        data-monthcal-iso={c.iso}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault()
            handleCellTap(c)
          }
        }}
        onPointerUp={(e) => {
          if (e.button !== 0) return
          const s = dragRef.current
          if (s.active && s.pointerId !== e.pointerId) return
          const dx = e.clientX - s.startX
          if (s.blocked) return
          if (Math.abs(dx) >= 60) return

          e.stopPropagation()
          e.preventDefault()

          handleCellTap(c)
        }}
      >
        {/* Heatmap background for admin */}
        {showHeatmap ? (
          <div className="monthCalCellHeatBg" style={heatmapBgStyle(heatScore)} />
        ) : null}

        <div className="monthCalCellInner">
          {/* Day number always at top */}
          <span className="monthCalDayNum">{c.date.getDate()}</span>

          {/* Weekend worker name bubbles below date */}
          {isWeekendCellDate(c.date) && weekendAdmins.length > 0 && c.inMonth ? (
            <div className="monthCalWeekendBubbles" aria-label="Weekend workers">
              {weekendAdmins.map((r) => (
                <span
                  key={`wb-${c.iso}-${r.userId}`}
                  className="monthCalWeekendBubble"
                  style={{
                    background: colorForStaffName(
                      r.username,
                      staffColourByLowerName,
                      rosterRowsByDate,
                    ),
                  }}
                  title={r.username}
                >
                  {r.username.charAt(0).toUpperCase()}
                </span>
              ))}
            </div>
          ) : null}

          {/* Non-admin (casual) self-roster bubbles — visible only for non-admin users */}
          {!isAdmin && casualRosters.length > 0 && c.inMonth ? (
            <div className="monthCalWeekendBubbles" aria-label="Rostered workers">
              {casualRosters.map((r) => (
                <span
                  key={`cb-${c.iso}-${r.userId}`}
                  className="monthCalWeekendBubble"
                  style={{
                    background: colorForStaffName(
                      r.username,
                      staffColourByLowerName,
                      rosterRowsByDate,
                    ),
                  }}
                  title={r.username}
                >
                  {r.username.charAt(0).toUpperCase()}
                </span>
              ))}
            </div>
          ) : null}

          {/* Cars to wash (visible for all users when data exists, hidden for yesterday) */}
          {dayData && c.inMonth && c.iso !== yesterdayIso ? (
            <span className="monthCalCarsCount" aria-label={`${dayData.carsToWash} cars to wash`}>
              🧼 {dayData.carsToWash}
            </span>
          ) : null}

          {/* Admin-only: casual worker roster indicator 🤝 +N (below soap) */}
          {isAdmin && casualRosters.length > 0 && c.inMonth ? (
            <span className="monthCalCasualIndicator" aria-label={`${casualRosters.length} casual worker${casualRosters.length > 1 ? 's' : ''} rostered`}>
              🤝 +{casualRosters.length}
            </span>
          ) : null}

          {/* Staff away indicators (admin only) */}
          {isAdmin && awayList.length > 0 ? (
            <div className="monthCalAwayLines" aria-hidden="true">
              {awayList.map((sa) => {
                const connectLeft = isAwayOnDate(sa, isoAddDays(c.iso, -1))
                const connectRight = isAwayOnDate(sa, isoAddDays(c.iso, 1))
                return (
                  <span
                    key={`${c.iso}-${sa.staffName}-${sa.startDate}-${sa.endDate}-${sa.reason}`}
                    className={[
                      'monthCalAwayLine',
                      connectLeft ? 'monthCalAwayLine--connectL' : '',
                      connectRight ? 'monthCalAwayLine--connectR' : '',
                    ]
                      .filter(Boolean)
                      .join(' ')}
                    style={{
                      background: colorForStaffName(
                        sa.staffName,
                        staffColourByLowerName,
                        rosterRowsByDate,
                      ),
                    }}
                  />
                )
              })}
            </div>
          ) : null}
        </div>
      </div>
    )
  }

  return (
    <section className="monthCalWrap" aria-label="Calendar">
      <div className="monthCalHeader">
        <div className="monthCalTitle" aria-label="Current month">
          {monthLabel}
        </div>
        <div className="monthCalHeaderNav">
          <button
            type="button"
            className="monthCalNavBtn"
            onClick={() => runMonthTransition(-1)}
            aria-label="Previous month"
          >
            <span className="monthCalNavGlyph" aria-hidden="true">‹</span>
          </button>
          <button
            type="button"
            className="monthCalNavBtn"
            onClick={() => runMonthTransition(1)}
            aria-label="Next month"
          >
            <span className="monthCalNavGlyph" aria-hidden="true">›</span>
          </button>
          <button
            type="button"
            className="monthCalLegendBtn"
            onClick={() => setLegendOpen(true)}
            aria-label="Calendar legend"
            title="What do the icons mean?"
          >
            ?
          </button>
        </div>
      </div>

      {/* Admin-only heatmap toggle + legend */}
      {isAdmin ? (
        <div className="monthCalHeatToggle">
          <label className="monthCalHeatLabel">
            <input
              type="checkbox"
              checked={heatmapEnabled}
              onChange={(e) => setHeatmapEnabled(e.target.checked)}
              className="monthCalHeatCheckbox"
            />
            <span>Heatmap colours</span>
          </label>
          {heatmapEnabled ? (
            <div className="monthCalHeatLegend" aria-label="Heatmap legend">
              <span className="monthCalHeatLegendItem">
                <span className="monthCalHeatSwatch" style={{ background: '#16a34a' }} />Low
              </span>
              <span className="monthCalHeatLegendItem">
                <span className="monthCalHeatSwatch" style={{ background: '#f59e0b' }} />Med
              </span>
              <span className="monthCalHeatLegendItem">
                <span className="monthCalHeatSwatch" style={{ background: '#ef4444' }} />High
              </span>
            </div>
          ) : null}
        </div>
      ) : null}

      <div className="monthCalWeekdays" aria-hidden="true">
        {weekdays.map((w) => (
          <div key={w} className="monthCalWeekday">{w}</div>
        ))}
      </div>

      <div
        className="monthCalGrid"
        role="grid"
        aria-label="Month days"
        onPointerDown={(e) => {
          if (isAnimating) return
          if (bottomSheetIso) return        // Block swipe while popup is open
          if (e.button !== 0) return
          const startX = e.clientX
          const startY = e.clientY
          const pid = e.pointerId
          dragRef.current = {
            startX, startY, active: true, blocked: false, pointerId: pid,
          }
          const onMove = (ev: PointerEvent) => {
            if (ev.pointerId !== pid) return
            const dx = ev.clientX - startX
            const dy = ev.clientY - startY
            const s = dragRef.current
            if (!s.blocked && Math.abs(dy) > 12 && Math.abs(dy) > Math.abs(dx)) {
              s.blocked = true
            }
          }
          const cleanup = () => {
            document.removeEventListener('pointermove', onMove)
            document.removeEventListener('pointerup', onUp)
            document.removeEventListener('pointercancel', onUp)
          }
          const onUp = (ev: PointerEvent) => {
            if (ev.pointerId !== pid) return
            cleanup()
            dragRef.current.active = false
            dragRef.current.pointerId = null
            commitSwipe(ev.clientX - startX)
          }
          document.addEventListener('pointermove', onMove)
          document.addEventListener('pointerup', onUp)
          document.addEventListener('pointercancel', onUp)
        }}
      >
        <div
          className={[
            'monthCalGridInner',
            transitionDir > 0 ? 'monthCalGridInner--next' : 'monthCalGridInner--prev',
            isAnimating ? 'monthCalGridInner--animating' : '',
          ].join(' ')}
        >
          <div className="monthCalLayer monthCalLayer--current">
            {currentCells.map((c) => renderCell(c, 'current'))}
          </div>
          {nextCells ? (
            <div className="monthCalLayer monthCalLayer--incoming" aria-hidden="true">
              {nextCells.map((c) => (
                <div
                  key={`incoming-${c.iso}`}
                  className={[
                    'monthCalCell',
                    c.inMonth ? 'monthCalCell--in' : 'monthCalCell--out',
                    c.iso === todayIso ? 'monthCalCell--today' : '',
                  ]
                    .filter(Boolean)
                    .join(' ')}
                >
                  <div className="monthCalCellInner">
                    <span className="monthCalDayNum">{c.date.getDate()}</span>
                  </div>
                </div>
              ))}
            </div>
          ) : null}
        </div>
      </div>

      {/* ── Unified bottom sheet day panel (replaces old expanded panel + weekend modal) ── */}
      {bottomSheetIso
        ? createPortal(
            <div
              className={`weekendRosterBackdrop${bottomSheetEntered ? ' weekendRosterBackdrop--visible' : ''}`}
              role="presentation"
              onPointerDown={(e) => e.stopPropagation()}
              onTouchStart={(e) => e.stopPropagation()}
              onClick={(e) => {
                if (e.target === e.currentTarget) setBottomSheetIso(null)
              }}
            >
              <div
                className={`weekendRosterPanel${bottomSheetEntered ? ' weekendRosterPanel--visible' : ''}`}
                role="dialog"
                aria-modal="true"
                tabIndex={-1}
              >
                {sheetDay ? (
                    <DayDetailPanel
                      day={sheetDay}
                      rosterRows={sheetDayRosterRows}
                      canSchedule={sheetDayHasRealData ? canScheduleSheet : false}
                      hasRealData={sheetDayHasRealData}
                      staffsAway={staffsAway}
                      currentUser={currentUser}
                      onRosterBlockDeleted={onRosterChanged}
                      onScheduleClick={() => {
                        if (sheetDay) onScheduleRequest?.(sheetDay)
                      }}
                      rightAction={
                        <button
                          type="button"
                          className="weekendRosterClose"
                          onClick={() => setBottomSheetIso(null)}
                          aria-label="Close day detail"
                        >
                          ×
                        </button>
                      }
                      tone="modal"
                      variant="expanded"
                      rosterRowsByDate={rosterRowsByDate}
                      staffColourByLowerName={staffColourByLowerName}
                    />
                ) : null}
              </div>
            </div>,
            document.body,
          )
        : null}

      {/* ── Calendar legend popup ── */}
      {legendOpen
        ? createPortal(
            <div
              className={`monthCalLegendBackdrop${legendEntered ? ' monthCalLegendBackdrop--visible' : ''}`}
              onClick={() => setLegendOpen(false)}
            >
              <div
                className={`monthCalLegendPopup${legendEntered ? ' monthCalLegendPopup--visible' : ''}`}
                onClick={(e) => e.stopPropagation()}
                role="dialog"
                aria-modal="true"
                aria-label="Calendar icon legend"
              >
                <div className="monthCalLegendHeader">
                  <span className="monthCalLegendTitle">Calendar legend</span>
                  <button
                    type="button"
                    className="monthCalLegendClose"
                    onClick={() => setLegendOpen(false)}
                    aria-label="Close legend"
                  >
                    ×
                  </button>
                </div>
                <ul className="monthCalLegendList">
                  <li className="monthCalLegendItem">
                    <span className="monthCalLegendIcon" aria-hidden="true">🧼 3</span>
                    <span className="monthCalLegendDesc">Number of cars to wash that day</span>
                  </li>
                  <li className="monthCalLegendItem">
                    <span className="monthCalLegendIcon" aria-hidden="true">🤝 +2</span>
                    <span className="monthCalLegendDesc">Casual workers rostered (admin only)</span>
                  </li>
                  <li className="monthCalLegendItem">
                    <span className="monthCalLegendIcon monthCalLegendBubble" aria-hidden="true">A</span>
                    <span className="monthCalLegendDesc">Worker initial — rostered for this day</span>
                  </li>
                  <li className="monthCalLegendItem">
                    <span className="monthCalLegendIcon monthCalLegendBar" aria-hidden="true" />
                    <span className="monthCalLegendDesc">Coloured bar — staff member away</span>
                  </li>
                  <li className="monthCalLegendItem">
                    <span className="monthCalLegendIcon monthCalLegendHeat monthCalLegendHeat--green" aria-hidden="true" />
                    <span className="monthCalLegendDesc">Heatmap: low staffing need</span>
                  </li>
                  <li className="monthCalLegendItem">
                    <span className="monthCalLegendIcon monthCalLegendHeat monthCalLegendHeat--amber" aria-hidden="true" />
                    <span className="monthCalLegendDesc">Heatmap: medium staffing need</span>
                  </li>
                  <li className="monthCalLegendItem">
                    <span className="monthCalLegendIcon monthCalLegendHeat monthCalLegendHeat--red" aria-hidden="true" />
                    <span className="monthCalLegendDesc">Heatmap: high staffing need</span>
                  </li>
                </ul>
              </div>
            </div>,
            document.body,
          )
        : null}
    </section>
  )
}
