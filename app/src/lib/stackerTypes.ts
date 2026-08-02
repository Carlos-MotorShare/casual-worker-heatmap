export type StackerSlot = {
  stacker: number
  level: number
  plate: string
  confidence: number
}

export type CloudflareStackerData = {
  timestamp: string | null
  cars: StackerSlot[]
}

export const STACKER_COUNT = 6
export const LEVEL_COUNT = 4

export function parseCloudflareStackerData(raw: unknown): CloudflareStackerData | null {
  if (!raw || typeof raw !== 'object') return null

  const o = raw as Record<string, unknown>
  const timestamp = typeof o.timestamp === 'string' ? o.timestamp : null
  const carsRoot = o.cars

  if (!carsRoot || typeof carsRoot !== 'object') {
    return { timestamp, cars: [] }
  }

  const carsArr = (carsRoot as Record<string, unknown>).cars
  if (!Array.isArray(carsArr)) {
    return { timestamp, cars: [] }
  }

  const cars: StackerSlot[] = []
  for (const item of carsArr) {
    if (!item || typeof item !== 'object') continue
    const slot = item as Record<string, unknown>
    const stacker = typeof slot.stacker === 'number' ? slot.stacker : NaN
    const level = typeof slot.level === 'number' ? slot.level : NaN
    const plate = typeof slot.plate === 'string' ? slot.plate.trim() : ''
    const confidence = typeof slot.confidence === 'number' ? slot.confidence : 0
    if (!Number.isFinite(stacker) || !Number.isFinite(level) || !plate) continue
    cars.push({ stacker, level, plate, confidence })
  }

  return { timestamp, cars }
}

export type StackerGrid = Record<number, Record<number, StackerSlot | null>>

export function buildStackerGrid(cars: StackerSlot[]): StackerGrid {
  const grid: StackerGrid = {}
  for (let s = 1; s <= STACKER_COUNT; s++) {
    grid[s] = {}
    for (let l = 1; l <= LEVEL_COUNT; l++) {
      grid[s][l] = null
    }
  }
  for (const car of cars) {
    if (
      car.stacker >= 1 &&
      car.stacker <= STACKER_COUNT &&
      car.level >= 1 &&
      car.level <= LEVEL_COUNT
    ) {
      grid[car.stacker][car.level] = car
    }
  }
  return grid
}

export function isVacantPlate(plate: string): boolean {
  const normalized = plate.replace(/\s+/g, '').toUpperCase()
  return normalized === 'EMPTY' || normalized === 'UNKNOWN'
}
