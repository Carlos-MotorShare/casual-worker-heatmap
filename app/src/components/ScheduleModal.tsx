import { useCallback, useEffect, useId, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import {
  formatDayOrdinalNZ,
  formatReadableRanges,
  groupBlocksIntoRanges,
  minutesToPgTime,
} from '../lib/rosterHelpers'
import TimeBlockSelector from './TimeBlockSelector'
import './ScheduleModal.css'

const API_BASE =
  import.meta.env.REACT_APP_API_URL?.toString().trim() || 'http://localhost:3001'

type Phase = 'intro' | 'selecting' | 'confirm'

export type ScheduleModalProps = {
  open: boolean
  dateIso: string
  userId: string
  onClose: () => void
  onSaved: () => void
}

export default function ScheduleModal({
  open,
  dateIso,
  userId,
  onClose,
  onSaved,
}: ScheduleModalProps) {
  const titleId = useId()
  const panelRef = useRef<HTMLDivElement>(null)
  const [entered, setEntered] = useState(false)
  const [phase, setPhase] = useState<Phase>('intro')
  const [selected, setSelected] = useState<Set<number>>(() => new Set())
  const [saving, setSaving] = useState(false)
  const [saveError, setSaveError] = useState<string | null>(null)
  const [confirmRanges, setConfirmRanges] = useState<
    Array<{ startMinutes: number; endMinutes: number }>
  >([])

  useEffect(() => {
    if (!open) {
      setEntered(false)
      setPhase('intro')
      setSelected(new Set())
      setSaving(false)
      setSaveError(null)
      setConfirmRanges([])
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
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        if (phase === 'selecting') {
          setPhase('intro')
          setSelected(new Set())
        } else if (phase === 'intro') {
          onClose()
        } else if (phase === 'confirm') {
          onClose()
        }
      }
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [open, phase, onClose])

  useEffect(() => {
    if (open && panelRef.current) {
      panelRef.current.focus()
    }
  }, [open, phase])

  const toggleBlock = useCallback((idx: number) => {
    setSelected((prev) => {
      const next = new Set(prev)
      if (next.has(idx)) next.delete(idx)
      else next.add(idx)
      return next
    })
  }, [])

  const handleReady = () => {
    setPhase('selecting')
    setSaveError(null)
  }

  const handleCancelIntro = () => {
    onClose()
  }

  const handleCancelSelecting = () => {
    setPhase('intro')
    setSelected(new Set())
  }

  const handleDone = async () => {
    const ranges = groupBlocksIntoRanges([...selected])
    if (!ranges.length) {
      setSaveError('Select at least one time block.')
      return
    }
    setSaving(true)
    setSaveError(null)
    try {
      const blocks = ranges.map((r) => ({
        startTime: minutesToPgTime(r.startMinutes),
        endTime: minutesToPgTime(r.endMinutes),
      }))
      const res = await fetch(`${API_BASE}/api/rosters`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userId, date: dateIso, blocks }),
      })
      if (!res.ok) {
        const msg = (await res.json().catch(() => ({}))) as { error?: string }
        throw new Error(msg.error || `Save failed (${res.status})`)
      }
      setConfirmRanges(ranges)
      setPhase('confirm')
      onSaved()
    } catch (e) {
      setSaveError(e instanceof Error ? e.message : 'Could not save.')
    } finally {
      setSaving(false)
    }
  }

  const handleConfirmOk = () => {
    onClose()
  }

  const handleBackdropClick = () => {
    if (phase === 'selecting') return
    onClose()
  }

  if (!open) return null

  const readableRanges =
    confirmRanges.length > 0 ? formatReadableRanges(confirmRanges) : ''
  const dayPhrase = formatDayOrdinalNZ(dateIso)

  return createPortal(
    <div
      className={`scheduleModalBackdrop${entered ? ' scheduleModalBackdrop--visible' : ''}`}
      role="presentation"
      onClick={(e) => {
        if (e.target === e.currentTarget) handleBackdropClick()
      }}
    >
      <div
        ref={panelRef}
        className={`scheduleModalPanel${entered ? ' scheduleModalPanel--visible' : ''}`}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        tabIndex={-1}
      >
        {phase === 'intro' ? (
          <>
            <h2 id={titleId} className="scheduleModalTitle">
              Ready to work?
            </h2>
            <p className="scheduleModalSubtitle">
              Please tap the periods that you can work, and press done once you have
              selected.
            </p>
            <div className="scheduleModalActions">
              <button type="button" className="scheduleModalBtn scheduleModalBtn--primary" onClick={handleReady}>
                Ready
              </button>
              <button type="button" className="scheduleModalBtn scheduleModalBtn--ghost" onClick={handleCancelIntro}>
                Cancel
              </button>
            </div>
          </>
        ) : null}

        {phase === 'selecting' ? (
          <>
            <h2 id={titleId} className="scheduleModalTitle">
              Select your times
            </h2>
            <p className="scheduleModalSubtitle">
              Tap blocks to select or deselect. Use Done when finished.
            </p>
            <TimeBlockSelector
              selected={selected}
              onToggle={toggleBlock}
              interactive
            />
            {saveError ? (
              <p className="scheduleModalError" role="alert">
                {saveError}
              </p>
            ) : null}
            <div className="scheduleModalActions scheduleModalActions--split">
              <button
                type="button"
                className="scheduleModalBtn scheduleModalBtn--ghost"
                onClick={handleCancelSelecting}
                disabled={saving}
              >
                Cancel
              </button>
              <button
                type="button"
                className="scheduleModalBtn scheduleModalBtn--primary"
                onClick={handleDone}
                disabled={saving}
              >
                {saving ? 'Saving…' : 'Done'}
              </button>
            </div>
          </>
        ) : null}

        {phase === 'confirm' ? (
          <>
            <h2 id={titleId} className="scheduleModalTitle">
              You&apos;re rostered!
            </h2>
            <p className="scheduleModalSubtitle">
              You are rostered from {readableRanges} on {dayPhrase}. If anything
              changes, please let us know in the group chat.
            </p>
            <div className="scheduleModalActions">
              <button type="button" className="scheduleModalBtn scheduleModalBtn--primary" onClick={handleConfirmOk}>
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
