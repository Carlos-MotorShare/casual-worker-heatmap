import { useState } from 'react'
import './ManagedVehiclePage.css'

const MOTORSHARE_LOGO_URL =
  'https://www.motorshare.co.nz/_next/static/media/logo_footer.56d587a9.svg'

export type ManagedVehiclePageProps = {
  vehicleName: string
  vehicleDescription?: string
  location?: string
  calendarUrl?: string
}

function getSecureCalendarUrl(calendarUrl?: string) {
  if (!calendarUrl) return null

  try {
    const url = new URL(calendarUrl)
    return url.protocol === 'https:' ? url.href : null
  } catch {
    return null
  }
}

function CalendarIcon() {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <rect x="3" y="5" width="18" height="16" rx="2" />
      <path d="M16 3v4M8 3v4M3 10h18" />
      <path d="M8 14h.01M12 14h.01M16 14h.01M8 18h.01M12 18h.01" />
    </svg>
  )
}

function InfoIcon() {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.9"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <circle cx="12" cy="12" r="9" />
      <path d="M12 11v5M12 8h.01" />
    </svg>
  )
}

function PhoneIcon() {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M22 16.9v3a2 2 0 0 1-2.18 2 19.8 19.8 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6A19.8 19.8 0 0 1 2.12 4.2 2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72c.12.9.33 1.78.62 2.63a2 2 0 0 1-.45 2.11L8 9.73a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45c.85.29 1.73.5 2.63.62A2 2 0 0 1 22 16.9z" />
    </svg>
  )
}

function EmailIcon() {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <rect x="3" y="5" width="18" height="14" rx="2" />
      <path d="m3 7 9 6 9-6" />
    </svg>
  )
}

function LocationIcon() {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M20 10c0 5-8 12-8 12S4 15 4 10a8 8 0 1 1 16 0z" />
      <circle cx="12" cy="10" r="2.5" />
    </svg>
  )
}

function WebsiteIcon() {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <circle cx="12" cy="12" r="9" />
      <path d="M3 12h18M12 3a14 14 0 0 1 0 18M12 3a14 14 0 0 0 0 18" />
    </svg>
  )
}

