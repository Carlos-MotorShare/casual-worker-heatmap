import { useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import {
  buildStackerGrid,
  LEVEL_COUNT,
  STACKER_COUNT,
  type CloudflareStackerData,
} from '../lib/stackerTypes'
import { airtableNzDateTimeWallClockMs, nzWallClockNowMs } from '../lib/rosterHelpers'
import type { DirtyCar, FleetNextBooking, StaffingDay } from '../staffingDay'
import './StackersPanel.css'

type StackersPanelProps = {
  data: CloudflareStackerData | null
  days?: StaffingDay[]
}

type VehicleNameMap = Record<
  string,
  {
    displayName: string
    fullName: string
  }
>

type PresentVehicle = {
  vehicleId: string
  displayName: string
  fullName: string
  stacker: number
  level: number
  nextPickupDateTime: string | null
  nextPickupMs: number | null
}

type MoveRecommendation = {
  id: string
  title: string
  meta: string
  totalMoves: number
  steps: Array<{
    kind: 'remove' | 'target' | 'return' | 'hold'
    text: string
  }>
}

type VehicleLocation = {
  stacker: number
  level: number
}

const VEHICLE_IMAGE_EXTENSIONS = ['png', 'jpg', 'jpeg', 'webp']
const MAX_MOVE_RECOMMENDATIONS = 6
const MOVE_LOOKAHEAD_DAYS = 5

function formatUpdatedAt(iso: string | null): string | null {
  if (!iso) return null
  const d = new Date(iso)
  if (!Number.isFinite(d.getTime())) return null
  return d.toLocaleString(undefined, {
    day: 'numeric',
    month: 'short',
    hour: 'numeric',
    minute: '2-digit',
  })
}

function slotVariant(space: CloudflareStackerData['backendView']['occupiedSpaces'][number] | null): string {
  if (!space) return 'stackerLevel--unknown'
  if (space.status === 'occupied') return 'stackerLevel--occupied'
  if (space.status === 'review') return 'stackerLevel--review'
  return 'stackerLevel--vacant'
}

function slotTitle(space: CloudflareStackerData['backendView']['occupiedSpaces'][number] | null): string {
  if (!space) return 'No data'
  if (space.status === 'occupied') return space.vehicleId ?? 'Occupied'
  if (space.status === 'review') return space.vehicleId ?? 'Needs review'
  return 'Likely empty'
}

function VehicleImage({ vehicleId, fullName }: { vehicleId: string; fullName: string }) {
  const [extIndex, setExtIndex] = useState(0)
  const [hidden, setHidden] = useState(false)

  useEffect(() => {
    setExtIndex(0)
    setHidden(false)
  }, [vehicleId])

  if (hidden) return null

  const extension = VEHICLE_IMAGE_EXTENSIONS[extIndex]
  const src = `${import.meta.env.BASE_URL}vehicles/${encodeURIComponent(vehicleId)}.${extension}`

  return (
    <img
      src={src}
      alt={fullName}
      className="stackerVehicleImage"
      loading="lazy"
      onError={() => {
        if (extIndex < VEHICLE_IMAGE_EXTENSIONS.length - 1) {
          setExtIndex((current) => current + 1)
          return
        }
        setHidden(true)
      }}
    />
  )
}

function calculateTimeUntilPickup(pickupDateTime: string | null): string {
  if (!pickupDateTime) return 'No next booking.'

  try {
    const pickupMs = airtableNzDateTimeWallClockMs(pickupDateTime)
    if (!Number.isFinite(pickupMs)) return 'No next booking.'

    const diffMs = pickupMs - nzWallClockNowMs()
    if (diffMs <= 0) return 'Pickup now.'

    const diffHours = diffMs / (1000 * 60 * 60)
    const days = Math.floor(diffHours / 24)
    const hours = Math.floor(diffHours % 24)

    if (days > 0) {
      return `${days}d ${hours}h until next booking.`
    }
    return `${hours}h until next booking.`
  } catch {
    return 'No next booking.'
  }
}

function formatBookingLabel(pickupDateTime: string | null): string {
  if (!pickupDateTime) return 'No upcoming booking'
  const date = new Date(pickupDateTime)
  if (!Number.isFinite(date.getTime())) return 'No upcoming booking'
  return date.toLocaleString(undefined, {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
    hour: 'numeric',
    minute: '2-digit',
  })
}

function findNextBooking(
  fullName: string,
  fleetNextBookings: FleetNextBooking[],
): FleetNextBooking | null {
  const nowMs = nzWallClockNowMs()
  let best: FleetNextBooking | null = null
  let bestMs = Number.POSITIVE_INFINITY

  for (const car of fleetNextBookings) {
    console.log('[stackers] checking fleetNextBooking candidate', {
      requestedVehicleName: fullName,
      candidateVehicleName: car.vehicleName,
      candidateNextPickupDateTime: car.nextPickupDateTime,
    })
    if (car.vehicleName !== fullName) continue
    if (!car.nextPickupDateTime) {
      if (!best) best = car
      continue
    }
    const pickupMs = airtableNzDateTimeWallClockMs(car.nextPickupDateTime)
    if (!Number.isFinite(pickupMs)) continue
    if (pickupMs < nowMs) continue
    if (pickupMs < bestMs) {
      bestMs = pickupMs
      best = car
    }
  }

  console.log('[stackers] next booking lookup result', {
    requestedVehicleName: fullName,
    matchedVehicleName: best?.vehicleName ?? null,
    matchedNextPickupDateTime: best?.nextPickupDateTime ?? null,
    fleetNextBookingsCount: fleetNextBookings.length,
  })

  return best
}

function getVehiclesBelowLevel(
  stackerNum: number,
  currentLevel: number,
  stackerState: Map<number, Map<number, string | null>>,
  vehiclesById: Map<string, PresentVehicle>,
) {
  const blockers: Array<PresentVehicle & VehicleLocation> = []
  for (let lowerLevel = 1; lowerLevel < currentLevel; lowerLevel++) {
    const vehicleId = stackerState.get(stackerNum)?.get(lowerLevel) ?? null
    if (!vehicleId) continue
    const vehicle = vehiclesById.get(vehicleId)
    blockers.push(
      vehicle ?? {
        vehicleId,
        displayName: vehicleId,
        fullName: vehicleId,
        stacker: stackerNum,
        level: lowerLevel,
        nextPickupDateTime: null,
        nextPickupMs: null,
      },
    )
  }
  return blockers
}

function getVehiclesAtOrBelowLevel(
  stackerNum: number,
  maxLevel: number,
  stackerState: Map<number, Map<number, string | null>>,
  vehiclesById: Map<string, PresentVehicle>,
) {
  const vehicles: Array<PresentVehicle & VehicleLocation> = []
  for (let level = 1; level <= maxLevel; level++) {
    const vehicleId = stackerState.get(stackerNum)?.get(level) ?? null
    if (!vehicleId) continue
    const vehicle = vehiclesById.get(vehicleId)
    vehicles.push(
      vehicle ?? {
        vehicleId,
        displayName: vehicleId,
        fullName: vehicleId,
        stacker: stackerNum,
        level,
        nextPickupDateTime: null,
        nextPickupMs: null,
      },
    )
  }
  return vehicles
}

function canPlaceOnLevel(levels: Map<number, string | null>, targetLevel: number): boolean {
  if ((levels.get(targetLevel) ?? null) !== null) return false
  for (let lowerLevel = 1; lowerLevel < targetLevel; lowerLevel++) {
    if ((levels.get(lowerLevel) ?? null) !== null) return false
  }
  return true
}

function findVehicleLocation(
  stackerState: Map<number, Map<number, string | null>>,
  vehicleId: string,
): VehicleLocation | null {
  for (let stacker = 1; stacker <= STACKER_COUNT; stacker++) {
    const levels = stackerState.get(stacker)
    if (!levels) continue

    for (let level = 1; level <= LEVEL_COUNT; level++) {
      if ((levels.get(level) ?? null) === vehicleId) {
        return { stacker, level }
      }
    }
  }

  return null
}

function cloneStackerState(stackerState: Map<number, Map<number, string | null>>) {
  return new Map(
    Array.from(stackerState.entries()).map(([stacker, levels]) => [stacker, new Map(levels)]),
  )
}

function hasLaterPriorityVehicleAboveGround(
  levels: Map<number, string | null>,
  priorityIndexByVehicleId: Map<string, number>,
  activePriorityIndex: number,
): boolean {
  for (let level = 2; level <= LEVEL_COUNT; level++) {
    const vehicleId = levels.get(level) ?? null
    if (!vehicleId) continue
    const priorityIndex = priorityIndexByVehicleId.get(vehicleId)
    if (priorityIndex !== undefined && priorityIndex > activePriorityIndex) {
      return true
    }
  }
  return false
}

function compareVehicleUrgency(
  a: Pick<PresentVehicle, 'displayName' | 'nextPickupMs'>,
  b: Pick<PresentVehicle, 'displayName' | 'nextPickupMs'>,
): number {
  if (a.nextPickupMs === null && b.nextPickupMs === null) {
    return a.displayName.localeCompare(b.displayName)
  }
  if (a.nextPickupMs === null) return 1
  if (b.nextPickupMs === null) return -1
  if (a.nextPickupMs !== b.nextPickupMs) {
    return a.nextPickupMs - b.nextPickupMs
  }
  return a.displayName.localeCompare(b.displayName)
}

function isWithinMoveWindow(nextPickupMs: number | null, nowMs: number): boolean {
  if (nextPickupMs === null) return false
  return nextPickupMs - nowMs <= MOVE_LOOKAHEAD_DAYS * 24 * 60 * 60 * 1000
}

function shouldWaitForLowerBlockers(
  vehicle: PresentVehicle,
  blockers: Array<Pick<PresentVehicle, 'nextPickupMs'>>,
): boolean {
  if (vehicle.nextPickupMs === null || blockers.length === 0) return false
  return blockers.every(
    (blocker) => blocker.nextPickupMs !== null && blocker.nextPickupMs <= vehicle.nextPickupMs!,
  )
}

function buildRecommendationMeta(totalMoves: number, nextPickupDateTime: string | null): string {
  const timing = calculateTimeUntilPickup(nextPickupDateTime)
  if (timing === 'Pickup now.' || timing === '0h until next booking.') {
    return `${totalMoves} move${totalMoves === 1 ? '' : 's'} estimated. Pickup now.`
  }
  return `${totalMoves} move${totalMoves === 1 ? '' : 's'} estimated. Next booking ${timing.replace(' until next booking.', '')}.`
}

function collectReturnSlots(
  stackerState: Map<number, Map<number, string | null>>,
  priorityIndexByVehicleId: Map<string, number>,
  activePriorityIndex: number,
  promotedVehicleLocation: VehicleLocation,
  sourceStacker: number,
) {
  const slots: Array<{
    stacker: number
    level: number
    levels: Map<number, string | null>
    wouldSitUnderPromotedVehicle: boolean
    hasLaterPriority: boolean
    isSourceStacker: boolean
  }> = []

  for (let stacker = 1; stacker <= STACKER_COUNT; stacker++) {
    const levels = stackerState.get(stacker)
    if (!levels) continue

    for (let level = 1; level <= LEVEL_COUNT; level++) {
      if (!canPlaceOnLevel(levels, level)) break
      slots.push({
        stacker,
        level,
        levels,
        wouldSitUnderPromotedVehicle:
          stacker === promotedVehicleLocation.stacker && level < promotedVehicleLocation.level,
        hasLaterPriority: hasLaterPriorityVehicleAboveGround(
          levels,
          priorityIndexByVehicleId,
          activePriorityIndex,
        ),
        isSourceStacker: stacker === sourceStacker,
      })
    }
  }

  return slots.sort((a, b) => {
    if (a.level !== b.level) return a.level - b.level
    if (a.wouldSitUnderPromotedVehicle !== b.wouldSitUnderPromotedVehicle) {
      return a.wouldSitUnderPromotedVehicle ? 1 : -1
    }
    if (a.hasLaterPriority !== b.hasLaterPriority) {
      return a.hasLaterPriority ? 1 : -1
    }
    if (a.isSourceStacker !== b.isSourceStacker) {
      return a.isSourceStacker ? -1 : 1
    }
    return a.stacker - b.stacker
  })
}

function tryBuildPromotionRecommendation(
  vehicle: PresentVehicle,
  currentLocation: VehicleLocation,
  priorityIndex: number,
  stackerState: Map<number, Map<number, string | null>>,
  vehiclesById: Map<string, PresentVehicle>,
  priorityIndexByVehicleId: Map<string, number>,
): { recommendation: MoveRecommendation; nextState: Map<number, Map<number, string | null>> } | null {
  const blockers = getVehiclesBelowLevel(
    currentLocation.stacker,
    currentLocation.level,
    stackerState,
    vehiclesById,
  )

  const preferredDestinations: Array<{
    stacker: number
    level: number
    kind: 'external-l1-empty' | 'external-l1-occupied' | 'same-stacker'
  }> = []

  const externalL1Candidates = Array.from({ length: STACKER_COUNT }, (_, i) => i + 1)
    .filter((stacker) => stacker !== currentLocation.stacker)
    .map((stacker) => {
      const levels = stackerState.get(stacker)
      if (!levels) return null
      const occupantId = levels.get(1) ?? null
      const occupant = occupantId ? vehiclesById.get(occupantId) ?? null : null
      return {
        stacker,
        level: 1,
        isEmpty: occupantId === null,
        occupantNextPickupMs: occupant?.nextPickupMs ?? Number.NEGATIVE_INFINITY,
        hasLaterPriority: hasLaterPriorityVehicleAboveGround(
          levels,
          priorityIndexByVehicleId,
          priorityIndex,
        ),
      }
    })
    .filter(
      (
        candidate,
      ): candidate is {
        stacker: number
        level: number
        isEmpty: boolean
        occupantNextPickupMs: number
        hasLaterPriority: boolean
      } => candidate !== null,
    )
    .sort((a, b) => {
      if (a.isEmpty !== b.isEmpty) {
        return a.isEmpty ? -1 : 1
      }
      if (a.hasLaterPriority !== b.hasLaterPriority) {
        return a.hasLaterPriority ? 1 : -1
      }
      if (a.occupantNextPickupMs !== b.occupantNextPickupMs) {
        return b.occupantNextPickupMs - a.occupantNextPickupMs
      }
      return a.stacker - b.stacker
    })

  externalL1Candidates.forEach((candidate) => {
    preferredDestinations.push({
      stacker: candidate.stacker,
      level: candidate.level,
      kind: candidate.isEmpty ? 'external-l1-empty' : 'external-l1-occupied',
    })
  })

  for (let targetLevel = 1; targetLevel < currentLocation.level; targetLevel++) {
    preferredDestinations.push({
      stacker: currentLocation.stacker,
      level: targetLevel,
      kind: 'same-stacker',
    })
  }

  for (const destination of preferredDestinations) {
    const simulation = cloneStackerState(stackerState)
    const sourceLevels = simulation.get(currentLocation.stacker)
    if (!sourceLevels) continue
    const destinationLevels = simulation.get(destination.stacker)
    if (!destinationLevels) continue

    const steps: MoveRecommendation['steps'] = []
    const destinationBlockers =
      destination.stacker === currentLocation.stacker
        ? []
        : getVehiclesAtOrBelowLevel(destination.stacker, destination.level, simulation, vehiclesById)
    const displacedVehicleIds = new Set<string>()

    for (const blocker of blockers) {
      steps.push({
        kind: 'remove',
        text: `Move ${blocker.displayName} out of S${currentLocation.stacker} L${blocker.level} into temporary holding.`,
      })
      sourceLevels.set(blocker.level, null)
      displacedVehicleIds.add(blocker.vehicleId)
    }

    for (const blocker of destinationBlockers) {
      steps.push({
        kind: 'remove',
        text: `Move ${blocker.displayName} out of S${destination.stacker} L${blocker.level} into temporary holding.`,
      })
      destinationLevels.set(blocker.level, null)
      displacedVehicleIds.add(blocker.vehicleId)
    }

    if (!canPlaceOnLevel(destinationLevels, destination.level)) {
      continue
    }

    const platformMoves =
      destination.stacker === currentLocation.stacker
        ? currentLocation.level - destination.level
        : currentLocation.level - 1

    sourceLevels.set(currentLocation.level, null)
    destinationLevels.set(destination.level, vehicle.vehicleId)
    steps.push({
      kind: 'target',
      text: `Move ${vehicle.displayName} from S${currentLocation.stacker} L${currentLocation.level} down to S${destination.stacker} L${destination.level}.`,
    })

    const returnAssignments: Array<{
      vehicle: PresentVehicle & VehicleLocation
      stacker: number
      level: number
    }> = []

    const blockersByUrgency = Array.from(displacedVehicleIds)
      .map((vehicleId) => vehiclesById.get(vehicleId))
      .filter((blocker): blocker is PresentVehicle => Boolean(blocker))
      .sort(compareVehicleUrgency)
    const returnSlots = collectReturnSlots(
      simulation,
      priorityIndexByVehicleId,
      priorityIndex,
      { stacker: destination.stacker, level: destination.level },
      currentLocation.stacker,
    )

    if (returnSlots.length < blockersByUrgency.length) {
      continue
    }

    blockersByUrgency.forEach((blocker, index) => {
      const returnSlot = returnSlots[index]
      returnSlot.levels.set(returnSlot.level, blocker.vehicleId)
      returnAssignments.push({
        vehicle: blocker,
        stacker: returnSlot.stacker,
        level: returnSlot.level,
      })
    })

    returnAssignments
      .sort((a, b) => {
        if (a.stacker === b.stacker) return b.level - a.level
        if (a.stacker === currentLocation.stacker) return -1
        if (b.stacker === currentLocation.stacker) return 1
        return a.stacker - b.stacker || b.level - a.level
      })
      .forEach((assignment) => {
        steps.push({
          kind: 'return',
          text: `Return ${assignment.vehicle.displayName} from temporary holding to S${assignment.stacker} L${assignment.level}.`,
        })
      })

    const totalMoves = blockersByUrgency.length + platformMoves + returnAssignments.length
    return {
      recommendation: {
        id: `${vehicle.vehicleId}-to-S${destination.stacker}L${destination.level}`,
        title: `${vehicle.displayName} from S${currentLocation.stacker} L${currentLocation.level} to S${destination.stacker} L${destination.level}`,
        meta: buildRecommendationMeta(totalMoves, vehicle.nextPickupDateTime),
        totalMoves,
        steps,
      },
      nextState: simulation,
    }
  }

  return null
}

function buildMoveRecommendations(
  presentVehicles: PresentVehicle[],
  grid: ReturnType<typeof buildStackerGrid>,
): MoveRecommendation[] {
  const nowMs = nzWallClockNowMs()
  const vehiclesById = new Map(presentVehicles.map((vehicle) => [vehicle.vehicleId, vehicle]))
  const stackerState = new Map<number, Map<number, string | null>>()
  for (let stacker = 1; stacker <= STACKER_COUNT; stacker++) {
    const levels = new Map<number, string | null>()
    for (let level = 1; level <= LEVEL_COUNT; level++) {
      levels.set(
        level,
        grid[stacker][level]?.status === 'occupied' ? (grid[stacker][level]?.vehicleId ?? null) : null,
      )
    }
    stackerState.set(stacker, levels)
  }

  const priorityVehicles = [...presentVehicles]
    .filter((vehicle) => isWithinMoveWindow(vehicle.nextPickupMs, nowMs))
    .sort((a, b) => {
      if (a.nextPickupMs === null) return 1
      if (b.nextPickupMs === null) return -1
      return a.nextPickupMs - b.nextPickupMs
    })

  const priorityIndexByVehicleId = new Map(
    priorityVehicles.map((vehicle, index) => [vehicle.vehicleId, index]),
  )

  const recommendations: MoveRecommendation[] = []

  for (let priorityIndex = 0; priorityIndex < priorityVehicles.length; priorityIndex++) {
    if (recommendations.length >= MAX_MOVE_RECOMMENDATIONS) break

    const vehicle = priorityVehicles[priorityIndex]
    const currentLocation = findVehicleLocation(stackerState, vehicle.vehicleId)
    if (!currentLocation || currentLocation.level === 1) continue
    const blockers = getVehiclesBelowLevel(
      currentLocation.stacker,
      currentLocation.level,
      stackerState,
      vehiclesById,
    )
    if (shouldWaitForLowerBlockers(vehicle, blockers)) continue

    const promotion = tryBuildPromotionRecommendation(
      vehicle,
      currentLocation,
      priorityIndex,
      stackerState,
      vehiclesById,
      priorityIndexByVehicleId,
    )
    if (!promotion) continue

    recommendations.push(promotion.recommendation)
    stackerState.clear()
    for (const [stacker, levels] of promotion.nextState.entries()) {
      stackerState.set(stacker, new Map(levels))
    }
  }

  return recommendations
}

function buildTrickleChargeSuggestions(presentVehicles: PresentVehicle[]): PresentVehicle[] {
  const nowMs = nzWallClockNowMs()
  const twoWeeksMs = 14 * 24 * 60 * 60 * 1000
  const threeDaysMs = 3 * 24 * 60 * 60 * 1000

  const eligible = presentVehicles.filter((vehicle) => {
    if (vehicle.nextPickupMs === null) return true
    return vehicle.nextPickupMs - nowMs > twoWeeksMs
  })

  const sorted = [...eligible].sort((a, b) => {
    if (a.nextPickupMs === null && b.nextPickupMs === null) return a.displayName.localeCompare(b.displayName)
    if (a.nextPickupMs === null) return -1
    if (b.nextPickupMs === null) return 1
    return b.nextPickupMs - a.nextPickupMs
  })

  if (sorted.length === 0) return []
  if (sorted[0].nextPickupMs !== null && sorted[0].nextPickupMs - nowMs < threeDaysMs) return []

  return sorted.slice(0, 3)
}

type VehicleBookingModalProps = {
  vehicleName: string
  nextPickupDateTime: string | null
  onClose: () => void
}

function VehicleBookingModal({
  vehicleName,
  nextPickupDateTime,
  onClose,
}: VehicleBookingModalProps) {
  const [entered, setEntered] = useState(false)

  useEffect(() => {
    setEntered(false)
    const id = requestAnimationFrame(() => setEntered(true))
    return () => cancelAnimationFrame(id)
  }, [])

  useEffect(() => {
    const prev = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => {
      document.body.style.overflow = prev
    }
  }, [])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [onClose])

  return createPortal(
    <div
      className={`stackerVehicleModalBackdrop${entered ? ' stackerVehicleModalBackdrop--visible' : ''}`}
      role="presentation"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose()
      }}
    >
      <div
        className={`stackerVehicleModal${entered ? ' stackerVehicleModal--visible' : ''}`}
        role="dialog"
        aria-modal="true"
        aria-label={`${vehicleName} booking details`}
        onClick={(e) => e.stopPropagation()}
      >
        <button
          type="button"
          className="stackerVehicleModalClose"
          onClick={onClose}
          aria-label="Close"
        >
          ×
        </button>
        <h3 className="stackerVehicleModalTitle">{vehicleName}</h3>
        <p className="stackerVehicleModalText">{calculateTimeUntilPickup(nextPickupDateTime)}</p>
      </div>
    </div>,
    document.body,
  )
}

