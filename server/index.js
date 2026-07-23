import express from "express";
import cors from "cors";
import "dotenv/config";
import adminUsersHandler from "./api/admin-users.js";
import airtableHandler from "./api/airtable.js";
import loginHandler from "./api/auth/login.js";
import dataHandler from "./api/data.js";
import healthHandler from "./health.js";
import rostersHandler from "./api/rosters.js";
import deleteRosterBlockHandler from "./api/rosters/delete-block.js";
import staffColoursHandler from "./api/staff-colours.js";
import workerUsersHandler from "./api/worker-users.js";
import quickTurnaroundCronHandler from "./api/cron/quick-turnaround.js";
import weekendRosterCronHandler from "./api/cron/weekend-roster.js";
import vehicleCleanedHandler from "./api/webhooks/airtable/vehicle-cleaned.js";

const app = express();

app.use(cors());
app.use(express.json({ limit: "2mb" }));

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseAnonKey = process.env.SUPABASE_ANON_KEY;

if (!supabaseUrl || !supabaseAnonKey) {
  console.error("[supabase] Missing SUPABASE_URL or SUPABASE_ANON_KEY environment variables.");
  process.exit(1);
}

const getRoutes = [
  ["/api/health", healthHandler],
  ["/api/data", dataHandler],
  ["/api/worker-users", workerUsersHandler],
  ["/api/admin-users", adminUsersHandler],
  ["/api/staff-colours", staffColoursHandler],
  ["/api/cron/weekend-roster", weekendRosterCronHandler],
  ["/api/cron/quick-turnaround", quickTurnaroundCronHandler],
];

for (const [path, handler] of getRoutes) {
  app.get(path, handler);
}

app.all("/api/rosters", rostersHandler);
app.post("/api/rosters/delete-block", deleteRosterBlockHandler);
app.post("/api/airtable", airtableHandler);
app.post("/api/auth/login", loginHandler);
app.post("/api/webhooks/airtable/vehicle-cleaned", vehicleCleanedHandler);

const PORT = process.env.PORT || 3001;
app.listen(PORT, () => {
  console.log(`Server listening on http://localhost:${PORT}`);
});
