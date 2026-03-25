import { useMemo, useState } from 'react'
import {
  buildSegmentBuckets,
  type TimelineEvent,
} from '../lib/dayTimeline'

export type DayTimelineProps = {
  pickupsList?: Array<TimelineEvent>
  dropoffsList?: Array<TimelineEvent>
}

const MAX_VISIBLE_DOTS = 4

type Combined = { kind: 'pickup' | 'dropoff'; id: string; time: string }

function SegmentBlock({
  pickups,
  dropoffs,
}: {
  pickups: TimelineEvent[]
  dropoffs: TimelineEvent[]
}) {
  const [expanded, setExpanded] = useState(false)
  const [hover, setHover] = useState(false)

  const combined: Combined[] = useMemo(
    () => [
      ...pickups.map((p) => ({ kind: 'pickup' as const, id: p.id, time: p.time })),
      ...dropoffs.map((d) => ({ kind: 'dropoff' as const, id: d.id, time: d.time })),
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
    for (const p of pickups) lines.push({ key: `pickup-${p.id}`, text: `Pickup – ${p.time}` })
    for (const d of dropoffs) {
      lines.push({ key: `dropoff-${d.id}`, text: `Dropoff – ${d.time}` })
    }
    return lines
  }, [pickups, dropoffs])

  return (
    <div
      className={`dayTimelineSeg${hasActivity ? ' dayTimelineSeg--active' : ''}`}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
    >
      <div className="dayTimelineSegInner">
        <div className="dayTimelineSegMarks" aria-hidden="true">
          {visible.map((ev) => (
            <span
              key={`${ev.kind}-${ev.id}`}
              className={
                ev.kind === 'pickup'
                  ? 'dayTimelineDot dayTimelineDot--pickup'
                  : 'dayTimelineDot dayTimelineDot--dropoff'
              }
              title={
                ev.kind === 'pickup'
                  ? `Pickup – ${ev.time}`
                  : `Dropoff – ${ev.time}`
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
      {hover && tooltipLines.length > 0 && (
        <div className="dayTimelineSegTip" role="tooltip">
          {tooltipLines.map((line) => (
            <div key={line.key}>{line.text}</div>
          ))}
        </div>
      )}
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

export default function DayTimeline({ pickupsList, dropoffsList }: DayTimelineProps) {
  const buckets = useMemo(
    () => buildSegmentBuckets(pickupsList, dropoffsList),
    [pickupsList, dropoffsList],
  )

  return (
    <div className="dayTimeline">
      <p className="dayTimelineCaption">8:00 AM – 8:00 PM · 1‑hour blocks</p>
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
        className="dayTimelineBar"
        role="list"
        aria-label="Day schedule from 8 AM to 8 PM"
      >
        {buckets.map((bucket, i) => (
          <SegmentBlock key={i} pickups={bucket.pickups} dropoffs={bucket.dropoffs} />
        ))}
      </div>
    </div>
  )
}
