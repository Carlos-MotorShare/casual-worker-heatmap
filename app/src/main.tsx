import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.tsx'
import DashboardPage from './DashboardPage.tsx'

const pathname = window.location.pathname.replace(/\/+$/, '') || '/'
const isDashboardRoute = pathname === '/dashboard'

if (isDashboardRoute) {
  document.title = 'Cropped Airtable Dashboard'
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    {isDashboardRoute ? <DashboardPage /> : <App />}
  </StrictMode>,
)