export default function ManagedVehiclePage({
  vehicleName,
  vehicleDescription =
    'View confirmed and reserved booking periods for this jointly owned vehicle.',
  location = 'Auckland',
  calendarUrl,
}: ManagedVehiclePageProps) {
  const [logoFailed, setLogoFailed] = useState(false)
  const secureCalendarUrl = getSecureCalendarUrl(calendarUrl)
  const currentYear = new Date().getFullYear()

  return (
    <div className="managedVehiclePage">
      <header className="managedVehiclePage__header">
        <div className="managedVehiclePage__headerInner">
          <a
            className={`managedVehiclePage__brand${logoFailed ? ' managedVehiclePage__brand--fallback' : ''}`}
            href="https://www.motorshare.co.nz/"
            aria-label="MotorShare home"
          >
            <img
              className="managedVehiclePage__brandLogo"
              src={MOTORSHARE_LOGO_URL}
              alt="MotorShare"
              width="315"
              height="64"
              fetchPriority="high"
              onError={() => setLogoFailed(true)}
            />
            <span className="managedVehiclePage__brandFallback" aria-hidden="true">
              <span className="managedVehiclePage__brandMark">MS</span>
              <span className="managedVehiclePage__brandName">MotorShare</span>
            </span>
          </a>

          <div className="managedVehiclePage__headerCopy">
            <p className="managedVehiclePage__eyebrow">Owner access</p>
            <h1 className="managedVehiclePage__title">
              {vehicleName} Booking Calendar
            </h1>
            <p className="managedVehiclePage__intro">{vehicleDescription}</p>
          </div>
        </div>
      </header>

      <main className="managedVehiclePage__main">
        <div className="managedVehiclePage__contentShell">
          <section
            className="managedVehiclePage__summary"
            aria-label="Vehicle calendar details"
          >
            <div>
              <span className="managedVehiclePage__summaryLabel">Vehicle</span>
              <span className="managedVehiclePage__summaryValue">
                {vehicleName}
              </span>
            </div>
            <div>
              <span className="managedVehiclePage__summaryLabel">
                Primary location
              </span>
              <span className="managedVehiclePage__summaryValue">
                {location}
              </span>
            </div>
          </section>

          <section
            className="managedVehiclePage__calendarFrame"
            aria-label={`${vehicleName} shared booking calendar`}
          >
            <div className="managedVehiclePage__calendarStage">
              {secureCalendarUrl ? (
                <iframe
                  className="airtable-embed managedVehiclePage__calendarEmbed"
                  title={`${vehicleName} booking calendar`}
                  src={secureCalendarUrl}
                  loading="eager"
                  referrerPolicy="strict-origin-when-cross-origin"
                  allow="fullscreen"
                  allowFullScreen
                  width="100%"
                  height="533"
                />
              ) : (
                <div className="managedVehiclePage__placeholder" role="status">
                  <div className="managedVehiclePage__placeholderCard">
                    <div
                      className="managedVehiclePage__placeholderIcon"
                      aria-hidden="true"
                    >
                      <CalendarIcon />
                    </div>
                    <h2>Calendar connection pending</h2>
                    <p>
                      The shared booking calendar will appear here once its
                      secure embed link has been added.
                    </p>
                  </div>
                </div>
              )}
            </div>
          </section>

          <p className="managedVehiclePage__calendarNote">
            <InfoIcon />
            <span>
              Bookings shown in this calendar are provided for owner
              coordination. Please contact MotorShare if a date or booking
              status appears incorrect.
            </span>
          </p>
        </div>
      </main>

      <footer className="managedVehiclePage__footer">
        <div className="managedVehiclePage__footerInner">
          <div>
            <h2 className="managedVehiclePage__footerTitle">
              Need assistance?
            </h2>
            <p className="managedVehiclePage__footerCopy">
              The MotorShare team can help with calendar access, booking
              queries and vehicle coordination.
            </p>
          </div>

          <address className="managedVehiclePage__contactList">
            <div className="managedVehiclePage__contactItem">
              <PhoneIcon />
              <div>
                <span className="managedVehiclePage__contactLabel">Phone</span>
                <a
                  className="managedVehiclePage__contactValue"
                  href="tel:0800220009"
                >
                  0800 220 009
                </a>
              </div>
            </div>

            <div className="managedVehiclePage__contactItem">
              <EmailIcon />
              <div>
                <span className="managedVehiclePage__contactLabel">Email</span>
                <a
                  className="managedVehiclePage__contactValue"
                  href="mailto:team@motorshare.co.nz"
                >
                  team@motorshare.co.nz
                </a>
              </div>
            </div>

            <div className="managedVehiclePage__contactItem">
              <LocationIcon />
              <div>
                <span className="managedVehiclePage__contactLabel">
                  Head office
                </span>
                <a
                  className="managedVehiclePage__contactValue"
                  href="https://maps.google.com/?q=888+Great+South+Road+Penrose+Auckland"
                >
                  888 Great South Road, Penrose, Auckland
                </a>
              </div>
            </div>

            <div className="managedVehiclePage__contactItem">
              <WebsiteIcon />
              <div>
                <span className="managedVehiclePage__contactLabel">
                  Website
                </span>
                <a
                  className="managedVehiclePage__contactValue"
                  href="https://www.motorshare.co.nz/"
                >
                  motorshare.co.nz
                </a>
              </div>
            </div>
          </address>

          <div className="managedVehiclePage__footerLegal">
            <span>&copy; {currentYear} MotorShare Holdings Ltd.</span>
            <span>Owner booking calendar &middot; Private access</span>
          </div>
        </div>
      </footer>
    </div>
  )
}
