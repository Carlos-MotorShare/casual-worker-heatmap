import './BottomNav.css'

export type BottomNavKey = 'events' | 'today' | 'calendar'

export type BottomNavItem = {
  key: BottomNavKey
  label: string
  iconSrc: string
}

export type BottomNavProps = {
  active: BottomNavKey
  onChange: (key: BottomNavKey) => void
  items: BottomNavItem[]
}

export default function BottomNav({ active, onChange, items }: BottomNavProps) {
  return (
    <nav className="bottomNav" aria-label="Bottom navigation">
      {items.map((it) => {
        const isActive = it.key === active
        return (
          <button
            key={it.key}
            type="button"
            className={`bottomNavItem${isActive ? ' bottomNavItem--active' : ''}`}
            onClick={() => onChange(it.key)}
            aria-current={isActive ? 'page' : undefined}
          >
            <img className="bottomNavIcon" src={it.iconSrc} alt="" aria-hidden="true" />
            <span className="bottomNavLabel">{it.label}</span>
          </button>
        )
      })}
    </nav>
  )
}

