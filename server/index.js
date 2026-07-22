import express from "express";
import cors from "cors";
import "dotenv/config";
import adminUsersHandler from "./api/admin-users.js";
import dataHandler from "./api/data.js";
import healthHandler from "./api/health.js";
import rostersHandler from "./api/rosters.js";
import deleteRosterBlockHandler from "./api/rosters/delete-block.js";
import staffColoursHandler from "./api/staff-colours.js";
import streamHandler from "./api/stream.js";
import workerUsersHandler from "./api/worker-users.js";
import quickTurnaroundCronHandler from "./api/cron/quick-turnaround.js";
import weekendRosterCronHandler from "./api/cron/weekend-roster.js";
import { coerceIncomingPayload } from "./helpers/staffing-data.js";
import { supabase } from "./supabase.js";

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
  ["/api/stream", streamHandler],
  ["/api/cron/weekend-roster", weekendRosterCronHandler],
  ["/api/cron/quick-turnaround", quickTurnaroundCronHandler],
];

for (const [path, handler] of getRoutes) {
  app.get(path, handler);
}

app.all("/api/rosters", rostersHandler);
app.post("/api/rosters/delete-block", deleteRosterBlockHandler);

app.post("/api/airtable", async (req, res) => {
  const payload = coerceIncomingPayload(req.body);
  const generatedAt = payload?.generatedAt ?? "(missing generatedAt)";
  const daysCount = Array.isArray(payload?.days) ? payload.days.length : 0;

  console.log(`[airtable] received payload generatedAt=${generatedAt} days=${daysCount}`);
  if (payload?.days?.[0]) {
    const firstDay = /** @type {Record<string, unknown>} */ (payload.days[0]);
    console.log("[airtable] days[0] keys:", Object.keys(firstDay));
    console.log("[airtable] days[0] dirtyCars:", firstDay.dirtyCars);
  }

  if (!payload) {
    console.error("[airtable] invalid payload format.");
    return res.status(500).json({ error: "Failed to save data." });
  }

  try {
    const { data: inserted, error: insertError } = await supabase
      .from("staffing_data")
      .insert({
        generated_at: payload.generatedAt,
        days: payload.days,
      })
      .select("id, generated_at, days")
      .single();

    if (insertError) {
      console.error("[airtable] failed to save payload to Supabase:", insertError);
      return res.status(500).json({ error: "Failed to save data." });
    }

    if (!inserted?.id) {
      console.error("[airtable] insert returned no row id.");
      return res.status(500).json({ error: "Failed to save data." });
    }

    const { error: deleteError } = await supabase
      .from("staffing_data")
      .delete()
      .not("id", "eq", inserted.id);
    if (deleteError) {
      console.error("[airtable] failed to prune older rows:", deleteError);
      return res.status(500).json({ error: "Failed to save data." });
    }

    console.log(
      `[airtable] data saved to Supabase id=${inserted.id} generatedAt=${payload.generatedAt} days=${payload.days.length}`,
    );
    return res.status(200).json({ ok: true });
  } catch (error) {
    console.error("[airtable] unexpected error while saving payload:", error);
    return res.status(500).json({ error: "Failed to save data." });
  }
});

app.post("/api/auth/login", async (req, res) => {
  const password = typeof req.body?.password === "string" ? req.body.password : "";
  if (!password) {
    return res.status(400).json({ error: "Password required." });
  }

  try {
    const { data, error } = await supabase.rpc("login_with_password", {
      payload: { password },
    });
    if (error) {
      console.error("[auth] login_with_password RPC failed:", error);
      return res.status(500).json({ error: "Login failed." });
    }

    const row = Array.isArray(data) ? data[0] : data;
    if (!row || typeof row.id !== "string") {
      return res.status(401).json({ error: "Incorrect password" });
    }

    return res.status(200).json({
      user: {
        id: row.id,
        username: row.username,
        colour: typeof row.colour === "string" ? row.colour : null,
        admin: Boolean(row.admin),
        canRoster: row.can_roster === true,
      },
    });
  } catch (error) {
    console.error("[auth] unexpected error:", error);
    return res.status(500).json({ error: "Login failed." });
  }
});

app.post("/api/webhooks/airtable/vehicle-cleaned", async (req, res) => {
  const { vehicleName, timestamp } = req.body;

  try {
    await fetch("https://hooks.airtable.com/workflows/v1/genericWebhook/apprkS2KIK9UVyF14/wfli6NJF5p9Kcu9Dk/wtr36Ftt2QXX3pBwl", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ vehicleName, timestamp }),
    });
    return res.json({ ok: true });
  } catch (error) {
    console.error("Webhook error:", error);
    return res.status(500).json({ error: error.message });
  }
});

const PORT = process.env.PORT || 3001;
app.listen(PORT, () => {
  console.log(`Server listening on http://localhost:${PORT}`);
});
