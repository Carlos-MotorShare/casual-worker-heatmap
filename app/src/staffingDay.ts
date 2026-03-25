export type StaffingDay = {
  date: string
  pickups: number
  dropoffs: number
  carsToWash: number
  staffAwayWeighted: number
  staffAwayCount: number
  pickupsList?: Array<{ id: string; time: string }>
  dropoffsList?: Array<{ id: string; time: string }>
}
