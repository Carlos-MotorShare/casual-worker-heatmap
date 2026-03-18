import './App.css'
import HeatmapCalendar, {
  type StaffingDay,
} from './components/HeatmapCalendar'

function App() {
  const today = new Date()
  const addDays = (d: Date, n: number) => {
    const next = new Date(d)
    next.setDate(next.getDate() + n)
    return next
  }
  const toISODate = (d: Date) => d.toISOString().slice(0, 10)

  const days: StaffingDay[] = Array.from({ length: 14 }, (_, i) => {
    const date = addDays(today, i)
    const weekday = date.getDay() // 0 Sun ... 6 Sat
    const weekend = weekday === 0 || weekday === 6

    // sample data: busier mid-week, lighter weekend
    const base = weekend ? 6 : 12
    const wave = Math.round(6 * Math.sin((i / 13) * Math.PI))

    return {
      date: toISODate(date),
      pickups: Math.max(0, base + wave + (weekday === 1 ? 4 : 0)),
      dropoffs: Math.max(0, Math.round(base * 0.7) + Math.round(wave * 0.6)),
      carsToWash: Math.max(0, Math.round(base * 0.9) + (weekend ? -2 : 2)),
      staffAway: Math.max(0, (weekend ? 1 : 2) + (i % 5 === 0 ? 1 : 0)),
    }
  })

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
        <HeatmapCalendar days={days} />
      </section>
    </>
  )
}

export default App
