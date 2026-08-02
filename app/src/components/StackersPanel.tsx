import { useMemo } from 'react'
import {
  buildStackerGrid,
  isVacantPlate,
  LEVEL_COUNT,
  STACKER_COUNT,
  type CloudflareStackerData,
} from '../lib/stackerTypes'
import './StackersPanel.css'

type StackersPanelProps = {
  data: CloudflareStackerData | null
}

function formatUpdatedAt(iso: string | null): string | null {
  if (!iso) return null
  const d = new Date(iso)
  if (!Number.isFinite(d.getTime())) return null
  return d.toLocaleString(undefined, {
    day: 'numeric',
    month: 'short',
    hour: 'numeric',
    minute: '2-digit',
  })
}

export default function StackersPanel({ data }: StackersPanelProps) {
  const grid = useMemo(() => buildStackerGrid(data?.cars ?? []), [data?.cars])
  const updatedLabel = formatUpdatedAt(data?.timestamp ?? null)

  const levels = useMemo(
    () => Array.from({ length: LEVEL_COUNT }, (_, i) => LEVEL_COUNT - i),
    [],
  )

  return (
    <div className="stackersPanel">
      {updatedLabel ? (
        <p className="stackersUpdated">Last updated {updatedLabel}</p>
      ) : null}

      <div className="stackersGrid" role="list" aria-label="Car stackers">
        <div className="stackersGridInset" aria-hidden="true" />
        {Array.from({ length: STACKER_COUNT }, (_, i) => i + 1).map((stackerNum) => (
          <article
            key={stackerNum}
            className="stackerColumn"
            role="listitem"
            aria-label={`Stacker ${stackerNum}`}
          >
            <header className="stackerColumnHeader">Stacker {stackerNum}</header>
            <div className="stackerLevels">
              {levels.map((level) => {
                const slot = grid[stackerNum][level]
                const plate = slot?.plate ?? ''
                const vacant = !plate || isVacantPlate(plate)

                return (
                  <div
                    key={level}
                    className={[
                      'stackerLevel',
                      vacant ? 'stackerLevel--vacant' : 'stackerLevel--occupied',
                    ].join(' ')}
                  >
                    <span className="stackerLevelLabel">L{level}</span>
                    <span className="stackerPlate">{vacant ? '—' : plate}</span>
                  </div>
                )
              })}
            </div>
          </article>
        ))}
      </div>
    </div>
  )
}
