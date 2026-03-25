/** 8:00 AM → 8:00 PM in 1-hour steps (12 segments). */
export const TIMELINE_SEGMENT_COUNT = 12
export const TIMELINE_START_MINUTES = 8 * 60
export const TIMELINE_END_MINUTES = 20 * 60

export type TimelineEvent = { id: string; time: string }

export type TimelineSegmentBucket = {
  pickups: TimelineEvent[]
  dropoffs: TimelineEvent[]
}

/**
 * Parses times like "9:30 AM", "7:00 PM", "14:30", "9:30am".
 * Returns minutes from midnight, or null if unparseable.
 */
export function parseTimeStringToMinutes(timeString: string): number | null {
  const raw = timeString.trim()
  if (!raw) return null

  const upper = raw.toUpperCase().replace(/\s+/g, ' ')
  const m12 = upper.match(/^(\d{1,2}):(\d{2})\s*(AM|PM)$/)
  if (m12) {
    let h = Number.parseInt(m12[1], 10)
    const min = Number.parseInt(m12[2], 10)
    const ap = m12[3]
    if (min < 0 || min > 59 || h < 1 || h > 12) return null
    if (ap === 'PM' && h !== 12) h += 12
    if (ap === 'AM' && h === 12) h = 0
    return h * 60 + min
  }

  const m24 = upper.match(/^(\d{1,2}):(\d{2})$/)
  if (m24) {
    const h = Number.parseInt(m24[1], 10)
    const min = Number.parseInt(m24[2], 10)
    if (min < 0 || min > 59 || h < 0 || h > 23) return null
    return h * 60 + min
  }

  return null
}

/**
 * Maps a time string to segment index 0–11 (1-hour blocks from 8:00 AM).
 * Times before 8:00 AM map to 0; at or after 8:00 PM map to 11.
 */
export function mapTimeToSegmentIndex(timeString: string): number | null {
  const mins = parseTimeStringToMinutes(timeString)
  if (mins === null) return null
  if (mins < TIMELINE_START_MINUTES) return 0
  if (mins >= TIMELINE_END_MINUTES) return TIMELINE_SEGMENT_COUNT - 1
  return Math.floor((mins - TIMELINE_START_MINUTES) / 60)
}

export function segmentIndexToLabelStart(segmentIndex: number): string {
  const startMin = TIMELINE_START_MINUTES + segmentIndex * 60
  const h24 = Math.floor(startMin / 60)
  const min = startMin % 60
  const d = new Date(1970, 0, 1, h24, min, 0, 0)
  return d.toLocaleTimeString(undefined, {
    hour: 'numeric',
    minute: '2-digit',
  })
}

export function buildSegmentBuckets(
  pickupsList: TimelineEvent[] | undefined,
  dropoffsList: TimelineEvent[] | undefined,
): TimelineSegmentBucket[] {
  const segments: TimelineSegmentBucket[] = Array.from(
    { length: TIMELINE_SEGMENT_COUNT },
    () => ({ pickups: [], dropoffs: [] }),
  )

  for (const p of pickupsList ?? []) {
    const idx = mapTimeToSegmentIndex(p.time)
    if (idx !== null) segments[idx].pickups.push(p)
  }
  for (const d of dropoffsList ?? []) {
    const idx = mapTimeToSegmentIndex(d.time)
    if (idx !== null) segments[idx].dropoffs.push(d)
  }

  const sortByTime = (a: TimelineEvent, b: TimelineEvent) => {
    const ma = parseTimeStringToMinutes(a.time) ?? 0
    const mb = parseTimeStringToMinutes(b.time) ?? 0
    return ma - mb
  }
  for (const s of segments) {
    s.pickups.sort(sortByTime)
    s.dropoffs.sort(sortByTime)
  }

  return segments
}
