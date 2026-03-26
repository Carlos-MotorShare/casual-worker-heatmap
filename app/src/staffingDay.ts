export type StaffingDay = {
  date: string
  pickups: number
  dropoffs: number
  carsToWash: number
  staffAwayWeighted: number
  staffAwayCount: number
  pickupsList?: Array<{ id: string; time: string; vehicle?: string }>
  dropoffsList?: Array<{ id: string; time: string; vehicle?: string }>
}

export function calculateStaffingPressureScoreRaw(day: StaffingDay): number {
  return (
    day.pickups * 2 + day.dropoffs * 1 + day.carsToWash * 4 + day.staffAwayWeighted * 3
  )
}
