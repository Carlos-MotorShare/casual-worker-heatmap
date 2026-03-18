import { useEffect, useMemo, useState } from 'react'
import './App.css'
import HeatmapCalendar, {
  type StaffingDay,
} from './components/HeatmapCalendar'

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

  useEffect(() => {
    const controller = new AbortController()

    async function load() {
      try {
        const res = await fetch('http://localhost:3001/api/data', {
          signal: controller.signal,
        })

        if (!res.ok) {
          console.log('No data yet')
          // 404 = no data yet -> fall back to mock data
          return
        }

        const json: unknown = await res.json()
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
      } catch (err) {
        if ((err as { name?: string } | null)?.name === 'AbortError') return
      }
    }

    void load()
    return () => controller.abort()
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
          {generatedAt ? (
            <p style={{ marginTop: 8, fontSize: 14, opacity: 0.85 }}>
              Data generated at <code>{generatedAt}</code>
            </p>
          ) : null}
        </div>
        <HeatmapCalendar days={effectiveDays} />
      </section>
    </>
  )
}

export default App