function stepToneClass(kind: MoveRecommendation['steps'][number]['kind']): string {
  if (kind === 'remove') return 'stackerPlanStep--remove'
  if (kind === 'target') return 'stackerPlanStep--target'
  if (kind === 'return') return 'stackerPlanStep--return'
  return 'stackerPlanStep--hold'
}

function countActionSteps(steps: MoveRecommendation['steps']): number {
  return steps.filter((step) => step.kind !== 'hold').length
}

export default function StackersPanel({ data, days = [] }: StackersPanelProps) {
  const grid = useMemo(() => buildStackerGrid(data), [data])
  const updatedLabel = formatUpdatedAt(data?.generatedAt ?? null)
  const [vehicleNames, setVehicleNames] = useState<VehicleNameMap>({})
  const [selectedVehicle, setSelectedVehicle] = useState<DirtyCar | null>(null)
  const [visibleStepIndexByMove, setVisibleStepIndexByMove] = useState<Record<string, number>>({})
  const [showAllStepsByMove, setShowAllStepsByMove] = useState<Record<string, boolean>>({})
  const [celebratingMoveIds, setCelebratingMoveIds] = useState<Record<string, boolean>>({})
  const celebrationTimeoutsRef = useRef<Record<string, number>>({})
  const fleetNextBookings = days[0]?.fleetNextBookings ?? []

  const levels = useMemo(
    () => Array.from({ length: LEVEL_COUNT }, (_, i) => LEVEL_COUNT - i),
    [],
  )
  const [refreshDots, setRefreshDots] = useState('.')

  useEffect(() => {
    let active = true

    const loadVehicleNames = async () => {
      try {
        const res = await fetch(`${import.meta.env.BASE_URL}vehicle-names.json`)
        if (!res.ok) return
        const json: unknown = await res.json()
        if (!active || !json || typeof json !== 'object' || Array.isArray(json)) return

        const next: VehicleNameMap = {}
        for (const [key, value] of Object.entries(json as Record<string, unknown>)) {
          if (!value || typeof value !== 'object' || Array.isArray(value)) continue
          const record = value as Record<string, unknown>
          const displayName =
            typeof record.displayName === 'string' ? record.displayName.trim() : ''
          const fullName = typeof record.fullName === 'string' ? record.fullName.trim() : ''
          if (displayName && fullName) {
            next[key] = { displayName, fullName }
          }
        }
        setVehicleNames(next)
      } catch (error) {
        console.error(error)
      }
    }

    void loadVehicleNames()

    return () => {
      active = false
    }
  }, [])

  useEffect(() => {
    if (!data?.cache.isRefreshing) {
      setRefreshDots('.')
      return
    }

    const frames = ['.', '..', '...']
    let index = 0
    const id = window.setInterval(() => {
      index = (index + 1) % frames.length
      setRefreshDots(frames[index])
    }, 900)

    return () => window.clearInterval(id)
  }, [data?.cache.isRefreshing])

  const presentVehicles = useMemo<PresentVehicle[]>(() => {
    const vehicles: PresentVehicle[] = []
    for (const slot of data?.backendView.occupiedSpaces ?? []) {
      if (!slot.vehicleId) continue
      const vehicleEntry = vehicleNames[slot.vehicleId]
      const displayName = vehicleEntry?.displayName ?? slot.vehicleId
      const fullName = vehicleEntry?.fullName ?? slot.vehicleId
      const nextBooking = findNextBooking(fullName, fleetNextBookings)
      const nextPickupDateTime = nextBooking?.nextPickupDateTime ?? null
      const nextPickupMs = nextPickupDateTime
        ? airtableNzDateTimeWallClockMs(nextPickupDateTime)
        : null

      vehicles.push({
        vehicleId: slot.vehicleId,
        displayName,
        fullName,
        stacker: slot.stacker,
        level: slot.level,
        nextPickupDateTime,
        nextPickupMs: Number.isFinite(nextPickupMs ?? NaN) ? nextPickupMs : null,
      })
    }

    return vehicles
  }, [data?.backendView.occupiedSpaces, fleetNextBookings, vehicleNames])

  const moveRecommendations = useMemo(
    () => buildMoveRecommendations(presentVehicles, grid),
    [grid, presentVehicles],
  )

  useEffect(() => {
    setVisibleStepIndexByMove((current) =>
      moveRecommendations.reduce<Record<string, number>>((next, recommendation) => {
        const maxIndex = recommendation.steps.length
        next[recommendation.id] = Math.min(current[recommendation.id] ?? 0, maxIndex)
        return next
      }, {}),
    )
    setShowAllStepsByMove((current) =>
      moveRecommendations.reduce<Record<string, boolean>>((next, recommendation) => {
        next[recommendation.id] = current[recommendation.id] ?? false
        return next
      }, {}),
    )
  }, [moveRecommendations])

  useEffect(() => {
    return () => {
      Object.values(celebrationTimeoutsRef.current).forEach((timeoutId) => {
        window.clearTimeout(timeoutId)
      })
    }
  }, [])

  const hasUpcomingVehicleAboveGround = useMemo(
    () => {
      const nowMs = nzWallClockNowMs()
      return presentVehicles.some(
        (vehicle) => vehicle.level > 1 && isWithinMoveWindow(vehicle.nextPickupMs, nowMs),
      )
    },
    [presentVehicles],
  )

  const trickleSuggestions = useMemo(
    () => buildTrickleChargeSuggestions(presentVehicles),
    [presentVehicles],
  )

  const triggerStepCelebration = (recommendationId: string) => {
    const currentTimeout = celebrationTimeoutsRef.current[recommendationId]
    if (currentTimeout) {
      window.clearTimeout(currentTimeout)
    }

    setCelebratingMoveIds((current) => ({
      ...current,
      [recommendationId]: true,
    }))

    celebrationTimeoutsRef.current[recommendationId] = window.setTimeout(() => {
      setCelebratingMoveIds((current) => ({
        ...current,
        [recommendationId]: false,
      }))
      delete celebrationTimeoutsRef.current[recommendationId]
    }, 900)
  }

  return (
    <div className="stackersPanel">
      {data?.cache.isRefreshing ? (
        <div className="stackersRefreshBanner" role="status" aria-live="polite">
          Refreshing stackers {refreshDots}
        </div>
      ) : null}

      <div className="stackersMeta">
        {updatedLabel ? (
          <p className="stackersUpdated">Last updated {updatedLabel}</p>
        ) : (
          <span />
        )}

        <div className="stackersSummary" aria-label="Stacker summary">
          <span className="stackersSummaryText">Occupied {data?.summary.occupiedSpaces ?? 0}</span>
          <span className="stackersSummaryText">Empty {data?.summary.likelyEmptySpaces ?? 0}</span>
          {(data?.summary.reviewSpaces ?? 0) > 0 ? (
            <span className="stackersSummaryText">
              Review {data?.summary.reviewSpaces ?? 0}
            </span>
          ) : null}
        </div>
      </div>

      <div className="stackersGrid" role="list" aria-label="Car stackers">
        <div className="stackersGridInset" aria-hidden="true" />
        {Array.from({ length: STACKER_COUNT }, (_, i) => i + 1).map((stackerNum) => (
          <article
            key={stackerNum}
            className="stackerColumn"
            role="listitem"
            aria-label={`Stacker ${stackerNum}`}
          >
            <header className="stackerColumnHeader">Stacker {stackerNum}</header>
            <div className="stackerLevels">
              {levels.map((level) => {
                const slot = grid[stackerNum][level]
                const vehicleId = slot?.vehicleId ?? null
                const vehicleEntry = vehicleId ? vehicleNames[vehicleId] : null
                const displayName = vehicleEntry?.displayName ?? vehicleId
                const fullName = vehicleEntry?.fullName ?? vehicleId

                return (
                  <div
                    key={level}
                    className={['stackerLevel', slotVariant(slot)].join(' ')}
                    aria-label={`Stacker ${stackerNum} level ${level} ${slotTitle(slot)}`}
                  >
                    <span className="stackerLevelLabel">L{level}</span>

                    {slot?.status === 'occupied' && vehicleId ? (
                      <button
                        type="button"
                        className="stackerVehicleButton"
                        onClick={() => {
                          const vehicleName = fullName ?? vehicleId ?? ''
                          console.log('[stackers] vehicle tapped', {
                            vehicleId,
                            displayName,
                            vehicleName,
                            fleetNextBookingsCount: fleetNextBookings.length,
                            fleetNextBookingsPreview: fleetNextBookings.slice(0, 10),
                          })
                          const nextBooking = findNextBooking(vehicleName, fleetNextBookings)
                          console.log('[stackers] modal payload', {
                            vehicleName,
                            nextPickupDateTime: nextBooking?.nextPickupDateTime ?? null,
                          })
                          setSelectedVehicle({
                            vehicleName,
                            nextPickupDateTime: nextBooking?.nextPickupDateTime ?? null,
                          })
                        }}
                        aria-label={`View next booking for ${fullName ?? vehicleId}`}
                      >
                        <VehicleImage vehicleId={vehicleId} fullName={fullName ?? vehicleId} />
                        <span className="stackerVehicleName">{displayName}</span>
                      </button>
                    ) : (
                      <span className="stackerPlate">Empty</span>
                    )}
                  </div>
                )
              })}
            </div>
          </article>
        ))}
      </div>

      <section className="stackerPlanSection" aria-label="Move plan">
        <div className="stackerPlanCard">
          <h2 className="stackerPlanTitle">Move plan</h2>
          {moveRecommendations.length > 0 ? (
            <ol className="stackerPlanList">
              {moveRecommendations.map((recommendation, recommendationIndex) => (
                <li key={recommendation.id} className="stackerPlanItem">
                  {(() => {
                    const currentStepIndex = visibleStepIndexByMove[recommendation.id] ?? 0
                    const isComplete = currentStepIndex >= recommendation.steps.length
                    const visibleSteps = showAllStepsByMove[recommendation.id]
                      ? recommendation.steps.map((step, index) => ({ step, index }))
                      : isComplete
                        ? []
                        : [
                            {
                              step: recommendation.steps[Math.min(currentStepIndex, recommendation.steps.length - 1)],
                              index: Math.min(currentStepIndex, recommendation.steps.length - 1),
                            },
                          ]

                    return (
                      <>
                  <div className="stackerPlanLeadRow">
                    <p className="stackerPlanLead">
                      <strong>{recommendation.title}</strong>
                    </p>
                    <span className="stackerPlanPriority">
                      Move {recommendationIndex + 1}
                    </span>
                  </div>
                  <p className="stackerPlanMeta">{recommendation.meta}</p>
                  <div className="stackerPlanControls">
                    {isComplete ? (
                      <span className="stackerPlanComplete">Complete</span>
                    ) : (
                      <span className="stackerPlanProgress">
                        Step {Math.min(currentStepIndex + 1, recommendation.steps.length)} of {recommendation.steps.length}
                      </span>
                    )}
                    <button
                      type="button"
                      className="stackerPlanToggle"
                      onClick={() =>
                        setShowAllStepsByMove((current) => ({
                          ...current,
                          [recommendation.id]: !current[recommendation.id],
                        }))
                      }
                    >
                      {showAllStepsByMove[recommendation.id] ? 'Step view' : 'Show all'}
                    </button>
                  </div>
                  <div className="stackerPlanSteps" aria-label={`Steps for ${recommendation.title}`}>
                    {visibleSteps.map(({ step, index }) => {
                      const isStepView = !showAllStepsByMove[recommendation.id]
                      const canGoBack = currentStepIndex > 0
                      return (
                        <div
                          key={index}
                          className={[
                            'stackerPlanStepRow',
                            stepToneClass(step.kind),
                            celebratingMoveIds[recommendation.id] && isStepView
                              ? 'stackerPlanStepRow--celebrate'
                              : '',
                          ]
                            .filter(Boolean)
                            .join(' ')}
                        >
                          <span className={step.kind === 'hold' ? 'stackerPlanStepFlag' : 'stackerPlanStepNumber'}>
                            {step.kind === 'hold' ? 'Note' : countActionSteps(recommendation.steps.slice(0, index + 1))}
                          </span>
                          <div className="stackerPlanStepContent">
                            <p className="stackerPlanStep">{step.text}</p>
                            {isStepView ? (
                              <div className="stackerPlanStepActions">
                                <button
                                  type="button"
                                  className="stackerPlanBack"
                                  onClick={() =>
                                    setVisibleStepIndexByMove((current) => ({
                                      ...current,
                                      [recommendation.id]: Math.max(
                                        (current[recommendation.id] ?? 0) - 1,
                                        0,
                                      ),
                                    }))
                                  }
                                  disabled={!canGoBack}
                                >
                                  Back
                                </button>
                                <button
                                  type="button"
                                  className="stackerPlanDone"
                                  onClick={() => {
                                    setVisibleStepIndexByMove((current) => ({
                                      ...current,
                                      [recommendation.id]: Math.min(
                                        (current[recommendation.id] ?? 0) + 1,
                                        recommendation.steps.length,
                                      ),
                                    }))
                                    triggerStepCelebration(recommendation.id)
                                  }}
                                  disabled={false}
                                >
                                  Done
                                </button>
                              </div>
                            ) : null}
                          </div>
                        </div>
                      )
                    })}
                  </div>
                      </>
                    )
                  })()}
                </li>
              ))}
            </ol>
          ) : (
            <p className="stackerPlanEmpty">
              {hasUpcomingVehicleAboveGround
                ? 'No complete move plan could be built that keeps every car on a stacker at the end.'
                : 'No move needed right now. The soonest outgoing cars are already on L1 or as low as they can legally go.'}
            </p>
          )}
        </div>

        <div className="stackerPlanCard">
          <h2 className="stackerPlanTitle">Trickle charge</h2>
          {trickleSuggestions.length > 0 ? (
            <ol className="stackerPlanList">
              {trickleSuggestions.map((vehicle) => (
                <li key={`${vehicle.vehicleId}-${vehicle.stacker}-${vehicle.level}`} className="stackerPlanItem">
                  <p className="stackerPlanLead">
                    <strong>{vehicle.displayName}</strong>
                    {` in S${vehicle.stacker} L${vehicle.level}`}
                  </p>
                  <p className="stackerPlanMeta">
                    {vehicle.nextPickupDateTime === null
                      ? 'No upcoming booking in the feed.'
                      : `Next booking ${formatBookingLabel(vehicle.nextPickupDateTime)}.`}
                  </p>
                </li>
              ))}
            </ol>
          ) : (
            <p className="stackerPlanEmpty">
              No trickle charge recommendation right now. No present vehicle is more than two weeks out, or the best candidate is too close to its next booking.
            </p>
          )}
        </div>
      </section>

      {selectedVehicle ? (
        <VehicleBookingModal
          vehicleName={selectedVehicle.vehicleName}
          nextPickupDateTime={selectedVehicle.nextPickupDateTime}
          onClose={() => setSelectedVehicle(null)}
        />
      ) : null}
    </div>
  )
}
