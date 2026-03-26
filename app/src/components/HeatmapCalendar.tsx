import { useCallback, useState } from 'react'
import './HeatmapCalendar.css'
import DayDetailModal from './DayDetailModal'
import { summarizeRosterForDay } from '../lib/rosterHelpers'
import type { RosterRow, User } from '../lib/rosterTypes'
import {
  calculateStaffingPressureScoreRaw,
  type StaffingDay,
} from '../staffingDay'

export type { StaffingDay } from '../staffingDay'

function clamp(n: number, min: number, max: number) {
  return Math.max(min, Math.min(max, n))
}

function formatDay(dateStr: string) {
  const d = new Date(dateStr)
  const isValid = Number.isFinite(d.getTime())
  if (!isValid) {
    return { dow: '—', short: dateStr }
  }
  return {
    dow: d.toLocaleDateString(undefined, { weekday: 'short' }),
    short: d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' }),
  }
}

function colorForScore(score0to100: number) {
  const s = clamp(score0to100, 0, 100)
  if (s <= 33) return { label: 'Low need', base: '#16a34a' } // green
  if (s <= 66) return { label: 'Medium need', base: '#f59e0b' } // yellow/amber
  return { label: 'High need', base: '#ef4444' } // red
}

function todayIsoInNewZealand() {
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
}

function bgStyleForScore(score0to100: number) {
  const { base } = colorForScore(score0to100)
  return {
    background: [
        `radial-gradient(140% 120% at 15% 15%, color-mix(in srgb, ${base}, white 37%) 0%, color-mix(in srgb, ${base}, white 50%) 40%, color-mix(in srgb, ${base}, white 60%) 100%)`,
        `radial-gradient(100% 80% at 85% 85%, color-mix(in srgb, ${base}, black 8%) 0%, transparent 60%)`,
        'linear-gradient(180deg, rgba(255,255,255,0.25), rgba(255,255,255,0.05))',
        'linear-gradient(180deg, rgba(0,0,0,0.05), rgba(0,0,0,0.015))'
      ].join(', ')
  } as const
}

export type HeatmapCalendarProps = {
  days: StaffingDay[]
  title?: string
  rosterByDate?: Record<string, RosterRow[]>
  canSchedule?: boolean
  onScheduleRequest?: (day: StaffingDay) => void
  currentUser?: User | null
  onRosterBlockDeleted?: () => void
}

export default function HeatmapCalendar({
  days,
  title = 'Staffing pressure',
  rosterByDate,
  canSchedule = false,
  onScheduleRequest,
  currentUser = null,
  onRosterBlockDeleted,
}: HeatmapCalendarProps) {
  const [modalDay, setModalDay] = useState<StaffingDay | null>(null)

  const openDay = useCallback(
    (day: StaffingDay) => {
      setModalDay(day)
    },
    [],
  )

  const nzToday = todayIsoInNewZealand()
  const window = days.filter((day) => day.date >= nzToday).slice(0, 14)
  const raws = window.map(calculateStaffingPressureScoreRaw)
  const minRaw = raws.length ? Math.min(...raws) : 0
  const maxRaw = raws.length ? Math.max(...raws) : 0
  const denom = maxRaw - minRaw

  const normalized = window.map((day, idx) => {
    const raw = raws[idx] ?? 0
    const score =
      denom <= 0 ? 0 : clamp(((raw - minRaw) / denom) * 100, 0, 100)
    const scoreInt = Math.round(score)
    const { dow, short } = formatDay(day.date)
    const { label } = colorForScore(scoreInt)
    const rosterSummary = summarizeRosterForDay(
      rosterByDate?.[day.date] ?? [],
    )

    return {
      day,
      raw,
      score0to100: scoreInt,
      label,
      dow,
      shortDate: short,
      rosterSummary,
    }
  })

  return (
    <section className="heatmapWrap" aria-label={title}>
      <DayDetailModal
        day={modalDay}
        onClose={() => setModalDay(null)}
        rosterRows={
          modalDay ? rosterByDate?.[modalDay.date] ?? [] : []
        }
        canSchedule={canSchedule}
        currentUser={currentUser}
        onRosterBlockDeleted={onRosterBlockDeleted}
        onScheduleClick={() => {
          if (!modalDay) return
          onScheduleRequest?.(modalDay)
        }}
      />
      <div className="heatmapHeader">
        <h2>{title}</h2>
        <div className="legend" aria-label="Legend">
          <span className="legendItem">
            <span className="legendSwatch" style={{ background: '#16a34a' }} />
            Low
          </span>
          <span className="legendItem">
            <span className="legendSwatch" style={{ background: '#f59e0b' }} />
            Medium
          </span>
          <span className="legendItem">
            <span className="legendSwatch" style={{ background: '#ef4444' }} />
            High
          </span>
        </div>
      </div>

      <div className="heatmapHeaderMeta">
        Normalized to 0–100 within this 14‑day window.
      </div>

      <div className="heatmapGrid" role="grid" aria-label="14 day grid">
        {normalized.map((d) => {
          return (
            <div
              key={d.day.date}
              className="dayCard dayCard--interactive"
              role="gridcell"
              tabIndex={0}
              aria-haspopup="dialog"
              aria-label={`${d.dow} ${d.shortDate}, staffing score ${d.score0to100}. Open details.`}
              onClick={() => openDay(d.day)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' || e.key === ' ') {
                  e.preventDefault()
                  openDay(d.day)
                }
              }}
            >
              <div className="dayBg" style={bgStyleForScore(d.score0to100)} />
              <div className="dayTopRow">
                <div>
                  <div className="dayDow">{d.dow}</div>
                  <div className="dayDate">{d.shortDate}</div>
                </div>
                <div className="dayTopRowAside">
                  <div className="carsBadge" aria-label="Cars to wash">
                    <span className="carsBadgeValue" role="img" aria-label="soap">
                      🧼 {d.day.carsToWash}
                    </span>
                  </div>
                  {d.rosterSummary.count > 0 ? (
                    <div
                      className="dayRosterBubble"
                      aria-label={`Roster: ${d.rosterSummary.usernames.join(', ')}`}
                    >
                      <span className="dayRosterBubbleTag">Roster</span>
                      <span className="dayRosterBubbleNames">
                        {d.rosterSummary.usernames.length <= 3
                          ? d.rosterSummary.usernames.join(', ')
                          : `${d.rosterSummary.usernames.slice(0, 2).join(', ')} +${d.rosterSummary.count - 2}`}
                      </span>
                    </div>
                  ) : null}
                </div>
              </div>
              <p className="scoreBig">{d.score0to100}</p>
              <div className="scoreLabel">{d.label}</div>
            </div>
          )
        })}
      </div>
    </section>
  )
}

