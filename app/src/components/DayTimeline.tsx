import {
  useCallback,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from 'react'
import { createPortal } from 'react-dom'
import {
  buildSegmentBuckets,
  type TimelineEvent,
} from '../lib/dayTimeline'
import {
  resolveUserColour,
  segmentMarkersForTimeline,
} from '../lib/rosterHelpers'
import type { RosterRow } from '../lib/rosterTypes'

export type DayTimelineProps = {
  pickupsList?: Array<TimelineEvent>
  dropoffsList?: Array<TimelineEvent>
  rosterRows?: RosterRow[]
}

const MAX_VISIBLE_DOTS = 4

type Combined = {
  kind: 'pickup' | 'dropoff'
  id: string
  time: string
  vehicle?: string
}

/** e.g. "8:00 AM" → "8:00AM" to match compact labels */
function compactTimeForLabel(time: string): string {
  return time.trim().replace(/\s+/g, '')
}

/** One line: "Pickup - 8:00AM - Aston Martin" or "Pickup - 8:00AM" if no vehicle */
function timelineEventLabel(
  kind: 'pickup' | 'dropoff',
  ev: { time: string; vehicle?: string },
): string {
  const head = kind === 'pickup' ? 'Pickup' : 'Dropoff'
  const t = compactTimeForLabel(ev.time)
  const v = ev.vehicle?.trim()
  return v ? `${head} - ${t} - ${v}` : `${head} - ${t}`
}

function SegmentBlock({
  pickups,
  dropoffs,
}: {
  pickups: TimelineEvent[]
  dropoffs: TimelineEvent[]
}) {
  const [expanded, setExpanded] = useState(false)
  const [hover, setHover] = useState(false)
  const segRef = useRef<HTMLDivElement>(null)
  const [fixedTipTop, setFixedTipTop] = useState<number | null>(null)

  const updateFixedTipTop = useCallback(() => {
    const el = segRef.current
    if (!el) return
    const r = el.getBoundingClientRect()
    setFixedTipTop(r.bottom + 6)
  }, [])

  const combined: Combined[] = useMemo(
    () => [
      ...pickups.map((p) => ({
        kind: 'pickup' as const,
        id: p.id,
        time: p.time,
        vehicle: p.vehicle,
      })),
      ...dropoffs.map((d) => ({
        kind: 'dropoff' as const,
        id: d.id,
        time: d.time,
        vehicle: d.vehicle,
      })),
    ],
    [pickups, dropoffs],
  )

  const total = combined.length
  const hasActivity = total > 0
  const needsExpand = total > MAX_VISIBLE_DOTS
  const visible = expanded || !needsExpand ? combined : combined.slice(0, MAX_VISIBLE_DOTS)
  const overflow = total - MAX_VISIBLE_DOTS

  const tooltipLines = useMemo(() => {
    const lines: Array<{ key: string; text: string }> = []
    for (const p of pickups) {
      lines.push({
        key: `pickup-${p.id}`,
        text: timelineEventLabel('pickup', p),
      })
    }
    for (const d of dropoffs) {
      lines.push({
        key: `dropoff-${d.id}`,
        text: timelineEventLabel('dropoff', d),
      })
    }
    return lines
  }, [pickups, dropoffs])

  const hasTip = tooltipLines.length > 0

  useLayoutEffect(() => {
    if (!hover || !hasTip) {
      setFixedTipTop(null)
      return
    }
    updateFixedTipTop()
    const onMove = () => updateFixedTipTop()
    window.addEventListener('scroll', onMove, true)
    window.addEventListener('resize', onMove)
    return () => {
      window.removeEventListener('scroll', onMove, true)
      window.removeEventListener('resize', onMove)
    }
  }, [hover, hasTip, updateFixedTipTop])

  const tipBody = (
    <>
      {tooltipLines.map((line) => (
        <div key={line.key}>{line.text}</div>
      ))}
    </>
  )

  const showPortaledTip = hover && hasTip && fixedTipTop !== null

  return (
    <div
      ref={segRef}
      className={`dayTimelineSeg${hasActivity ? ' dayTimelineSeg--active' : ''}`}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
    >
      <div className="dayTimelineSegInner">
        <div className="dayTimelineSegMarks" aria-hidden="true">
          {visible.map((ev, idx) => (
            <span
              key={`${ev.kind}-${ev.id}-${idx}-${ev.time}`}
              className={
                ev.kind === 'pickup'
                  ? 'dayTimelineDot dayTimelineDot--pickup'
                  : 'dayTimelineDot dayTimelineDot--dropoff'
              }
              title={
                ev.kind === 'pickup'
                  ? timelineEventLabel('pickup', ev)
                  : timelineEventLabel('dropoff', ev)
              }
            />
          ))}
          {pickups.length > 1 && <span className="dayTimelineCount dayTimelineCount--pickup">P{pickups.length}</span>}
          {dropoffs.length > 1 && (
            <span className="dayTimelineCount dayTimelineCount--dropoff">D{dropoffs.length}</span>
          )}
          {!expanded && needsExpand && (
            <span className="dayTimelineMore">+{overflow}</span>
          )}
        </div>
        <div className="dayTimelineSegFill" />
      </div>
      {needsExpand && (
        <button
          type="button"
          className="dayTimelineExpand"
          onClick={(e) => {
            e.stopPropagation()
            setExpanded((v) => !v)
          }}
          aria-expanded={expanded}
        >
          {expanded ? 'Less' : `Expand (${total})`}
        </button>
      )}
      {showPortaledTip
        ? createPortal(
            <div
              className="dayTimelineSegTip--fixed"
              role="tooltip"
              style={{ top: fixedTipTop }}
            >
              {tipBody}
            </div>,
            document.body,
          )
        : null}
    </div>
  )
}

const HOUR_LABEL_BY_SEGMENT: Record<number, string> = {
  0: '8 AM',
  2: '10 AM',
  4: '12 PM',
  6: '2 PM',
  8: '4 PM',
  10: '6 PM',
  11: '7 PM',
}

export default function DayTimeline({
  pickupsList,
  dropoffsList,
  rosterRows,
}: DayTimelineProps) {
  const buckets = useMemo(
    () => buildSegmentBuckets(pickupsList, dropoffsList),
    [pickupsList, dropoffsList],
  )

  const markersBySegment = useMemo(
    () => segmentMarkersForTimeline(rosterRows ?? []),
    [rosterRows],
  )

  return (
    <div className="dayTimeline">
      <p className="dayTimelineCaption">8:00 AM – 8:00 PM<br />1‑hour blocks</p>
      <div className="dayTimelineAxis" aria-hidden="true">
        {buckets.map((_, i) => (
          <div key={i} className="dayTimelineAxisRow">
            {HOUR_LABEL_BY_SEGMENT[i] ? (
              <span className="dayTimelineAxisTick">{HOUR_LABEL_BY_SEGMENT[i]}</span>
            ) : null}
          </div>
        ))}
      </div>
      <div
        className="dayTimelineSegmentsCol"
        role="list"
        aria-label="Day schedule from 8 AM to 8 PM"
      >
        {buckets.map((bucket, i) => (
          <div key={i} className="dayTimelineSegCell">
            <SegmentBlock pickups={bucket.pickups} dropoffs={bucket.dropoffs} />
          </div>
        ))}
      </div>
      <div className="dayTimelineRosterRail" aria-hidden="true">
        <div className="dayTimelineRosterRailGrid">
          {markersBySegment.map((markers, i) => (
            <div key={i} className="dayTimelineRosterSegRow">
              <div className="dayTimelineRosterSwatches">
                {markers.map((m, swatchIdx) => (
                  <span
                    key={`${i}-${m.userId}-${swatchIdx}`}
                    className="dayTimelineRosterSwatch"
                    style={{ background: resolveUserColour(m.colour) }}
                    title={`${m.username} (rostered)`}
                  />
                ))}
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}
