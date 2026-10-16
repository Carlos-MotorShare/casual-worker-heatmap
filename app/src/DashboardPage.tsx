import './DashboardPage.css'

// Dashboard v1
// const AIRTABLE_DASHBOARD_URL =
//   'https://airtable.com/embed/apprkS2KIK9UVyF14/shr7KgBQ2NImWUaMQ'

// new dashboard v2
const AIRTABLE_DASHBOARD_URL =
  'https://airtable.com/embed/apprkS2KIK9UVyF14/shrhtnnworQ4RJ7jI';

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