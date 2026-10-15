import './DashboardPage.css'

const AIRTABLE_DASHBOARD_URL =
  'https://airtable.com/embed/apprkS2KIK9UVyF14/shr7KgBQ2NImWUaMQ'

export default function DashboardPage() {
  return (
    <main className="airtableCrop">
      <iframe
        src={AIRTABLE_DASHBOARD_URL}
        title="Activity dashboard"
        allowFullScreen
      />
    </main>
  )
}
