import { useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import type { DirtyCar } from '../staffingDay'
import './DirtyCarsPanel.css'

type DirtCarsPanelProps = {
  dirtyCars: DirtyCar[]
  onCarCleaned?: (vehicleName: string) => void
  showHeader?: boolean
}

function calculateTimeUntilPickup(pickupDateTime: string | null): string {
  if (!pickupDateTime) return ''

  try {
    const now = new Date()
    const pickup = new Date(pickupDateTime)

    if (!Number.isFinite(pickup.getTime())) return ''

    const diffMs = pickup.getTime() - now.getTime()
    if (diffMs <= 0) return 'Pickup now'

    const diffHours = diffMs / (1000 * 60 * 60)
    const days = Math.floor(diffHours / 24)
    const hours = Math.floor(diffHours % 24)

    if (days > 0) {
      return `${days}d ${hours}h`
    }
    return `${hours}h`
  } catch {
    return ''
  }
}

export default function DirtyCarsPanel({ dirtyCars, onCarCleaned, showHeader = true }: DirtCarsPanelProps) {
  const [fadingOut, setFadingOut] = useState<Set<string>>(new Set())
  const [confirmingCar, setConfirmingCar] = useState<DirtyCar | null>(null)
  const [isLoading, setIsLoading] = useState(false)
  const checkboxRefs = useRef<Map<string, HTMLInputElement>>(new Map())

  const handleCleanClick = (car: DirtyCar) => {
    setConfirmingCar(car)
  }

  const handleConfirmClean = async () => {
    if (!confirmingCar) return

    try {
      // Show loader for 1 second
      setIsLoading(true)

      // Trigger fade out animation
      setFadingOut((prev) => new Set(prev).add(confirmingCar.vehicleName))

      // Send webhook to Airtable
      await fetch(`${import.meta.env.REACT_APP_API_URL || 'http://localhost:3001'}/api/webhooks/airtable/vehicle-cleaned`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          vehicleName: confirmingCar.vehicleName,
          timestamp: new Date().toISOString(),
        }),
      }).catch((err) => console.error('Failed to send webhook:', err))

      // Call callback
      onCarCleaned?.(confirmingCar.vehicleName)

      // Wait 1 second before closing modal
      await new Promise((resolve) => setTimeout(resolve, 1000))

      // Close modal and turn off loader
      setConfirmingCar(null)
      setIsLoading(false)
    } catch (err) {
      console.error('Error marking car as cleaned:', err)
      setFadingOut((prev) => {
        const next = new Set(prev)
        next.delete(confirmingCar.vehicleName)
        return next
      })
      setIsLoading(false)
    }
  }

  const handleCancelClean = () => {
    // Reset checkbox state
    if (confirmingCar) {
      const checkbox = checkboxRefs.current.get(confirmingCar.vehicleName)
      if (checkbox) {
        checkbox.checked = false
      }
    }
    setConfirmingCar(null)
  }

  const visibleCars = dirtyCars.filter((car) => !fadingOut.has(car.vehicleName))

  if (visibleCars.length === 0) return null

  return (
    <>
      <div className="dirtyCarsPanel">
        {showHeader ? (
          <div className="dirtyCarsHeader">
            <span className="dirtyCarsTitle">
              {visibleCars.length} {visibleCars.length === 1 ? 'car' : 'cars'} to wash
            </span>
            <span className="dirtyCarsColumnLabel">Cleaned</span>
          </div>
        ) : null}

        <ul className="dirtyCarsList">
          {visibleCars.map((car) => (
            <li
              key={car.vehicleName}
              className={`dirtyCarsItem ${fadingOut.has(car.vehicleName) ? 'dirtyCarsItem--fading' : ''}`}
            >
              <div className="dirtyCarsItemContent">
                <span className="dirtyCarsItemName">{car.vehicleName}</span>
                {car.nextPickupDateTime && (
                  <span className="dirtyCarsItemTime">
                    {calculateTimeUntilPickup(car.nextPickupDateTime)}
                  </span>
                )}
              </div>
              <input
                ref={(el) => {
                  if (el) {
                    checkboxRefs.current.set(car.vehicleName, el)
                  } else {
                    checkboxRefs.current.delete(car.vehicleName)
                  }
                }}
                type="checkbox"
                className="dirtyCarsItemCheckbox"
                aria-label={`Mark ${car.vehicleName} as cleaned`}
                onChange={() => handleCleanClick(car)}
                disabled={confirmingCar !== null}
              />
            </li>
          ))}
        </ul>
      </div>

      {confirmingCar &&
        createPortal(
          <div className="dirtyCarsConfirmOverlay" onClick={handleCancelClean}>
            <div className="dirtyCarsConfirmModal" onClick={(e) => e.stopPropagation()}>
              <h3 className="dirtyCarsConfirmTitle">Confirm Vehicle Cleaned</h3>
              <p className="dirtyCarsConfirmMessage">
                Is the <strong>{confirmingCar.vehicleName}</strong> clean and ready for pickup?
              </p>
              <div className="dirtyCarsConfirmActions">
                <button
                  type="button"
                  className="dirtyCarsConfirmBtn dirtyCarsConfirmBtn--cancel"
                  onClick={handleCancelClean}
                  disabled={isLoading}
                >
                  Cancel
                </button>
                <button
                  type="button"
                  className="dirtyCarsConfirmBtn dirtyCarsConfirmBtn--confirm"
                  onClick={handleConfirmClean}
                  disabled={isLoading}
                >
                  {isLoading ? (
                    <>
                      <span className="dirtyCarsConfirmLoader"></span>
                      Cleaning...
                    </>
                  ) : (
                    'Confirm Cleaned'
                  )}
                </button>
              </div>
            </div>
          </div>,
          document.body,
        )}
    </>
  )
}
