import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.tsx'
import DashboardPage from './DashboardPage.tsx'

const pathname = window.location.pathname.replace(/\/+$/, '') || '/'
const isDashboardRoute = pathname === '/dashboard'
const is570sRoute = pathname.toLowerCase() === '/vehicle/570s'

const AIRTABLE_570S_URL =
  'https://airtable.com/embed/apprkS2KIK9UVyF14/shrCtVrFsc6IjMZWc'

if (isDashboardRoute) {
  document.title = 'Cropped Airtable Dashboard'
} else if (is570sRoute) {
  document.title = '570S Vehicle Dashboard'
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    {isDashboardRoute ? (
      <DashboardPage />
    ) : is570sRoute ? (
      <DashboardPage
        embedUrl={AIRTABLE_570S_URL}
        iframeTitle="570S vehicle dashboard"
      />
    ) : (
      <App />
    )}
  </StrictMode>,
)
