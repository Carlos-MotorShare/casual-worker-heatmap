# Casual Worker Heatmap — Handover

## What this app is

An internal web app for a car rental / vehicle management team (based in New Zealand). It gives staff a real-time view of daily pickup/dropoff workloads and lets managers roster casual workers onto weekend and public holiday shifts. Data originates from Airtable and flows into the app automatically.

---

## Repo structure

```
casual-worker-heatmap/
├── app/          # React frontend (Vite + TypeScript)
├── server/       # Express API server (Node.js ESM, plain JS)
└── supabase/
    └── migrations/   # All DB schema & RPC definitions (run in order)
```

---

## Tech stack

| Layer | Tech |
|---|---|
| Frontend | React 18, TypeScript, Vite, Zustand (state), plain CSS |
| Backend | Node.js (ESM), Express 4 |
| Database | Supabase (Postgres) — accessed via `@supabase/supabase-js` |
| Scheduling | `node-cron` (Friday noon NZ time) |
| Notifications | Slack Incoming Webhooks (Block Kit) |
| Data source | Airtable (pushes via webhook) |

---

## How data flows

```
Airtable
  └─► POST /api/airtable          (server receives a snapshot)
        └─► staffing_data table   (only the latest row is kept — old rows pruned on insert)
              └─► GET /api/data   (frontend polls every 60 seconds)
                    └─► React state → rendered in calendar / today view
```

The `staffing_data` table stores a single JSONB blob per snapshot. The server always keeps exactly one row (the latest). There is no historical day-level table — all day data lives inside `days[]` JSONB on that one row.

There is also a legacy `/api/stream` SSE endpoint — it was deprecated and replaced with polling. It now returns HTTP 410.

---

## Frontend (`app/`)

### Entry point
`src/App.tsx` — single-page app. Three tab pages rendered in the DOM simultaneously (CSS slide transitions):
- **Today** — current day card with the DayDetailPanel
- **Calendar** — MonthlyCalendar with swipeable months and a bottom-sheet day detail
- **Events** — placeholder / not yet built

### Auth
Password-based, shared password for the whole team. `POST /api/auth/login` returns a user object. Stored in `localStorage` via Zustand `persist` middleware (`useUserStore`). No JWT — the user ID is passed as `actorUserId` on roster mutation calls.

### State management
Two Zustand stores:
- `useUserStore` — persisted. Holds the logged-in `User` object.
- `useRosterStore` — session only. Holds `rowsByDate` (roster blocks keyed by YYYY-MM-DD), admin user list, and load functions.

### Key components

| Component | Purpose |
|---|---|
| `DayDetailPanel` | The main day card. Used in both the Today page and Calendar bottom sheet. Contains the timeline, stats, extra hands badge, casual worker list, weekend/holiday roster section. |
| `DayDetailModal` | Thin wrapper that portals `DayDetailPanel` into a modal (used from the old modal flow). |
| `MonthlyCalendar` | Swipeable month view. Clicking a day opens a bottom-sheet `DayDetailPanel`. |
| `DayTimeline` | Horizontal 8am–8pm timeline showing pickups (green), dropoffs (orange), and roster blocks as coloured bars. |
| `ScheduleModal` | Multi-step flow for a casual worker to self-schedule their own shift. |
| `WeekendRosterModal` | Legacy modal — largely superseded by the inline roster section in `DayDetailPanel`. |
| `DirtyCarsPanel` | List of cars needing a wash with next-pickup urgency. |
| `BottomNav` | Tab bar at the bottom. |

### DayDetailPanel variants
The panel has a `variant` prop that controls layout and what sections appear:
- `variant="today"` — Today page. Shows roster read-only, never shows "Public holiday?" assign controls.
- `variant="expanded"` — Calendar bottom sheet. Shows assign controls for canRoster users.
- `undefined` — Original modal layout (two-column with stats on the right). Used by `DayDetailModal`.

### User roles
Three permission levels stored on the `users` table:

| Flag | Meaning |
|---|---|
| _(none)_ | Standard casual worker. Can self-schedule only. |
| `admin = true` | Can remove any roster block. Gets "Work this day" self-assign on weekends/public holidays. Cannot assign others. |
| `can_roster = true` | Full roster manager. Can assign any worker to any day. Can remove anyone's block. |

