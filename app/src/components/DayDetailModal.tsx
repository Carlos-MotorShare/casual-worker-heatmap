import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import type { RosterRow, User } from '../lib/rosterTypes'
import type { StaffingDay } from '../staffingDay'
import DayDetailPanel from './DayDetailPanel'

type DayDetailModalProps = {
  day: StaffingDay | null
  onClose: () => void
  rosterRows: RosterRow[]
  canSchedule: boolean
  onScheduleClick: () => void
  staffsAway?: Array<{ staffName: string; startDate: string; endDate: string; reason: string }>
  currentUser?: User | null
  onRosterBlockDeleted?: () => void
  /** When true, Escape and backdrop do not close (e.g. stacked scheduling modal). */
  lockClose?: boolean
}

export default function DayDetailModal({
  day,
  onClose,
  rosterRows,
  canSchedule,
  onScheduleClick,
  staffsAway = [],
  currentUser = null,
  onRosterBlockDeleted,
  lockClose = false,
}: DayDetailModalProps) {
  const panelRef = useRef<HTMLDivElement>(null)
  const [entered, setEntered] = useState(false)

  /* Modal open animation: reset then enter on next frame */
  /* eslint-disable react-hooks/set-state-in-effect */
  useEffect(() => {
    if (!day) {
      setEntered(false)
      return
    }
    setEntered(false)
    const id = requestAnimationFrame(() => setEntered(true))
    return () => cancelAnimationFrame(id)
  }, [day])
  /* eslint-enable react-hooks/set-state-in-effect */

  useEffect(() => {
    if (!day) return
    const prev = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => {
      document.body.style.overflow = prev
    }
  }, [day])

  useEffect(() => {
    if (!day || lockClose) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [day, lockClose, onClose])

  useEffect(() => {
    if (day && panelRef.current) {
      panelRef.current.focus()
    }
  }, [day])

  if (!day) return null

  return createPortal(
    <div
      className={`dayModalBackdrop${entered ? ' dayModalBackdrop--visible' : ''}`}
      role="presentation"
      onClick={(e) => {
        if (lockClose) return
        if (e.target === e.currentTarget) onClose()
      }}
    >
      <div
        ref={panelRef}
        className={`dayModalPanel${entered ? ' dayModalPanel--visible' : ''}`}
        role="dialog"
        aria-modal="true"
        aria-label="Day details"
        tabIndex={-1}
      >
        <DayDetailPanel
          day={day}
          rosterRows={rosterRows}
          canSchedule={canSchedule}
          staffsAway={staffsAway}
          currentUser={currentUser}
          onRosterBlockDeleted={onRosterBlockDeleted}
          onScheduleClick={onScheduleClick}
          rightAction={
            <button
              type="button"
              className="dayModalClose"
              onClick={onClose}
              aria-label="Close"
              disabled={lockClose}
              title={lockClose ? 'Close disabled' : 'Close'}
            >
              ×
            </button>
          }
          tone="modal"
        />
      </div>
    </div>,
    document.body,
  )
}
