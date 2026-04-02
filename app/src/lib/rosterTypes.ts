export type User = {
  id: string
  username: string
  /** CSS hex from DB, e.g. #FFFFFF */
  colour?: string | null
  /** When true, may remove any roster block */
  admin?: boolean
  /** When true, may assign/remove weekend shifts for others (Calendar) */
  canRoster?: boolean
}

export type RosterRow = {
  blockId: string
  rosterId: string
  userId: string
  date: string
  username: string
  /** CSS hex from users.colour */
  colour: string | null
  /** True when the roster row belongs to a user with admin=true (hidden on heatmap) */
  rosterUserIsAdmin?: boolean
  startTime: string
  endTime: string
}

export type TimeRangeMinutes = {
  startMinutes: number
  endMinutes: number
}

/** Contiguous 1-hour segments (0–11) on the 8:00–20:00 day chart. */
export type RosterTimelineRun = {
  username: string
  startSeg: number
  endSeg: number
}
