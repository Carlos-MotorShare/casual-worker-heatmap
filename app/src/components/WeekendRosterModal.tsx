import { useEffect, useId, useMemo, useState } from 'react'
import { createPortal } from 'react-dom'
import {
  canActorRemoveRosterLine,
  resolveUserColour,
  rosterSummaryDetailForDay,
  type RosterSummaryLineDetail,
} from '../lib/rosterHelpers'
import type { RosterRow, User } from '../lib/rosterTypes'
import { useRosterStore } from '../stores/useRosterStore'
import RosterDeleteFlow from './RosterDeleteFlow'
import './WeekendRosterModal.css'

const API_BASE =
  import.meta.env.REACT_APP_API_URL?.toString().trim() || 'http://localhost:3001'

const WEEKEND_BLOCKS = [{ startTime: '08:00:00', endTime: '20:00:00' }]

export type WorkerRow = { id: string; username: string; colour: string | null }

type WeekendRosterModalProps = {
  open: boolean
  dateIso: string
  currentUser: User
  rosterRows: RosterRow[]
  onClose: () => void
  onChanged: () => void
}

function formatWeekendTitle(iso: string) {
  const d = new Date(iso.includes('T') ? iso : `${iso}T12:00:00`)
  if (!Number.isFinite(d.getTime())) return iso
  return d.toLocaleDateString(undefined, {
    weekday: 'long',
    month: 'long',
    day: 'numeric',
  })
}