`admin` users' roster rows are hidden from the casual worker list and the heatmap — they appear separately as "Public holiday roster" or "Weekend roster".

### Public holiday detection
There is no explicit public holiday table or calendar. A weekday is treated as a public holiday if at least one `admin = true` user is rostered on it. This means the "public holiday" designation is manual — a manager must first assign an admin worker, which then unlocks the public-holiday UI treatment.

### Extra hands badge
Shown in the bottom-right of the stats column on weekends and public holidays. Computed in `src/lib/rosterHelpers.ts → computeExtraHandsRequired()`. Two triggers:

1. **Intensity** — 3+ pickups in the same hour, or 2+ dropoffs in the same hour as 1+ pickups.
2. **Range** — pickups exist across all three windows (Morning 8–12, Afternoon 12–5, Evening 5–8pm).

Returns one of: `'No'` | `'Morning'` | `'Afternoon'` | `'Evening'`.

### Theme
Light/dark toggle stored in `localStorage` via `useTheme`. Driven by CSS variables on `:root`.

### Data polling
`App.tsx` fetches `/api/data` on mount and every 60 seconds. Falls back to hardcoded mock data if the server returns nothing (for local dev without a live Airtable feed).

---

## Backend (`server/`)

### `index.js` — all routes

| Route | Method | Purpose |
|---|---|---|
| `/api/health` | GET | Liveness check |
| `/api/auth/login` | POST | Password login → returns user object |
| `/api/data` | GET | Latest staffing snapshot (days, staffsAway, dirtyCars) |
| `/api/airtable` | POST | Airtable pushes new snapshot here. Saves to Supabase, prunes old rows. |
| `/api/rosters` | GET | Roster blocks for a date range (`?start=&end=`) |
| `/api/rosters` | POST | Create/replace a roster for a user on a date |
| `/api/rosters/delete-block` | POST | Delete a single roster block (calls `delete_roster_block` RPC) |
| `/api/admin-users` | GET | List of admin users (for the assign dropdown) |
| `/api/staff-colours` | GET | `{ username → colour }` map for calendar dots |
| `/api/webhooks/airtable/vehicle-cleaned` | POST | Forwards a "car cleaned" event to a hardcoded Airtable webhook URL |

### `slack.js` — notification module
Single export `sendSlackNotification(channel, { text, blocks })`. Channel is `'auto'` or `'alert'`. Reads `SLACK_WEBHOOK_URL_AUTO` / `SLACK_WEBHOOK_URL_ALERT` from env.

Also exports Block Kit helpers: `headerBlock`, `sectionBlock`, `contextBlock`, `dividerBlock`, `slackMention`.

`slackMention(username)` maps known team members to Slack user IDs. Unknown usernames fall back to plain text. Current mapping:

| Username | Slack ID |
|---|---|
| Carlos | U09CM27LZDL |
| James | U06NJ9ZUEN4 |
| Hugo | U07RLKWD8QM |
| Joe | U06NJA5RLFJ |
| Cole | U06MVGHQNM8 |

To add someone: add a line to `SLACK_IDS` in `slack.js`.

### Cron job (Friday 12pm NZ time)
Runs `runWeekendRosterNotification()` which:
1. Derives next Saturday + Sunday dates
2. Fetches staffing data from Supabase for those dates
3. Fetches roster rows for those dates
4. Sends **AUTO** notification:
   - If nobody rostered on either day → warning message
   - If workers assigned → summary per day (names, times, plain-English brief)
5. Sends **ALERT** notification (to `SLACK_WEBHOOK_URL_ALERT`) for each weekend day where `computeExtraHandsRequired` returns a non-null result, including the slot and reason.

`server/test-slack.js` — runnable test script. Change `SCENARIO` at the top to `"warning"`, `"summary"`, or `"alert"` and run `node test-slack.js` to send a test message without triggering the cron.

---

## Database (Supabase)

### Tables

