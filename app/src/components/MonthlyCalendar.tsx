import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from 'react'
import { createPortal } from 'react-dom'
import './MonthlyCalendar.css'
import WeekendRosterModal from './WeekendRosterModal'
import type { RosterRow, User } from '../lib/rosterTypes'

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

type TooltipLine = {
  key: string
  text: string
  color: string
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
  staffsAway?: StaffAway[]
  /** Lowercased username → CSS colour (from `/api/staff-colours`). */
  staffColourByLowerName?: Record<string, string>
  rosterRowsByDate?: Record<string, RosterRow[]>
  currentUser?: User | null
  onRosterChanged?: () => void
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

function clamp01(n: number) {
  return Math.max(0, Math.min(1, n))
}

function fixedTipFromRect(r: DOMRect) {
  const pad = 10
  const width = 220
  const left =
    pad +
    clamp01((r.left + r.width / 2 - width / 2 - pad) / (window.innerWidth - 2 * pad - width)) *
      (window.innerWidth - 2 * pad - width)
  const top = r.bottom + 10
  return { top, left, width }
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

function weekendStrokeKind(
  iso: string,
  rows: RosterRow[] | undefined,
  inMonth: boolean,
): 'empty' | 'staffed' | null {
  if (!inMonth) return null
  const d = parseIsoDateLocal(iso)
  if (!isWeekendCellDate(d)) return null
  const staffed = new Set(
    (rows ?? []).filter((r) => r.rosterUserIsAdmin !== true).map((r) => r.userId),
  ).size
  return staffed > 0 ? 'staffed' : 'empty'
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

export default function MonthlyCalendar({
  initialMonth,
  onMonthChange,
  staffsAway = [],
  staffColourByLowerName,
  rosterRowsByDate,
  currentUser = null,
  onRosterChanged,
}: MonthlyCalendarProps) {
  const [month, setMonth] = useState<Date>(() => startOfMonth(initialMonth ?? new Date()))
  const [incomingMonth, setIncomingMonth] = useState<Date | null>(null)
  const [transitionDir, setTransitionDir] = useState<1 | -1>(1)
  const [isAnimating, setIsAnimating] = useState(false)
  const [calendarMode, setCalendarMode] = useState<'staff_leave' | 'weekend_work'>('staff_leave')
  const [weekendModalIso, setWeekendModalIso] = useState<string | null>(null)
  const [activeTipIso, setActiveTipIso] = useState<string | null>(null)
  const [fixedTip, setFixedTip] = useState<{ top: number; left: number; width: number } | null>(
    null,
  )
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

  useEffect(() => {
    if (calendarMode !== 'weekend_work') setWeekendModalIso(null)
  }, [calendarMode])

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

  const weekdays = weekStartsOnMonday
    ? ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']
    : ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']

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

  const updateFixedTip = useCallback(() => {
    if (!activeTipIso) {
      setFixedTip(null)
      return
    }
    const el = document.querySelector(`[data-monthcal-iso="${CSS.escape(activeTipIso)}"]`)
    if (!el) {
      setFixedTip(null)
      return
    }
    const r = (el as HTMLElement).getBoundingClientRect()
    setFixedTip(fixedTipFromRect(r))
  }, [activeTipIso])

  /* Measure before paint so the first tap shows the tooltip (useEffect runs too late). */
  useLayoutEffect(() => {
    updateFixedTip()
  }, [activeTipIso, updateFixedTip])

  useEffect(() => {
    if (!activeTipIso) return
    const onMove = () => updateFixedTip()
    window.addEventListener('scroll', onMove, true)
    window.addEventListener('resize', onMove)
    return () => {
      window.removeEventListener('scroll', onMove, true)
      window.removeEventListener('resize', onMove)
    }
  }, [activeTipIso, updateFixedTip])

  const activeTipLines = useMemo((): TooltipLine[] => {
    if (!activeTipIso) return []
    const hits = currentAwayByIso.get(activeTipIso) ?? []
    return hits.map((sa) => ({
      key: `${sa.staffName}-${sa.startDate}-${sa.endDate}-${sa.reason}`,
      text: `${sa.staffName} — ${sa.reason}`,
      color: colorForStaffName(sa.staffName, staffColourByLowerName, rosterRowsByDate),
    }))
  }, [activeTipIso, currentAwayByIso, rosterRowsByDate, staffColourByLowerName])

  const hasActiveTip = activeTipLines.length > 0

  const runMonthTransition = (delta: number) => {
    if (isAnimating) return
    const next = addMonths(month, delta)
    setTransitionDir(delta > 0 ? 1 : -1)
    setIncomingMonth(next)
    requestAnimationFrame(() => setIsAnimating(true))
    setActiveTipIso(null)
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
            <span className="monthCalNavGlyph" aria-hidden="true">
              ‹
            </span>
          </button>
          <button
            type="button"
            className="monthCalNavBtn"
            onClick={() => runMonthTransition(1)}
            aria-label="Next month"
          >
            <span className="monthCalNavGlyph" aria-hidden="true">
              ›
            </span>
          </button>
        </div>
      </div>

      <div className="monthCalWeekdays" aria-hidden="true">
        {weekdays.map((w) => (
          <div key={w} className="monthCalWeekday">
            {w}
          </div>
        ))}
      </div>

      <div
        className="monthCalGrid"
        role="grid"
        aria-label="Month days"
        onPointerDown={(e) => {
          if (isAnimating) return
          if (e.button !== 0) return
          const startX = e.clientX
          const startY = e.clientY
          const pid = e.pointerId
          dragRef.current = {
            startX,
            startY,
            active: true,
            blocked: false,
            pointerId: pid,
          }
          /* Do not setPointerCapture — it prevents the first tap/click on child cells (tooltip). */
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
          <div
            className="monthCalLayer monthCalLayer--current"
          >
            {currentCells.map((c) => {
              const ws = weekendStrokeKind(c.iso, rosterRowsByDate?.[c.iso], c.inMonth)
              return (
              <div
                key={`current-${c.iso}`}
                className={[
                  'monthCalCell',
                  c.inMonth ? 'monthCalCell--in' : 'monthCalCell--out',
                  c.iso === todayIso ? 'monthCalCell--today' : '',
                  calendarMode === 'weekend_work' && ws === 'empty' ? 'monthCalCell--weekendEmpty' : '',
                  calendarMode === 'weekend_work' && ws === 'staffed'
                    ? 'monthCalCell--weekendStaffed'
                    : '',
                ]
                  .filter(Boolean)
                  .join(' ')}
                role="gridcell"
                tabIndex={0}
                aria-label={c.iso}
                data-monthcal-iso={c.iso}
                onMouseEnter={() => {
                  if (calendarMode !== 'staff_leave') return
                  if ((currentAwayByIso.get(c.iso) ?? []).length === 0) return
                  setActiveTipIso(c.iso)
                }}
                onMouseLeave={() => {
                  setActiveTipIso((cur) => (cur === c.iso ? null : cur))
                }}
                onKeyDown={(e) => {
                  if (calendarMode !== 'staff_leave') return
                  const hasAway = (currentAwayByIso.get(c.iso) ?? []).length > 0
                  if (!hasAway) return
                  if (e.key !== 'Enter' && e.key !== ' ') return
                  e.preventDefault()
                  setActiveTipIso((cur) => (cur === c.iso ? null : c.iso))
                }}
                onPointerUp={(e) => {
                  if (e.button !== 0) return
                  const s = dragRef.current
                  if (!s.active || s.pointerId !== e.pointerId) return
                  const dx = e.clientX - s.startX
                  if (s.blocked) return
                  if (Math.abs(dx) >= 60) return

                  if (calendarMode === 'weekend_work') {
                    if (!c.inMonth) return
                    if (!isWeekendCellDate(c.date)) return
                    e.stopPropagation()
                    setWeekendModalIso(c.iso)
                    return
                  }

                  if (calendarMode !== 'staff_leave') return
                  const hasAway = (currentAwayByIso.get(c.iso) ?? []).length > 0
                  if (!hasAway) return

                  e.stopPropagation()
                  const el = e.currentTarget as HTMLElement
                  setActiveTipIso((prev) => {
                    if (prev === c.iso) {
                      setFixedTip(null)
                      return null
                    }
                    setFixedTip(fixedTipFromRect(el.getBoundingClientRect()))
                    return c.iso
                  })
                }}
              >
                <div className="monthCalCellInner">
                  <span className="monthCalDayNum">{c.date.getDate()}</span>
                  {calendarMode === 'staff_leave' ? (
                    <div className="monthCalAwayLines" aria-hidden="true">
                      {(currentAwayByIso.get(c.iso) ?? []).map((sa) => {
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
                  ) : calendarMode === 'weekend_work' && currentUser?.admin ? (
                    <div className="monthCalAwayLines" aria-hidden="true">
                      {uniqueAdminRosterRows(rosterRowsByDate?.[c.iso]).map((r) => (
                        <span
                          key={`${c.iso}-wknd-adm-${r.userId}`}
                          className="monthCalAwayLine"
                          style={{
                            background: colorForStaffName(
                              r.username,
                              staffColourByLowerName,
                              rosterRowsByDate,
                            ),
                          }}
                        />
                      ))}
                    </div>
                  ) : null}
                </div>
              </div>
              )
            })}
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

      <div className="monthCalModeToggle" role="tablist" aria-label="Calendar mode">
        <button
          type="button"
          role="tab"
          aria-selected={calendarMode === 'staff_leave'}
          className={`monthCalModeBtn${calendarMode === 'staff_leave' ? ' monthCalModeBtn--active' : ''}`}
          onClick={() => setCalendarMode('staff_leave')}
        >
          Staff leave
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={calendarMode === 'weekend_work'}
          className={`monthCalModeBtn${calendarMode === 'weekend_work' ? ' monthCalModeBtn--active' : ''}`}
          onClick={() => setCalendarMode('weekend_work')}
        >
          Weekend work
        </button>
      </div>
      {calendarMode === 'weekend_work' ? (
        <p className="monthCalWeekendHint">Tap a weekend to assign work.</p>
      ) : null}
      {fixedTip && hasActiveTip
        ? createPortal(
            <div
              className="monthCalTip"
              role="tooltip"
              style={{ top: fixedTip.top, left: fixedTip.left, width: fixedTip.width }}
              onMouseEnter={() => {
                // keep open when hovering tooltip
                if (!activeTipIso) return
                setActiveTipIso(activeTipIso)
              }}
              onMouseLeave={() => setActiveTipIso(null)}
              onClick={(e) => {
                // allow tap anywhere on tooltip to close
                e.stopPropagation()
                setActiveTipIso(null)
              }}
            >
              {activeTipLines.map((l) => (
                <div key={l.key} className="monthCalTipRow">
                  <span className="monthCalTipDot" style={{ background: l.color }} />
                  <span className="monthCalTipText">{l.text}</span>
                </div>
              ))}
            </div>,
            document.body,
          )
        : null}
      {currentUser && weekendModalIso ? (
        <WeekendRosterModal
          open={!!weekendModalIso}
          dateIso={weekendModalIso}
          currentUser={currentUser}
          rosterRows={rosterRowsByDate?.[weekendModalIso] ?? []}
          onClose={() => setWeekendModalIso(null)}
          onChanged={() => onRosterChanged?.()}
        />
      ) : null}
    </section>
  )
}