export default function WeekendRosterModal({
  open,
  dateIso,
  currentUser,
  rosterRows,
  onClose,
  onChanged,
}: WeekendRosterModalProps) {
  const titleId = useId()
  const [entered, setEntered] = useState(false)
  const [workers, setWorkers] = useState<WorkerRow[]>([])
  const [loadError, setLoadError] = useState<string | null>(null)
  const [assignBusy, setAssignBusy] = useState(false)
  const [assignError, setAssignError] = useState<string | null>(null)
  const [deleteLine, setDeleteLine] = useState<RosterSummaryLineDetail | null>(null)
  const [confirmAssign, setConfirmAssign] = useState<{ userId: string; username: string } | null>(null)

  const { adminUsers, adminUsersLoaded, loadAdminUsers } = useRosterStore()

  useEffect(() => {
    if (!open) {
      setEntered(false)
      return
    }
    setEntered(false)
    const id = requestAnimationFrame(() => setEntered(true))
    return () => cancelAnimationFrame(id)
  }, [open])

  useEffect(() => {
    if (!open) return
    const prev = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => {
      document.body.style.overflow = prev
    }
  }, [open])

  useEffect(() => {
    if (!open) return
    setLoadError(null)
    if (!adminUsersLoaded) {
      // Load admin users if not already cached
      void (async () => {
        try {
          await loadAdminUsers(currentUser.id)
          setLoadError(null)
        } catch (e) {
          setLoadError(e instanceof Error ? e.message : 'Could not load admins.')
        }
      })()
    }
  }, [open, currentUser.id, adminUsersLoaded, loadAdminUsers])

  useEffect(() => {
    // Update workers whenever admin users or current user changes
    const filtered = adminUsers.filter((u) => u.id !== currentUser.id)
    setWorkers(filtered)
  }, [adminUsers, currentUser.id])

  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [open, onClose])

  const lines = useMemo(() => rosterSummaryDetailForDay(rosterRows), [rosterRows])

  const rosteredIds = useMemo(() => new Set(rosterRows.map((r) => r.userId)), [rosterRows])

  const assignableWorkers = useMemo(() => {
    return workers.filter((w) => !rosteredIds.has(w.id))
  }, [workers, rosteredIds])

  const showAssign = currentUser.canRoster === true
  const showSelfAssign = currentUser.admin === true && !rosteredIds.has(currentUser.id)

  const saveRosterForUser = async (targetUserId: string) => {
    setAssignBusy(true)
    setAssignError(null)
    try {
      const res = await fetch(`${API_BASE}/api/rosters`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          userId: targetUserId,
          actorUserId: currentUser.id,
          date: dateIso,
          blocks: WEEKEND_BLOCKS,
        }),
      })
      const json = (await res.json().catch(() => ({}))) as { error?: string }
      if (!res.ok) {
        throw new Error(json.error || `Save failed (${res.status})`)
      }
      onChanged()
    } catch (e) {
      setAssignError(e instanceof Error ? e.message : 'Could not save.')
    } finally {
      setAssignBusy(false)
    }
  }

  if (!open) return null

  return createPortal(
    <>
      <div
        className={`weekendRosterBackdrop${entered ? ' weekendRosterBackdrop--visible' : ''}`}
        role="presentation"
        onClick={(e) => {
          if (e.target === e.currentTarget) onClose()
        }}
      >
        <div
          className={`weekendRosterPanel${entered ? ' weekendRosterPanel--visible' : ''}`}
          role="dialog"
          aria-modal="true"
          aria-labelledby={titleId}
          tabIndex={-1}
        >
          <div className="weekendRosterHeader">
            <h2 id={titleId} className="weekendRosterTitle">
              Weekend work
            </h2>
            <button type="button" className="weekendRosterClose" onClick={onClose} aria-label="Close">
              ×
            </button>
          </div>
          <p className="weekendRosterSubtitle">{formatWeekendTitle(dateIso)}</p>

          <div className="weekendRosterSection">
            <h3 className="weekendRosterSectionTitle">Rostered</h3>
            {lines.length === 0 ? (
              <p className="weekendRosterEmpty">No one assigned yet.</p>
            ) : (
              <ul className="weekendRosterList" aria-label="Rostered workers">
                {lines.map((line) => (
                  <li key={line.userId} className="weekendRosterRow">
                    <div className="weekendRosterRowMain">
                      <span
                        className="weekendRosterDot"
                        style={{ background: resolveUserColour(line.colour) }}
                        aria-hidden
                      />
                      <div className="weekendRosterRowText">
                        <span className="weekendRosterName">{line.username}</span>
                        <span className="weekendRosterTimes">{line.rangesDisplay}</span>
                      </div>
                    </div>
                    {canActorRemoveRosterLine(line, currentUser) ? (
                      <button
                        type="button"
                        className="weekendRosterRemove"
                        onClick={() => setDeleteLine(line)}
                      >
                        Remove
                      </button>
                    ) : null}
                  </li>
                ))}
              </ul>
            )}
          </div>

          {showSelfAssign ? (
            <div className="weekendRosterActions">
              <button
                type="button"
                className="weekendRosterSelfBtn"
                disabled={assignBusy}
                onClick={() => setConfirmAssign({ userId: currentUser.id, username: currentUser.username })}
              >
                Work this day
              </button>
            </div>
          ) : null}

          {showAssign ? (
            <div className="weekendRosterAssign">
              <h3 className="weekendRosterSectionTitle">Assign</h3>
              {loadError ? (
                <p className="weekendRosterError" role="alert">
                  {loadError}
                </p>
              ) : null}
              {assignError ? (
                <p className="weekendRosterError" role="alert">
                  {assignError}
                </p>
              ) : null}
              {assignableWorkers.length === 0 ? (
                <p className="weekendRosterHint">Everyone on staff is already rostered.</p>
              ) : (
                <ul className="weekendRosterAssignList">
                  {assignableWorkers.map((w) => (
                    <li key={w.id}>
                      <button
                        type="button"
                        className="weekendRosterAssignBtn"
                        disabled={assignBusy}
                        onClick={() => setConfirmAssign({ userId: w.id, username: w.username })}
                      >
                        + Assign {w.username}
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          ) : null}

          {!showAssign && !showSelfAssign ? (
            <p className="weekendRosterNote">
              Contact Chris if you need changes to this day. Alternatively, you can request to swap with someone who is rostered.
            </p>
          ) : null}
        </div>
      </div>

      <RosterDeleteFlow
        line={deleteLine}
        actorUserId={currentUser.id}
        onClose={() => setDeleteLine(null)}
        onDeleted={() => {
          setDeleteLine(null)
          onChanged()
        }}
        isWeekendOnly={true}
      />

      {confirmAssign ? (
        <div
          className="rosterDeleteBackdrop"
          role="presentation"
          onClick={(e) => {
            if (e.target === e.currentTarget && !assignBusy) setConfirmAssign(null)
          }}
        >
          <div
            className="rosterDeletePanel"
            role="dialog"
            aria-modal="true"
            tabIndex={-1}
          >
            <h3 className="rosterDeleteTitle">Confirm assignment</h3>
            <p className="rosterDeleteHint">
              Assign <strong>{confirmAssign.username}</strong> to work {formatWeekendTitle(dateIso)}?
            </p>
            <div style={{ display: 'flex', gap: '10px', marginTop: '16px', justifyContent: 'flex-end' }}>
              <button
                type="button"
                className="rosterDeleteCancel"
                disabled={assignBusy}
                onClick={() => setConfirmAssign(null)}
              >
                Cancel
              </button>
              <button
                type="button"
                className="rosterDeleteBtn rosterDeleteBtn--primary"
                disabled={assignBusy}
                onClick={() => {
                  void saveRosterForUser(confirmAssign.userId)
                  setConfirmAssign(null)
                }}
              >
                Confirm
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </>,
    document.body,
  )
}
