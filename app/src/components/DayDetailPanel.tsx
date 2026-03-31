import { useId, useMemo, useState } from 'react'
import {
  canActorRemoveRosterLine,
  resolveUserColour,
  rosterSummaryDetailForDay,
  type RosterSummaryLineDetail,
} from '../lib/rosterHelpers'
import type { RosterRow, User } from '../lib/rosterTypes'
import type { DirtyCar, StaffingDay } from '../staffingDay'
import DayTimeline from './DayTimeline'
import RosterDeleteFlow from './RosterDeleteFlow'
import DirtyCarsPanel from './DirtyCarsPanel'

type StaffAwayRange = {
  staffName: string
  startDate: string
  endDate: string
  reason: string
}

function formatTitle(dateStr: string) {
  const d = new Date(dateStr.includes('T') ? dateStr : `${dateStr}T12:00:00`)
  if (!Number.isFinite(d.getTime())) return dateStr
  return d.toLocaleDateString(undefined, {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
  })
}

type DayDetailPanelProps = {
  day: StaffingDay
  rosterRows: RosterRow[]
  canSchedule: boolean
  onScheduleClick: () => void
  staffsAway?: StaffAwayRange[]
  dirtyCars?: DirtyCar[]
  currentUser?: User | null
  onRosterBlockDeleted?: () => void
  rightAction?: React.ReactNode
  tone?: 'panel' | 'modal'
}

export default function DayDetailPanel({
  day,
  rosterRows,
  canSchedule,
  onScheduleClick,
  staffsAway = [],
  dirtyCars = [],
  currentUser = null,
  onRosterBlockDeleted,
  rightAction,
  tone = 'panel',
}: DayDetailPanelProps) {
  const titleId = useId()
  const [deleteLine, setDeleteLine] = useState<RosterSummaryLineDetail | null>(null)

  const rosterSummaryDetail = useMemo(
    () => rosterSummaryDetailForDay(rosterRows),
    [rosterRows],
  )

  const pickupsList = day.pickupsList ?? []
  const dropoffsList = day.dropoffsList ?? []
  const awayNames = useMemo(() => {
    const iso = day.date
    const fromRanges = staffsAway
      .filter((a) => a.startDate <= iso && a.endDate >= iso)
      .map((a) => a.staffName)
      .filter(Boolean)
    const fromDay = (day.staffsAway ?? []).map((a) => a.staffName).filter(Boolean)
    const list = [...fromRanges, ...fromDay]
    return Array.from(new Set(list)).sort((a, b) => a.localeCompare(b))
  }, [day.date, day.staffsAway, staffsAway])

  return (
    <>
      <div className={tone === 'modal' ? 'dayModalPanelInner' : 'dayPanel'}>
        <div className="dayModalHeader">
          <h2 id={titleId} className="dayModalTitle">
            {formatTitle(day.date)}
          </h2>
          {rightAction}
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
                    {canActorRemoveRosterLine(line, currentUser) ? (
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

            <div className="dayModalCarsBadge" aria-label="Cars to wash">
              <div className="dayModalCarsBadgeHeader">
                <span className="dayModalCarsEmoji" aria-hidden="true">
                  🧼
                </span>
                <span>
                  {day.carsToWash || 0} {day.carsToWash === 1 ? 'car' : 'cars'} to wash
                </span>
              </div>
              {dirtyCars.length > 0 ? (
                <DirtyCarsPanel
                  dirtyCars={dirtyCars}
                  showHeader={false}
                  onCarCleaned={() => {
                    // Optionally trigger a refresh or update
                  }}
                />
              ) : null}
            </div>
            
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
    </>
  )
}

