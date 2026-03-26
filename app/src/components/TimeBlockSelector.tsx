import { mapTimeToBlocks } from '../lib/rosterHelpers'
import './TimeBlockSelector.css'

export type TimeBlockSelectorProps = {
  selected: ReadonlySet<number>
  onToggle: (blockIndex: number) => void
  interactive: boolean
}

export default function TimeBlockSelector({
  selected,
  onToggle,
  interactive,
}: TimeBlockSelectorProps) {
  const blocks = mapTimeToBlocks()

  return (
    <div
      className={`timeBlockSelector${interactive ? ' timeBlockSelector--interactive' : ''}`}
      role="list"
      aria-label="30-minute availability blocks from 8:00 AM to 8:00 PM"
    >
      {blocks.map((b) => {
        const isOn = selected.has(b.index)
        return (
          <button
            key={b.index}
            type="button"
            role="listitem"
            className={`timeBlockSelector__cell${isOn ? ' timeBlockSelector__cell--selected' : ''}`}
            disabled={!interactive}
            onClick={() => interactive && onToggle(b.index)}
            aria-pressed={isOn}
            aria-label={`${formatLabel(b.startMinutes)} to ${formatLabel(b.endMinutes)}`}
          >
            <span className="timeBlockSelector__label">{formatLabel(b.startMinutes)}</span>
          </button>
        )
      })}
    </div>
  )
}

function formatLabel(mins: number): string {
  const d = new Date(Date.UTC(1970, 0, 1, Math.floor(mins / 60) % 24, mins % 60, 0))
  return d.toLocaleTimeString('en-NZ', {
    timeZone: 'UTC',
    hour: 'numeric',
    minute: mins % 60 === 0 ? undefined : '2-digit',
    hour12: true,
  })
}