| Table | Purpose |
|---|---|
| `users` | All staff. Columns: `id`, `username`, `password` (plain text shared password), `colour` (CSS hex), `admin`, `can_roster` |
| `rosters` | One row per user per date. Unique constraint on `(user_id, date)` — saving a new roster replaces the old one (delete + insert). |
| `roster_blocks` | Time blocks within a roster. A roster can have multiple blocks (e.g. split shift). |
| `staffing_data` | Single-row JSONB store. `generated_at` + `days` (array of day objects). Always exactly 1 row. |

### RPCs (all called via `supabase.rpc(...)`)

| RPC | Purpose |
|---|---|
| `login_with_password(payload jsonb)` | Returns user row matching password |
| `rosters_for_range(payload jsonb)` | Returns joined roster+block+user rows for a date range |
| `delete_roster_block(payload jsonb)` | Permission-aware block deletion (self / admin / can_roster on weekends) |
| `get_user_flags(p_user_id uuid)` | Returns `admin`, `can_roster` for a given user ID |
| `list_worker_users()` | Returns non-admin users (id, username, colour) |
| `staff_colours()` | Returns username → colour map |

All RPCs use `SECURITY DEFINER` + `REVOKE/GRANT` to prevent direct table access via PostgREST while allowing the anon key to call them.

### Migrations
Run in filename order via the Supabase SQL editor or CLI. Each migration is additive — they use `CREATE OR REPLACE`, `ADD COLUMN IF NOT EXISTS`, and `DROP FUNCTION IF EXISTS` before recreating, so they are safe to re-run. Always end with `NOTIFY pgrst, 'reload schema'` to invalidate the PostgREST schema cache.

If the server logs `PGRST202` for `rosters_for_range`, re-run `20260326160000_rosters_for_range_ensure.sql` in the Supabase SQL editor.

---

## Environment variables

### Server (`server/.env`)

| Variable | Required | Purpose |
|---|---|---|
| `SUPABASE_URL` | Yes | Supabase project URL |
| `SUPABASE_ANON_KEY` | Yes | Supabase anon/publishable key |
| `SLACK_WEBHOOK_URL_AUTO` | No | Slack webhook for Friday roster summaries |
| `SLACK_WEBHOOK_URL_ALERT` | No | Slack webhook for extra-hands alerts |
| `PORT` | No | Server port (default 3001) |

### Frontend (`app/.env` / build-time)

| Variable | Purpose |
|---|---|
| `REACT_APP_API_URL` | API server base URL (defaults to `http://localhost:3001`) |

---

## Running locally

```bash
# Server
cd server
npm install
node index.js         # or: npm run dev (uses --watch)

# Frontend
cd app
npm install
npm run dev
```

The frontend will use mock data if the server returns no days — useful for UI work without a live Airtable feed.

---

## Known design decisions / gotchas

- **No public holiday calendar.** Public holidays are detected by whether an admin user is rostered. The UI treatment (roster section, extra hands badge) only activates once someone is manually assigned.
- **Single staffing snapshot.** `staffing_data` keeps exactly one row. There is no historical record of staffing data beyond what Airtable pushes. If Airtable sends a new snapshot, the old one is deleted.
- **Shared password auth.** There is no per-session token. The user ID returned at login is passed as `actorUserId` on all write operations and trusted server-side for permission checks. This is intentional for a small internal team.
- **Roster replace-on-save.** Posting a new roster for a user+date deletes all existing blocks for that day first, then inserts fresh ones. There is no partial-update path.
- **`rosterUserIsAdmin` flag.** The roster fetch returns whether the owner is an admin user. The frontend uses this to keep admin roster rows out of the casual worker list and heatmap. They render separately as "Weekend roster" / "Public holiday roster".
- **Dirty cars from first day only.** `dirtyCars` is read from `days[0]` in the Airtable payload. This is an Airtable data shape constraint — dirty cars are not per-day but are attached to the first day entry.
- **SSE was deprecated.** The original architecture used Server-Sent Events. This was replaced with 60-second polling (`GET /api/data`) due to deployment environment constraints. The SSE code is commented out in both `index.js` and `App.tsx` for reference.
- **`computeExtraHandsRequired` is duplicated.** The logic exists in both `app/src/lib/rosterHelpers.ts` (TypeScript, for the UI badge) and `server/index.js` (JS, for the Slack alert). If the algorithm changes, update both.
