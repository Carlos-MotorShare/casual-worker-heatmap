import type { RosterRow, RosterTimelineRun, TimeRangeMinutes, User } from './rosterTypes'
import {
  TIMELINE_END_MINUTES,
  TIMELINE_SEGMENT_COUNT,
  TIMELINE_START_MINUTES,
} from './dayTimeline'

/** 8:00 AM → 8:00 PM in 30-minute steps (NZ business day). */
export const DAY_START_MINUTES = 8 * 60
export const DAY_END_MINUTES = 20 * 60
export const BLOCK_MINUTES = 30
export const BLOCK_COUNT = (DAY_END_MINUTES - DAY_START_MINUTES) / BLOCK_MINUTES

const NZ_TIMEZONE = 'Pacific/Auckland'

/** Civil date YYYY-MM-DD is Saturday or Sunday (UTC; aligns with server `isWeekendIso`). */
export function isWeekendIso(iso: string): boolean {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso.trim())
  if (!m) return false
  const y = Number(m[1])
  const mo = Number(m[2])
  const d = Number(m[3])
  const day = new Date(Date.UTC(y, mo - 1, d)).getUTCDay()
  return day === 0 || day === 6
}

/** Heatmap shows only non–admin workers (admins share tables for weekend self-roster). */
export function rosterRowsForHeatmap(rows: RosterRow[] | undefined): RosterRow[] {
  if (!rows?.length) return []
  return rows.filter((r) => r.rosterUserIsAdmin !== true)
}

export type TimeBlockDescriptor = {
  index: number
  startMinutes: number
  endMinutes: number
}

/**
 * Returns every 30-minute slot with absolute minutes from midnight (same wall clock as stored times).
 */
export function mapTimeToBlocks(): TimeBlockDescriptor[] {
  return Array.from({ length: BLOCK_COUNT }, (_, i) => {
    const startMinutes = DAY_START_MINUTES + i * BLOCK_MINUTES
    return {
      index: i,
      startMinutes,
      endMinutes: startMinutes + BLOCK_MINUTES,
    }
  })
}

/**
 * Parses "HH:MM:SS" or "HH:MM" from Postgres / API into minutes from midnight.
 */
export function parseTimeToMinutes(time: string): number | null {
  const m = /^(\d{1,2}):(\d{2})(?::(\d{2}))?$/.exec(time.trim())
  if (!m) return null
  const h = Number.parseInt(m[1], 10)
  const min = Number.parseInt(m[2], 10)
  const s = m[3] ? Number.parseInt(m[3], 10) : 0
  if (h < 0 || h > 23 || min < 0 || min > 59 || s !== 0) return null
  return h * 60 + min
}

