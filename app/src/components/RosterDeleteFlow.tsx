import { useEffect, useId, useState } from 'react'
import { createPortal } from 'react-dom'
import type { RosterSummaryLineDetail } from '../lib/rosterHelpers'

const API_BASE =
  import.meta.env.REACT_APP_API_URL?.toString().trim() || 'http://localhost:3001'

type Phase = 'pick' | 'confirm' | 'done'

type RosterDeleteFlowProps = {
  line: RosterSummaryLineDetail | null
  actorUserId: string
  onClose: () => void
  onDeleted: () => void
}

export default function RosterDeleteFlow({
  line,
  actorUserId,
  onClose,
  onDeleted,
}: RosterDeleteFlowProps) {
  const titleId = useId()
  const [phase, setPhase] = useState<Phase>('pick')
  const [selectedBlockId, setSelectedBlockId] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!line) return
    setPhase('pick')
    setSelectedBlockId(line.blocks.length === 1 ? line.blocks[0].blockId : null)
    setError(null)
    setBusy(false)
  }, [line])

  useEffect(() => {
    if (!line) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !busy) onClose()
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [line, busy, onClose])

  if (!line) return null

  const selectedBlock = line.blocks.find((b) => b.blockId === selectedBlockId)

  const runDelete = async () => {
    if (!selectedBlockId) return
    setBusy(true)
    setError(null)
    try {
      const res = await fetch(`${API_BASE}/api/rosters/delete-block`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ blockId: selectedBlockId, actorUserId }),
      })
      const json = (await res.json().catch(() => ({}))) as { error?: string }
      if (!res.ok) {
        setError(json.error || 'Could not remove this shift.')
        setBusy(false)
        return
      }
      setPhase('done')
      onDeleted()
    } catch {
      setError('Network error. Try again.')
    } finally {
      setBusy(false)
    }
  }

  return createPortal(
    <div
      className="rosterDeleteBackdrop"
      role="presentation"
      onClick={(e) => {
        if (e.target === e.currentTarget && !busy) onClose()
      }}
    >
      <div
        className="rosterDeletePanel"
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
      >
        {phase === 'pick' ? (
          <>
            <h3 id={titleId} className="rosterDeleteTitle">
              Remove a shift
            </h3>
            <p className="rosterDeleteHint">
              Choose which time block to remove for <strong>{line.username}</strong>.
            </p>
            <ul className="rosterDeleteList" role="radiogroup" aria-label="Shift blocks">
              {line.blocks.map((b) => (
                <li key={b.blockId}>
                  <label className="rosterDeleteOption">
                    <input
                      type="radio"
                      name="roster-block"
                      value={b.blockId}
                      checked={selectedBlockId === b.blockId}
                      onChange={() => setSelectedBlockId(b.blockId)}
                    />
                    <span>{b.label}</span>
                  </label>
                </li>
              ))}
            </ul>
            {error ? (
              <p className="rosterDeleteError" role="alert">
                {error}
              </p>
            ) : null}
            <div className="rosterDeleteActions">
              <button type="button" className="rosterDeleteBtn rosterDeleteBtn--ghost" onClick={onClose}>
                Cancel
              </button>
              <button
                type="button"
                className="rosterDeleteBtn rosterDeleteBtn--primary"
                disabled={!selectedBlockId}
                onClick={() => setPhase('confirm')}
              >
                Continue
              </button>
            </div>
          </>
        ) : null}

        {phase === 'confirm' ? (
          <>
            <h3 id={titleId} className="rosterDeleteTitle">
              Confirm removal
            </h3>
            <p className="rosterDeleteHint">
              Remove <strong>{selectedBlock?.label ?? 'this shift'}</strong> for{' '}
              <strong>{line.username}</strong>? This cannot be undone.
            </p>
            {error ? (
              <p className="rosterDeleteError" role="alert">
                {error}
              </p>
            ) : null}
            <div className="rosterDeleteActions">
              <button
                type="button"
                className="rosterDeleteBtn rosterDeleteBtn--ghost"
                disabled={busy}
                onClick={() => {
                  setPhase('pick')
                  setError(null)
                }}
              >
                Back
              </button>
              <button
                type="button"
                className="rosterDeleteBtn rosterDeleteBtn--danger"
                disabled={busy}
                onClick={() => void runDelete()}
              >
                {busy ? 'Removing…' : 'Remove shift'}
              </button>
            </div>
          </>
        ) : null}

        {phase === 'done' ? (
          <>
            <h3 id={titleId} className="rosterDeleteTitle">
              Shift removed
            </h3>
            <p className="rosterDeleteHint">The roster has been updated.</p>
            <div className="rosterDeleteActions">
              <button type="button" className="rosterDeleteBtn rosterDeleteBtn--primary" onClick={onClose}>
                OK
              </button>
            </div>
          </>
        ) : null}
      </div>
    </div>,
    document.body,
  )
}
