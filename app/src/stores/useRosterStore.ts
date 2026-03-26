import { create } from 'zustand'
import { eachDateInRange } from '../lib/rosterHelpers'
import type { RosterRow } from '../lib/rosterTypes'

const API_BASE =
  import.meta.env.REACT_APP_API_URL?.toString().trim() || 'http://localhost:3001'

function rowsByDate(rows: RosterRow[]): Record<string, RosterRow[]> {
  const out: Record<string, RosterRow[]> = {}
  for (const r of rows) {
    if (!out[r.date]) out[r.date] = []
    out[r.date].push(r)
  }
  return out
}

type RosterState = {
  rowsByDate: Record<string, RosterRow[]>
  loaded: boolean
  error: string | null
  loadRange: (startIso: string, endIso: string) => Promise<void>
  setRowsForDates: (rows: RosterRow[]) => void
}

export const useRosterStore = create<RosterState>((set) => ({
  rowsByDate: {},
  loaded: false,
  error: null,

  setRowsForDates: (rows) => {
    const byDate = rowsByDate(rows)
    set((state) => {
      const next = { ...state.rowsByDate }
      for (const [date, list] of Object.entries(byDate)) {
        next[date] = list
      }
      return { rowsByDate: next, loaded: true, error: null }
    })
  },

  loadRange: async (startIso, endIso) => {
    try {
      const res = await fetch(
        `${API_BASE}/api/rosters?start=${encodeURIComponent(startIso)}&end=${encodeURIComponent(endIso)}`,
      )
      if (!res.ok) {
        const msg = (await res.json().catch(() => ({}))) as { error?: string }
        throw new Error(msg.error || `Failed to load rosters (${res.status})`)
      }
      const json = (await res.json()) as { rows?: RosterRow[] }
      const rows = Array.isArray(json.rows) ? json.rows : []
      const byDate = rowsByDate(rows)
      set((state) => {
        const merged = { ...state.rowsByDate }
        for (const d of eachDateInRange(startIso, endIso)) {
          merged[d] = byDate[d] ?? []
        }
        return { rowsByDate: merged, loaded: true, error: null }
      })
    } catch (e) {
      const message = e instanceof Error ? e.message : 'Failed to load rosters'
      set({ error: message })
      console.error('[rosters]', e)
    }
  },
}))
