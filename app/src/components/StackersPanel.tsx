import { useEffect, useMemo, useState } from 'react'
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

const VEHICLE_IMAGE_EXTENSIONS = ['png', 'jpg', 'jpeg', 'webp']

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

export default function StackersPanel({ data, days = [] }: StackersPanelProps) {
  const grid = useMemo(() => buildStackerGrid(data), [data])
  const updatedLabel = formatUpdatedAt(data?.generatedAt ?? null)
  const [vehicleNames, setVehicleNames] = useState<VehicleNameMap>({})
  const [selectedVehicle, setSelectedVehicle] = useState<DirtyCar | null>(null)
  const fleetNextBookings = days[0]?.fleetNextBookings ?? []

  const levels = useMemo(
    () => Array.from({ length: LEVEL_COUNT }, (_, i) => LEVEL_COUNT - i),
    [],
  )

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

  return (
    <div className="stackersPanel">
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
