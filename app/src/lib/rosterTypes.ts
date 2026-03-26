export type User = {
  id: string
  username: string
  /** CSS hex from DB, e.g. #FFFFFF */
  colour?: string | null
  /** When true, may remove any roster block */
  admin?: boolean
}

export type RosterRow = {
  blockId: string
  rosterId: string
  userId: string
  date: string
  username: string
  /** CSS hex from users.colour */
  colour: string | null
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
