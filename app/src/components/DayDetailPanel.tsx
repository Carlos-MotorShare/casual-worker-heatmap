import { useEffect, useId, useMemo, useState } from 'react'
import { createPortal } from 'react-dom'
import {
  canActorRemoveRosterLine,
  isWeekendIso,
  resolveUserColour,
  rosterSummaryDetailForDay,
  type RosterSummaryLineDetail,
} from '../lib/rosterHelpers'
import type { RosterRow, User } from '../lib/rosterTypes'
import type { DirtyCar, StaffingDay } from '../staffingDay'
import DayTimeline from './DayTimeline'
import RosterDeleteFlow from './RosterDeleteFlow'
import DirtyCarsPanel from './DirtyCarsPanel'
import { useRosterStore } from '../stores/useRosterStore'
import './WeekendRosterModal.css'

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
  /** Controls section ordering:
   *  - 'today': chart → weekend → staff away → dirty cars
   *  - 'expanded': chart → staff away → weekend (+ assign for admin/canRoster)
   *  - undefined/default: original layout  */
  variant?: 'today' | 'expanded'
  /** When false the day has no real SSE data — hides chart / stats. */
  hasRealData?: boolean
  /** Full roster rows by date — needed for weekend roster display. */
  rosterRowsByDate?: Record<string, RosterRow[]>
  /** Lowercased username → CSS colour. */
  staffColourByLowerName?: Record<string, string>
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
  variant,
  hasRealData = true,
  rosterRowsByDate,
  staffColourByLowerName,
}: DayDetailPanelProps) {
  const titleId = useId()
  const [deleteLine, setDeleteLine] = useState<RosterSummaryLineDetail | null>(null)

  const rosterSummaryDetail = useMemo(
    () => rosterSummaryDetailForDay(rosterRows),
    [rosterRows],
  )

  const pickupsList = day.pickupsList ?? []
  const dropoffsList = day.dropoffsList ?? []
  const isWeekend = isWeekendIso(day.date)

  const awayEntries = useMemo(() => {
    const iso = day.date
    const fromRanges = staffsAway
      .filter((a) => a.startDate <= iso && a.endDate >= iso)
      .map((a) => ({ name: a.staffName, reason: a.reason }))
      .filter((a) => a.name)
    const fromDay = (day.staffsAway ?? [])
      .filter((a) => a.startDate <= iso && a.endDate >= iso)
      .map((a) => ({ name: a.staffName, reason: a.reason }))
      .filter((a) => a.name)
    const all = [...fromRanges, ...fromDay]
    const seen = new Set<string>()
    const unique: { name: string; reason: string }[] = []
    for (const entry of all) {
      if (seen.has(entry.name)) continue
      seen.add(entry.name)
      unique.push(entry)
    }
    return unique.sort((a, b) => a.name.localeCompare(b.name))
  }, [day.date, day.staffsAway, staffsAway])

  /* ── Weekend roster assign logic (admin/canRoster only) ── */
  const API_BASE = import.meta.env.REACT_APP_API_URL?.toString().trim() || 'http://localhost:3001'
  const WEEKEND_BLOCKS = [{ startTime: '08:00:00', endTime: '20:00:00' }]
  const { adminUsers, adminUsersLoaded, loadAdminUsers } = useRosterStore()
  const [assignBusy, setAssignBusy] = useState(false)
  const [assignError, setAssignError] = useState<string | null>(null)
  const [confirmAssign, setConfirmAssign] = useState<{ userId: string; username: string } | null>(null)

  const showAssign = isWeekend && (currentUser?.canRoster === true)
  const allDayRows = rosterRowsByDate?.[day.date] ?? rosterRows
  const showSelfAssign = isWeekend
    && (currentUser?.admin === true || currentUser?.canRoster === true)
    && !allDayRows.some((r) => r.userId === currentUser?.id)

  // Load admin users when weekend panel is shown
  useEffect(() => {
    if (!isWeekend || !currentUser) return
    if (!adminUsersLoaded) {
      void loadAdminUsers(currentUser.id)
    }
  }, [isWeekend, currentUser, adminUsersLoaded, loadAdminUsers])

  const rosteredIds = useMemo(() => {
    // Use full roster for the day (including non-admin self-rosters) to prevent duplicates
    const allRows = rosterRowsByDate?.[day.date] ?? rosterRows
    return new Set(allRows.map((r) => r.userId))
  }, [rosterRowsByDate, day.date, rosterRows])
  const assignableWorkers = useMemo(() => {
    if (!currentUser) return []
    return adminUsers.filter((w) => !rosteredIds.has(w.id) && w.id !== currentUser.id)
  }, [adminUsers, rosteredIds, currentUser])

  const weekendRosterLines = useMemo(() => {
    // For weekend days, only show admin users in the weekend roster section
    if (!isWeekend) return []
    const allRows = rosterRowsByDate?.[day.date] ?? rosterRows
    const adminOnly = allRows.filter((r) => r.rosterUserIsAdmin === true)
    return rosterSummaryDetailForDay(adminOnly)
  }, [isWeekend, rosterRowsByDate, day.date, rosterRows])

  const saveRosterForUser = async (targetUserId: string) => {
    if (!currentUser) return
    setAssignBusy(true)
    setAssignError(null)
    try {
      const res = await fetch(`${API_BASE}/api/rosters`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          userId: targetUserId,
          actorUserId: currentUser.id,
          date: day.date,
          blocks: WEEKEND_BLOCKS,
        }),
      })
      const json = (await res.json().catch(() => ({}))) as { error?: string }
      if (!res.ok) {
        throw new Error(json.error || `Save failed (${res.status})`)
      }
      onRosterBlockDeleted?.() // reload rosters
    } catch (e) {
      setAssignError(e instanceof Error ? e.message : 'Could not save.')
    } finally {
      setAssignBusy(false)
    }
  }

  /* ── Shared sub-components ── */

  const chartSection = (
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
  )

  const staffAwaySection = awayEntries.length > 0 ? (
    <div className="dayModalSection">
      <p className="dayModalStaffLine">Staff away ({awayEntries.length})</p>
      <ul className="dayModalStaffAwayList" aria-label="Staff away list">
        {awayEntries.map((entry) => (
          <li key={entry.name}>
            <span
              className="dayModalStaffAwayDot"
              style={{ background: staffColourByLowerName?.[entry.name.trim().toLowerCase()] || resolveUserColour(undefined) }}
              aria-hidden
            />
            {entry.name} – {entry.reason}
          </li>
        ))}
      </ul>
    </div>
  ) : null

  const weekendRosterSection = isWeekend ? (
    <div className="dayModalSection">
      <p className="dayModalStaffLine">Weekend roster</p>

      {/* Rostered workers list */}
      {weekendRosterLines.length === 0 ? (
        <p style={{ fontSize: 13, opacity: 0.7, margin: 0 }}>No one assigned yet.</p>
      ) : (
        <div className="dayModalRosterSummary" aria-label="Weekend roster" style={{ marginTop: 0 }}>
          {weekendRosterLines.map((line) => (
            <div key={`wknd-${line.userId}`} className="dayModalRosterSummaryLine">
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
      )}

      {/* Self-assign button (admin only) */}
      {showSelfAssign ? (
        <button
          type="button"
          className="weekendRosterSelfBtn"
          disabled={assignBusy}
          onClick={() => setConfirmAssign({ userId: currentUser!.id, username: currentUser!.username })}
          style={{ marginTop: 8 }}
        >
          Work this day
        </button>
      ) : null}

      {/* Assign section (canRoster users) */}
      {showAssign ? (
        <div style={{ marginTop: 12, borderTop: '1px solid color-mix(in srgb, var(--border), transparent 40%)', paddingTop: 12 }}>
          <p style={{ margin: '0 0 8px', fontSize: 11, textTransform: 'uppercase', letterSpacing: '0.6px', opacity: 0.75 }}>
            Assign
          </p>
          {assignError ? (
            <p style={{ color: '#f87171', fontSize: 13, margin: '0 0 8px' }} role="alert">{assignError}</p>
          ) : null}
          {assignableWorkers.length === 0 ? (
            <p style={{ fontSize: 13, opacity: 0.82, margin: 0 }}>Everyone on staff is already rostered.</p>
          ) : (
            <div style={{ display: 'grid', gap: 8 }}>
              {assignableWorkers.map((w) => (
                <button
                  key={w.id}
                  type="button"
                  className="weekendRosterAssignBtn"
                  disabled={assignBusy}
                  onClick={() => setConfirmAssign({ userId: w.id, username: w.username })}
                >
                  + Assign {w.username}
                </button>
              ))}
            </div>
          )}
        </div>
      ) : null}
    </div>
  ) : null

  /** Full-width stats row for stacked (today / expanded) layouts. */
  const statsRowSection = (
    <div className="dayModalStatsGroup">
      <div className="dayModalStatsRow">
        <div className="dayModalStat">
          <span className="dayModalStatLabelWithLegend">
            <span className="dayModalLegendDot dayModalLegendDot--pickup" aria-hidden />
            Pickups
          </span>
          <span className="dayModalStatValue dayModalStatValue--sm">{day.pickups}</span>
        </div>
        <div className="dayModalStat">
          <span className="dayModalStatLabelWithLegend">
            <span className="dayModalLegendDot dayModalLegendDot--dropoff" aria-hidden />
            Dropoffs
          </span>
          <span className="dayModalStatValue dayModalStatValue--sm">{day.dropoffs}</span>
        </div>
      </div>
      <div className="dayModalCarsRow">
        <span className="dayModalCarsEmoji" aria-hidden="true">🧼</span>
        <span className="dayModalCarsLabel">
          {day.carsToWash || 0} {(day.carsToWash ?? 0) === 1 ? 'car' : 'cars'} to wash
        </span>
      </div>
    </div>
  )

  const dirtyCarsSection = dirtyCars.length > 0 ? (
    <div className="dayModalSection">
      <DirtyCarsPanel
        dirtyCars={dirtyCars}
        showHeader={true}
        onCarCleaned={() => {}}
      />
    </div>
  ) : null

  /* ── Render based on variant ── */

  const renderBody = () => {
    if (variant === 'today') {
      // Today: chart → stats → weekend roster → staff away → dirty cars
      return (
        <div className="dayModalBody dayModalBody--stacked">
          {chartSection}
          {statsRowSection}
          {weekendRosterSection}
          {staffAwaySection}
          {dirtyCarsSection}
        </div>
      )
    }

    if (variant === 'expanded') {
      // Expanded (from calendar bottom sheet): chart → stats → staff away → weekend roster
      return (
        <div className="dayModalBody dayModalBody--stacked">
          {hasRealData ? (
            <>
              {chartSection}
              {statsRowSection}
            </>
          ) : (
            <p style={{ opacity: 0.6, fontSize: 14, margin: '4px 0 12px', textAlign: 'center' }}>
              No data available for this day.
            </p>
          )}
          {staffAwaySection}
          {weekendRosterSection}
        </div>
      )
    }

    // Default/modal: original layout
    return (
      <div className="dayModalBody">
        {chartSection}
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

          {awayEntries.length > 0 ? (
            <>
              <p className="dayModalStaffLine">Staff away ({awayEntries.length})</p>
              <ul className="dayModalStaffAwayList" aria-label="Staff away list">
                {awayEntries.map((entry) => (
                  <li key={entry.name}>
                    <span
                      className="dayModalStaffAwayDot"
                      style={{ background: staffColourByLowerName?.[entry.name.trim().toLowerCase()] || resolveUserColour(undefined) }}
                      aria-hidden
                    />
                    {entry.name} – {entry.reason}
                  </li>
                ))}
              </ul>
            </>
          ) : null}

          <div className="dayModalCarsBadge" aria-label="Cars to wash">
            <div className="dayModalCarsBadgeHeader">
              <span className="dayModalCarsEmoji" aria-hidden="true">🧼</span>
              <span>
                {day.carsToWash || 0} {day.carsToWash === 1 ? 'car' : 'cars'} to wash
              </span>
            </div>
            {dirtyCars.length > 0 ? (
              <DirtyCarsPanel
                dirtyCars={dirtyCars}
                showHeader={false}
                onCarCleaned={() => {}}
              />
            ) : null}
          </div>
        </div>
      </div>
    )
  }

  return (
    <>
      <div className={tone === 'modal' ? 'dayModalPanelInner' : 'dayPanel'}>
        <div className="dayModalHeader">
          <h2 id={titleId} className="dayModalTitle">
            {formatTitle(day.date)}
          </h2>
          {rightAction}
        </div>
        {renderBody()}
      </div>

      <RosterDeleteFlow
        line={deleteLine}
        actorUserId={currentUser?.id ?? ''}
        onClose={() => setDeleteLine(null)}
        onDeleted={() => {
          onRosterBlockDeleted?.()
        }}
      />

      {/* Confirm-assign dialog — portalled to body for viewport centering */}
      {confirmAssign
        ? createPortal(
            <div className="rosterDeleteBackdrop" onClick={() => setConfirmAssign(null)}>
              <div
                className="rosterDeletePanel"
                onClick={(e) => e.stopPropagation()}
                role="alertdialog"
                aria-label={`Assign ${confirmAssign.username}?`}
              >
                <h3 className="rosterDeleteTitle" style={{ textAlign: 'center' }}>
                  Confirm assignment
                </h3>
                <p className="rosterDeleteHint" style={{ textAlign: 'center' }}>
                  Assign <strong>{confirmAssign.username}</strong> to{' '}
                  <strong>{formatTitle(day.date)}</strong>?
                </p>
                {assignError ? (
                  <p className="rosterDeleteError" role="alert" style={{ textAlign: 'center' }}>
                    {assignError}
                  </p>
                ) : null}
                <div className="rosterDeleteActions" style={{ justifyContent: 'center' }}>
                  <button
                    type="button"
                    className="rosterDeleteBtn rosterDeleteBtn--ghost"
                    disabled={assignBusy}
                    onClick={() => {
                      setConfirmAssign(null)
                      setAssignError(null)
                    }}
                  >
                    Cancel
                  </button>
                  <button
                    type="button"
                    className="rosterDeleteBtn rosterDeleteBtn--primary"
                    disabled={assignBusy}
                    onClick={async () => {
                      await saveRosterForUser(confirmAssign.userId)
                      if (!assignError) setConfirmAssign(null)
                    }}
                  >
                    {assignBusy ? 'Saving…' : 'Confirm'}
                  </button>
                </div>
              </div>
            </div>,
            document.body,
          )
        : null}
    </>
  )
}