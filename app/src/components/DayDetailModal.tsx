import { useEffect, useId, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import type { StaffingDay } from '../staffingDay'
import DayTimeline from './DayTimeline'

function formatModalTitle(dateStr: string) {
  const d = new Date(dateStr.includes('T') ? dateStr : `${dateStr}T12:00:00`)
  if (!Number.isFinite(d.getTime())) return dateStr
  return d.toLocaleDateString(undefined, {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
  })
}

type DayDetailModalProps = {
  day: StaffingDay | null
  onClose: () => void
}

export default function DayDetailModal({ day, onClose }: DayDetailModalProps) {
  const titleId = useId()
  const panelRef = useRef<HTMLDivElement>(null)
  const [entered, setEntered] = useState(false)

  useEffect(() => {
    if (!day) {
      setEntered(false)
      return
    }
    setEntered(false)
    const id = requestAnimationFrame(() => setEntered(true))
    return () => cancelAnimationFrame(id)
  }, [day])

  useEffect(() => {
    if (!day) return
    const prev = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => {
      document.body.style.overflow = prev
    }
  }, [day])

  useEffect(() => {
    if (!day) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [day, onClose])

  useEffect(() => {
    if (day && panelRef.current) {
      panelRef.current.focus()
    }
  }, [day])

  if (!day) return null

  const pickupsList = day.pickupsList ?? []
  const dropoffsList = day.dropoffsList ?? []

  return createPortal(
    <div
      className={`dayModalBackdrop${entered ? ' dayModalBackdrop--visible' : ''}`}
      role="presentation"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose()
      }}
    >
      <div
        ref={panelRef}
        className={`dayModalPanel${entered ? ' dayModalPanel--visible' : ''}`}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        tabIndex={-1}
      >
        <div className="dayModalHeader">
          <h2 id={titleId} className="dayModalTitle">
            {formatModalTitle(day.date)}
          </h2>
          <button
            type="button"
            className="dayModalClose"
            onClick={onClose}
            aria-label="Close"
          >
            ×
          </button>
        </div>

        <div className="dayModalBody">
          <div className="dayModalCol dayModalCol--timeline">
            <DayTimeline pickupsList={pickupsList} dropoffsList={dropoffsList} />
          </div>

          <div className="dayModalCol dayModalCol--stats">
            <div className="dayModalCarsBadge" aria-label="Cars to wash">
              <span className="dayModalCarsEmoji" aria-hidden="true">
                🧼
              </span>
              <span>
                {day.carsToWash} {day.carsToWash === 1 ? 'car' : 'cars'} to wash
              </span>
            </div>
            <div className="dayModalStat">
              <span className="dayModalStatLabel">Pickups</span>
              <span className="dayModalStatValue">{day.pickups}</span>
            </div>
            <div className="dayModalStat">
              <span className="dayModalStatLabel">Dropoffs</span>
              <span className="dayModalStatValue">{day.dropoffs}</span>
            </div>
            <p className="dayModalStaffLine">Staff away: {day.staffAwayCount}</p>
          </div>
        </div>
      </div>
    </div>,
    document.body,
  )
}