export function minutesToPgTime(mins: number): string {
  const h = Math.floor(mins / 60) % 24
  const m = mins % 60
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:00`
}

/**
 * Merges consecutive selected block indices into contiguous minute ranges.
 */
export function groupBlocksIntoRanges(selectedIndices: number[]): TimeRangeMinutes[] {
  const sorted = [...new Set(selectedIndices)].sort((a, b) => a - b)
  const ranges: TimeRangeMinutes[] = []

  for (const idx of sorted) {
    if (idx < 0 || idx >= BLOCK_COUNT) continue
    const startMinutes = DAY_START_MINUTES + idx * BLOCK_MINUTES
    const endMinutes = startMinutes + BLOCK_MINUTES
    const last = ranges[ranges.length - 1]
    if (last && last.endMinutes === startMinutes) {
      last.endMinutes = endMinutes
    } else {
      ranges.push({ startMinutes, endMinutes })
    }
  }
  return ranges
}

function formatMinutesShort(
  mins: number,
  locale: string,
  options: Intl.DateTimeFormatOptions,
): string {
  const d = new Date(Date.UTC(1970, 0, 1, Math.floor(mins / 60) % 24, mins % 60, 0))
  return d.toLocaleTimeString(locale, { timeZone: 'UTC', ...options })
}

/**
 * Human-readable ranges like "2:00 pm–5:00 pm & 7:00 pm–8:00 pm" (en-NZ style).
 */
export function formatReadableRanges(
  ranges: TimeRangeMinutes[],
  locale = 'en-NZ',
): string {
  if (!ranges.length) return ''
  return ranges
    .map((r) => {
      const start = formatMinutesShort(r.startMinutes, locale, {
        hour: 'numeric',
        minute: r.startMinutes % 60 === 0 ? undefined : '2-digit',
        hour12: true,
      })
      const end = formatMinutesShort(r.endMinutes, locale, {
        hour: 'numeric',
        minute: r.endMinutes % 60 === 0 ? undefined : '2-digit',
        hour12: true,
      })
      return `${start.trim()}–${end.trim()}`
    })
    .join(' & ')
}

/**
 * "Friday the 15th" in NZ timezone for an ISO date YYYY-MM-DD.
 */
export function formatDayOrdinalNZ(isoDate: string): string {
  const d = new Date(`${isoDate}T12:00:00`)
  if (!Number.isFinite(d.getTime())) return isoDate
  const weekday = new Intl.DateTimeFormat('en-NZ', {
    timeZone: NZ_TIMEZONE,
    weekday: 'long',
  }).format(d)
  const dayNum = new Intl.DateTimeFormat('en-NZ', {
    timeZone: NZ_TIMEZONE,
    day: 'numeric',
  }).format(d)
  const suffix = ordinalSuffix(Number(dayNum))
  return `${weekday} the ${dayNum}${suffix}`
}

function ordinalSuffix(n: number): string {
  const abs = Math.abs(n) % 100
  if (abs >= 11 && abs <= 13) return 'th'
  switch (n % 10) {
    case 1:
      return 'st'
    case 2:
      return 'nd'
    case 3:
      return 'rd'
    default:
      return 'th'
  }
}

export function getGreetingByTimeNZ(username: string): string {
  const parts = new Intl.DateTimeFormat('en-NZ', {
    timeZone: NZ_TIMEZONE,
    hour: 'numeric',
    hour12: false,
  }).formatToParts(new Date())
  const hour = Number(parts.find((p) => p.type === 'hour')?.value ?? '12')
  if (hour >= 5 && hour < 12) return `Good morning, ${username}`
  if (hour >= 12 && hour < 18) return `Good afternoon, ${username}`
  return `Good evening, ${username}`
}

export function summarizeRosterForDay(rows: RosterRow[]): {
  usernames: string[]
  count: number
} {
  const usernames = [...new Set(rows.map((r) => r.username))]
  return { usernames, count: usernames.length }
}

/** Inclusive ISO date strings (UTC calendar). */
export function eachDateInRange(startIso: string, endIso: string): string[] {
  const [sy, sm, sd] = startIso.split('-').map((x) => Number.parseInt(x, 10))
  const [ey, em, ed] = endIso.split('-').map((x) => Number.parseInt(x, 10))
  const out: string[] = []
  const cur = new Date(Date.UTC(sy, sm - 1, sd))
  const end = new Date(Date.UTC(ey, em - 1, ed))
  while (cur <= end) {
    out.push(cur.toISOString().slice(0, 10))
    cur.setUTCDate(cur.getUTCDate() + 1)
  }
  return out
}

/**
 * Per-user contiguous runs on the 1-hour timeline (for connected orange lines).
 */
export function rosterContiguousRunsForTimeline(rows: RosterRow[]): RosterTimelineRun[] {
  const byUser = new Map<string, boolean[]>()
  for (const row of rows) {
    const start = parseTimeToMinutes(row.startTime)
    const end = parseTimeToMinutes(row.endTime)
    if (start === null || end === null || end <= start) continue
    const clipStart = Math.max(start, TIMELINE_START_MINUTES)
    const clipEnd = Math.min(end, TIMELINE_END_MINUTES)
    if (clipEnd <= clipStart) continue
    let flags = byUser.get(row.username)
    if (!flags) {
      flags = Array.from({ length: TIMELINE_SEGMENT_COUNT }, () => false)
      byUser.set(row.username, flags)
    }
    for (let i = 0; i < TIMELINE_SEGMENT_COUNT; i++) {
      const segStart = TIMELINE_START_MINUTES + i * 60
      const segEnd = segStart + 60
      if (Math.max(clipStart, segStart) < Math.min(clipEnd, segEnd)) {
        flags[i] = true
      }
    }
  }
  const runs: RosterTimelineRun[] = []
  for (const [username, flags] of byUser) {
    let a = 0
    while (a < flags.length) {
      if (!flags[a]) {
        a++
        continue
      }
      let b = a
      while (b + 1 < flags.length && flags[b + 1]) b++
      runs.push({ username, startSeg: a, endSeg: b })
      a = b + 1
    }
  }
  return runs.sort(
    (x, y) =>
      x.startSeg - y.startSeg ||
      x.endSeg - y.endSeg ||
      x.username.localeCompare(y.username),
  )
}

export type RosterDaySummaryLine = { username: string; ranges: string }

/**
 * Merged time ranges per user for copy under the day chart.
 */
export function rosterSummaryLinesForDay(rows: RosterRow[]): RosterDaySummaryLine[] {
  const grouped = new Map<string, Array<{ start: number; end: number }>>()
  for (const row of rows) {
    const start = parseTimeToMinutes(row.startTime)
    const end = parseTimeToMinutes(row.endTime)
    if (start === null || end === null || end <= start) continue
    const list = grouped.get(row.username) ?? []
    list.push({ start, end })
    grouped.set(row.username, list)
  }
  const out: RosterDaySummaryLine[] = []
  for (const [username, ranges] of grouped) {
    ranges.sort((a, b) => a.start - b.start)
    const merged: Array<{ start: number; end: number }> = []
    for (const range of ranges) {
      const prev = merged[merged.length - 1]
      if (prev && prev.end >= range.start) {
        prev.end = Math.max(prev.end, range.end)
      } else {
        merged.push({ ...range })
      }
    }
    out.push({
      username,
      ranges: merged
        .map((r) => `${formatMinutesLabel(r.start)}–${formatMinutesLabel(r.end)}`)
        .join(' & '),
    })
  }
  return out.sort((a, b) => a.username.localeCompare(b.username))
}

export function formatMinutesLabel(minutes: number): string {
  const d = new Date(Date.UTC(1970, 0, 1, Math.floor(minutes / 60) % 24, minutes % 60, 0))
  return d
    .toLocaleTimeString('en-NZ', {
      timeZone: 'UTC',
      hour: 'numeric',
      minute: minutes % 60 === 0 ? undefined : '2-digit',
      hour12: true,
    })
    .replace(/\s+/g, '')
}

export type RosterSegmentMarker = {
  userId: string
  username: string
  colour: string | null
}

/**
 * Per 1-hour segment (0–11), who is working (for swatches beside the block column).
 */
export function segmentMarkersForTimeline(rows: RosterRow[]): RosterSegmentMarker[][] {
  const markers: RosterSegmentMarker[][] = Array.from(
    { length: TIMELINE_SEGMENT_COUNT },
    () => [],
  )
  const seen = Array.from({ length: TIMELINE_SEGMENT_COUNT }, () => new Set<string>())
  for (const row of rows) {
    const start = parseTimeToMinutes(row.startTime)
    const end = parseTimeToMinutes(row.endTime)
    if (start === null || end === null || end <= start) continue
    const clipStart = Math.max(start, TIMELINE_START_MINUTES)
    const clipEnd = Math.min(end, TIMELINE_END_MINUTES)
    if (clipEnd <= clipStart) continue
    for (let i = 0; i < TIMELINE_SEGMENT_COUNT; i++) {
      const segStart = TIMELINE_START_MINUTES + i * 60
      const segEnd = segStart + 60
      if (Math.max(clipStart, segStart) < Math.min(clipEnd, segEnd)) {
        if (!seen[i].has(row.userId)) {
          seen[i].add(row.userId)
          markers[i].push({
            userId: row.userId,
            username: row.username,
            colour: row.colour,
          })
        }
      }
    }
  }
  for (const m of markers) {
    m.sort((a, b) => a.username.localeCompare(b.username))
  }
  return markers
}

export function resolveUserColour(colour: string | null | undefined): string {
  if (typeof colour === 'string' && /^#[0-9A-Fa-f]{6}$/.test(colour)) return colour
  return '#fb923c'
}

export type RosterSummaryLineDetail = {
  userId: string
  username: string
  colour: string | null
  rangesDisplay: string
  blocks: Array<{ blockId: string; label: string }>
}

export function rosterSummaryDetailForDay(rows: RosterRow[]): RosterSummaryLineDetail[] {
  const byUser = new Map<
    string,
    { username: string; colour: string | null; rows: RosterRow[] }
  >()
  for (const row of rows) {
    const ex = byUser.get(row.userId)
    if (ex) {
      ex.rows.push(row)
    } else {
      byUser.set(row.userId, { username: row.username, colour: row.colour, rows: [row] })
    }
  }
  const out: RosterSummaryLineDetail[] = []
  for (const [userId, { username, colour, rows: userRows }] of byUser) {
    userRows.sort((a, b) => a.startTime.localeCompare(b.startTime))
    const blocks = userRows.map((r) => {
      const s = parseTimeToMinutes(r.startTime)
      const e = parseTimeToMinutes(r.endTime)
      if (s === null || e === null) return { blockId: r.blockId, label: '' }
      return {
        blockId: r.blockId,
        label: `${formatMinutesLabel(s)}–${formatMinutesLabel(e)}`,
      }
    })
    const ranges = userRows
      .map((r) => {
        const s = parseTimeToMinutes(r.startTime)
        const e = parseTimeToMinutes(r.endTime)
        if (s === null || e === null) return null
        return { start: s, end: e }
      })
      .filter((x): x is { start: number; end: number } => x !== null)
    ranges.sort((a, b) => a.start - b.start)
    const merged: Array<{ start: number; end: number }> = []
    for (const range of ranges) {
      const prev = merged[merged.length - 1]
      if (prev && prev.end >= range.start) {
        prev.end = Math.max(prev.end, range.end)
      } else {
        merged.push({ ...range })
      }
    }
    const rangesDisplay = merged
      .map((r) => `${formatMinutesLabel(r.start)}–${formatMinutesLabel(r.end)}`)
      .join(' & ')
    out.push({
      userId,
      username,
      colour,
      rangesDisplay,
      blocks,
    })
  }
  return out.sort((a, b) => a.username.localeCompare(b.username))
}

export function canActorRemoveRosterLine(
  line: RosterSummaryLineDetail,
  user: User | null,
  dayDateIso: string,
): boolean {
  if (!user) return false
  if (line.userId === user.id || user.admin === true) return true
  return user.canRoster === true && isWeekendIso(dayDateIso)
}
