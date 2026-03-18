import './HeatmapCalendar.css'

export type StaffingDay = {
  date: string
  pickups: number
  dropoffs: number
  carsToWash: number
  staffAway: number
}

export function calculateStaffingPressureScoreRaw(day: StaffingDay): number {
  return (
    day.pickups * 2 + day.dropoffs * 1 + day.carsToWash * 2 + day.staffAway * 3
  )
}

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

function formatDDMMYYYY(dateStr: string) {
  const d = new Date(dateStr)
  if (!Number.isFinite(d.getTime())) return dateStr
  // en-GB gives dd/mm/yyyy; convert to dd-mm-yyyy
  return d
    .toLocaleDateString('en-GB', {
      day: '2-digit',
      month: '2-digit',
      year: 'numeric',
    })
    .replaceAll('/', '-')
}

function colorForScore(score0to100: number) {
  const s = clamp(score0to100, 0, 100)
  if (s <= 33) return { label: 'Low need', base: '#16a34a' } // green
  if (s <= 66) return { label: 'Medium need', base: '#f59e0b' } // yellow/amber
  return { label: 'High need', base: '#ef4444' } // red
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
}

export default function HeatmapCalendar({
  days,
  title = 'Staffing pressure (next 14 days)',
}: HeatmapCalendarProps) {
  const window = days.slice(0, 14)
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

    return {
      day,
      raw,
      score0to100: scoreInt,
      label,
      dow,
      shortDate: short,
    }
  })

  return (
    <section className="heatmapWrap" aria-label={title}>
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
        {normalized.map((d, idx) => {
          const col = idx % 7
          const preferLeft = col >= 5

          return (
            <div
              key={d.day.date}
              className="dayCard"
              role="gridcell"
            >
              <div className="dayBg" style={bgStyleForScore(d.score0to100)} />
              <div className="dayTopRow">
                <div>
                  <div className="dayDow">{d.dow}</div>
                  <div className="dayDate">{d.shortDate}</div>
                </div>
                <div className="scorePill" aria-label="Staffing score">
                  {d.score0to100}
                </div>
              </div>
              <p className="scoreBig">{d.score0to100}</p>
              <div className="scoreLabel">{d.label}</div>

              <div
                className={`dayHoverInfo${preferLeft ? ' dayHoverInfoLeft' : ''}`}
                role="tooltip"
                aria-hidden="true"
              >
                <div className="dayHoverInfoTitle">
                  {formatDDMMYYYY(d.day.date)}
                </div>
                <div className="dayHoverInfoRow">
                  <span>Pickups</span>
                  <span>{d.day.pickups}</span>
                </div>
                <div className="dayHoverInfoRow">
                  <span>Dropoffs</span>
                  <span>{d.day.dropoffs}</span>
                </div>
                <div className="dayHoverInfoRow">
                  <span>Cars to wash</span>
                  <span>{d.day.carsToWash}</span>
                </div>
                <div className="dayHoverInfoRow">
                  <span>Staff away</span>
                  <span>{d.day.staffAway}</span>
                </div>
              </div>
            </div>
          )
        })}
      </div>
    </section>
  )
}

