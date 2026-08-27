export type DirtyCar = {
  vehicleName: string
  nextPickupDateTime: string | null
}

export type FleetNextBooking = {
  vehicleName: string
  nextPickupDateTime: string | null
}

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
  fleetNextBookings?: FleetNextBooking[]
  dirtyCars?: DirtyCar[]
  pickupsList?: Array<{
    id: string
    time: string
    vehicle?: string
    nextPickupDateTime?: string | null
    nextBookingWithin24h?: boolean
  }>
  dropoffsList?: Array<{
    id: string
    time: string
    vehicle?: string
    nextPickupDateTime?: string | null
    nextBookingWithin24h?: boolean
  }>
}

export type HeatmapMetric = 'carsToWash' | 'pickups'

export function calculateHeatmapScoreRaw(
  day: StaffingDay,
  metric: HeatmapMetric = 'carsToWash',
): number {
  if (metric === 'pickups') return day.pickups * 4
  return day.carsToWash * 4 + day.staffAwayWeighted * 3
}

/** @deprecated Use calculateHeatmapScoreRaw(day, 'carsToWash') */
export function calculateStaffingPressureScoreRaw(day: StaffingDay): number {
  return calculateHeatmapScoreRaw(day, 'carsToWash')
}
