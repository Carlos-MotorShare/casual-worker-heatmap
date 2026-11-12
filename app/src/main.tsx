import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.tsx'
import DashboardPage from './DashboardPage.tsx'
import ManagedVehiclePage, {
  type ManagedVehiclePageProps,
} from './ManagedVehiclePage.tsx'

const pathname = window.location.pathname.replace(/\/+$/, '') || '/'
const normalizedPathname = pathname.toLowerCase()
const isDashboardRoute = normalizedPathname === '/dashboard'
const isDamagesRoute = normalizedPathname === '/damages'
const isVehicleRoute =
  normalizedPathname === '/vehicle' || normalizedPathname.startsWith('/vehicle/')

const AIRTABLE_DAMAGES_URL =
  'https://airtable.com/embed/apprkS2KIK9UVyF14/shrAVwx50evYY4e8o'
const AIRTABLE_570S_URL =
  'https://airtable.com/embed/apprkS2KIK9UVyF14/shrCtVrFsc6IjMZWc'
const AIRTABLE_RANGE_ROVER_URL =
  'https://airtable.com/embed/apprkS2KIK9UVyF14/shrPDTHuUmu1TTeyb'

const vehiclePages: Record<string, ManagedVehiclePageProps> = {
  '570s': {
    vehicleName: '570S',
    calendarUrl: AIRTABLE_570S_URL,
  },
  rangerover: {
    vehicleName: 'Range Rover',
    calendarUrl: AIRTABLE_RANGE_ROVER_URL,
  },
}

function formatVehicleName(slug: string) {
  if (!slug) return 'Shared Vehicle'

  try {
    return decodeURIComponent(slug)
      .split(/[-_]+/)
      .filter(Boolean)
      .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
      .join(' ')
  } catch {
    return 'Shared Vehicle'
  }
}

const vehicleSlug = isVehicleRoute
  ? normalizedPathname.replace(/^\/vehicle\/?/, '')
  : ''
const vehiclePage = isVehicleRoute
  ? vehiclePages[vehicleSlug] ?? { vehicleName: formatVehicleName(vehicleSlug) }
  : null

document.documentElement.classList.toggle('managedVehicleRoute', isVehicleRoute)

if (isDashboardRoute) {
  document.title = 'Cropped Airtable Dashboard'
} else if (isDamagesRoute) {
  document.title = 'Vehicle Damages Dashboard'
} else if (vehiclePage) {
  document.title = `${vehiclePage.vehicleName} Booking Calendar | MotorShare`
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    {isDashboardRoute ? (
      <DashboardPage />
    ) : isDamagesRoute ? (
      <DashboardPage
        embedUrl={AIRTABLE_DAMAGES_URL}
        iframeTitle="Vehicle damages dashboard"
      />
    ) : vehiclePage ? (
      <ManagedVehiclePage {...vehiclePage} />
    ) : (
      <App />
    )}
  </StrictMode>,
)
