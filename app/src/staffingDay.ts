export type StaffingDay = {
  date: string
  pickups: number
  dropoffs: number
  carsToWash: number
  staffAwayWeighted: number
  staffAwayCount: number
  staffsAway?: Array<{
    staffName: string
    startDate: string
    endDate: string
    reason: string
  }>
  pickupsList?: Array<{ id: string; time: string; vehicle?: string }>
  dropoffsList?: Array<{ id: string; time: string; vehicle?: string }>
}

export function calculateStaffingPressureScoreRaw(day: StaffingDay): number {
  return (
    // old formula: day.pickups * 2 + day.dropoffs * 1 + day.carsToWash * 4 + day.staffAwayWeighted * 3
    // new formula : only staff away and cars to wash are counted
    day.carsToWash * 4 + day.staffAwayWeighted * 3
  )
}
