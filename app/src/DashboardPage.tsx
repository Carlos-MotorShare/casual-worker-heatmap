import './DashboardPage.css'

// Dashboard v1
// const AIRTABLE_DASHBOARD_URL =
//   'https://airtable.com/embed/apprkS2KIK9UVyF14/shr7KgBQ2NImWUaMQ'

// new dashboard v2
const AIRTABLE_DASHBOARD_URL =
  'https://airtable.com/embed/apprkS2KIK9UVyF14/shrhtnnworQ4RJ7jI'

type DashboardPageProps = {
  embedUrl?: string
  iframeTitle?: string
}

export default function DashboardPage({
  embedUrl = AIRTABLE_DASHBOARD_URL,
  iframeTitle = 'Activity dashboard',
}: DashboardPageProps) {
  return (
    <main className="airtableCrop">
      <iframe
        className="airtable-embed"
        src={embedUrl}
        title={iframeTitle}
        allowFullScreen
      />
    </main>
  )
}
