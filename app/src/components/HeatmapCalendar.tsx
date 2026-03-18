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

function colorForScore(score0to100: number) {
  const s = clamp(score0to100, 0, 100)
  if (s <= 33) return { label: 'Low need', base: '#16a34a' } // green
  if (s <= 66) return { label: 'Medium need', base: '#f59e0b' } // yellow/amber
  return { label: 'High need', base: '#ef4444' } // red
}

function bgStyleForScore(score0to100: number) {
  const { base } = colorForScore(score0to100)
  return {
    background: `radial-gradient(120% 120% at 20% 20%, color-mix(in srgb, ${base}, white 65%) 0%, color-mix(in srgb, ${base}, white 82%) 42%, color-mix(in srgb, ${base}, white 92%) 100%)`,
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
        {normalized.map((d) => {
          const tooltip = [
            d.day.date,
            `Score: ${d.score0to100}/100 (${d.label})`,
            `Raw: ${d.raw}`,
            `Pickups: ${d.day.pickups}`,
            `Dropoffs: ${d.day.dropoffs}`,
            `Cars to wash: ${d.day.carsToWash}`,
            `Staff away: ${d.day.staffAway}`,
          ].join('\n')

          return (
            <div
              key={d.day.date}
              className="dayCard"
              role="gridcell"
              title={tooltip}
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
            </div>
          )
        })}
      </div>
    </section>
  )
}

