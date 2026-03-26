import { useEffect, useId, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import {
  resolveUserColour,
  rosterSummaryDetailForDay,
  type RosterSummaryLineDetail,
} from '../lib/rosterHelpers'
import type { RosterRow, User } from '../lib/rosterTypes'
import type { StaffingDay } from '../staffingDay'
import DayTimeline from './DayTimeline'
import RosterDeleteFlow from './RosterDeleteFlow'

function formatModalTitle(dateStr: string) {
  const d = new Date(dateStr.includes('T') ? dateStr : `${dateStr}T12:00:00`)
  if (!Number.isFinite(d.getTime())) return dateStr
  return d.toLocaleDateString(undefined, {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
  })
}

/** Own shifts, or any shift when `user.admin === true` (matches server `delete_roster_block`). */
function canRemoveRosterLine(line: RosterSummaryLineDetail, user: User | null): boolean {
  if (!user) return false
  return line.userId === user.id || user.admin === true
}

type DayDetailModalProps = {
  day: StaffingDay | null
  onClose: () => void
  rosterRows: RosterRow[]
  canSchedule: boolean
  onScheduleClick: () => void
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
  currentUser = null,
  onRosterBlockDeleted,
  lockClose = false,
}: DayDetailModalProps) {
  const titleId = useId()
  const panelRef = useRef<HTMLDivElement>(null)
  const [entered, setEntered] = useState(false)
  const [deleteLine, setDeleteLine] = useState<RosterSummaryLineDetail | null>(null)

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
    if (!day || lockClose || deleteLine) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [day, lockClose, onClose, deleteLine])

  useEffect(() => {
    if (day && panelRef.current) {
      panelRef.current.focus()
    }
  }, [day])

  useEffect(() => {
    setDeleteLine(null)
  }, [day?.date])

  const rosterSummaryDetail = useMemo(
    () => rosterSummaryDetailForDay(rosterRows),
    [rosterRows],
  )

  if (!day) return null

  const pickupsList = day.pickupsList ?? []
  const dropoffsList = day.dropoffsList ?? []

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
            <div className="dayModalTimelineRow">
              <div className="dayModalTimelineMain">
                <DayTimeline
                  pickupsList={pickupsList}
                  dropoffsList={dropoffsList}
                  rosterRows={rosterRows}
                />
              </div>
              {canSchedule ? (
                <div className="dayModalScheduleWrap">
                  <button
                    type="button"
                    className="dayModalScheduleBtn"
                    onClick={(e) => {
                      e.stopPropagation()
                      onScheduleClick()
                    }}
                  >
                    Tap to schedule
                  </button>
                </div>
              ) : null}
            </div>
            {rosterSummaryDetail.length > 0 ? (
              <div className="dayModalRosterSummary" aria-label="Who is rostered">
                {rosterSummaryDetail.map((line) => (
                  <div key={line.userId} className="dayModalRosterSummaryLine">
                    <div className="dayModalRosterSummaryText">
                      <span
                        className="dayModalRosterSummaryColour"
                        style={{ background: resolveUserColour(line.colour) }}
                        aria-hidden
                      />
                      <span className="dayModalRosterSummaryName">{line.username}</span>
                      <span className="dayModalRosterSummaryRanges">{line.rangesDisplay}</span>
                    </div>
                    {canRemoveRosterLine(line, currentUser) ? (
                      <button
                        type="button"
                        className="dayModalRosterRemoveBtn"
                        aria-label={`Remove a shift for ${line.username}`}
                        title="Remove a shift"
                        onClick={(e) => {
                          e.stopPropagation()
                          setDeleteLine(line)
                        }}
                      >
                        ×
                      </button>
                    ) : null}
                  </div>
                ))}
              </div>
            ) : null}
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
              <span className="dayModalStatLabelWithLegend">
                <span className="dayModalLegendDot dayModalLegendDot--pickup" aria-hidden />
                Pickups
              </span>
              <span className="dayModalStatValue">{day.pickups}</span>
            </div>
            <div className="dayModalStat">
              <span className="dayModalStatLabelWithLegend">
                <span className="dayModalLegendDot dayModalLegendDot--dropoff" aria-hidden />
                Dropoffs
              </span>
              <span className="dayModalStatValue">{day.dropoffs}</span>
            </div>
            <p className="dayModalStaffLine">Staff away: {day.staffAwayCount}</p>
          </div>
        </div>
      </div>
      <RosterDeleteFlow
        line={deleteLine}
        actorUserId={currentUser?.id ?? ''}
        onClose={() => setDeleteLine(null)}
        onDeleted={() => {
          onRosterBlockDeleted?.()
        }}
      />
    </div>,
    document.body,
  )
}
