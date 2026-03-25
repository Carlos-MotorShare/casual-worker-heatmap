import express from "express";
import cors from "cors";
import { createClient } from "@supabase/supabase-js";
import "dotenv/config"; // loads .env into process.env

const app = express();

app.use(cors());
app.use(express.json({ limit: "2mb" }));

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseAnonKey = process.env.SUPABASE_ANON_KEY;

if (!supabaseUrl || !supabaseAnonKey) {
  console.error("[supabase] Missing SUPABASE_URL or SUPABASE_ANON_KEY environment variables.");
  process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseAnonKey);

/** @type {Set<import("express").Response>} */
const sseClients = new Set();

function sseSend(res, event, data) {
  if (event) res.write(`event: ${event}\n`);
  res.write(`data: ${JSON.stringify(data)}\n\n`);
}

function broadcast(event, data) {
  for (const res of sseClients) {
    try {
      sseSend(res, event, data);
    } catch {
      sseClients.delete(res);
    }
  }
}

/**
 * One day row as stored in `staffing_data.days` (JSONB) and sent to the client.
 * @typedef {{
 *   date: string,
 *   pickups: number,
 *   dropoffs: number,
 *   pickupsList: Array<{ id: string, time: string }>,
 *   dropoffsList: Array<{ id: string, time: string }>,
 *   carsToWash: number,
 *   staffAwayWeighted: number,
 *   staffAwayCount: number
 * }} StaffingDayEntry
 */

/**
 * Airtable webhook body: one snapshot with multiple days.
 * @typedef {{
 *   generatedAt: string,
 *   days: StaffingDayEntry[]
 * }} StaffingPayload
 */

/**
 * Client-facing shape (unchanged for existing frontend).
 * @typedef {{
 *   generatedAt: string | null,
 *   days: StaffingDayEntry[]
 * }} ClientStaffingPayload
 */

/**
 * @param {unknown} day
 * @returns {StaffingDayEntry}
 */
function normalizeDay(day) {
  if (!day || typeof day !== "object") {
    return {
      date: "",
      pickups: 0,
      dropoffs: 0,
      pickupsList: [],
      dropoffsList: [],
      carsToWash: 0,
      staffAwayWeighted: 0,
      staffAwayCount: 0,
    };
  }
  const d = /** @type {Record<string, unknown>} */ (day);
  const pickupsList = Array.isArray(d.pickupsList) ? d.pickupsList : [];
  const dropoffsList = Array.isArray(d.dropoffsList) ? d.dropoffsList : [];
  return {
    date: typeof d.date === "string" ? d.date : "",
    pickups: typeof d.pickups === "number" ? d.pickups : Number(d.pickups) || 0,
    dropoffs: typeof d.dropoffs === "number" ? d.dropoffs : Number(d.dropoffs) || 0,
    pickupsList: /** @type {StaffingDayEntry["pickupsList"]} */ (
      pickupsList.filter(
        (p) =>
          p &&
          typeof p === "object" &&
          typeof /** @type {{ id?: unknown }} */ (p).id === "string" &&
          typeof /** @type {{ time?: unknown }} */ (p).time === "string"
      )
    ),
    dropoffsList: /** @type {StaffingDayEntry["dropoffsList"]} */ (
      dropoffsList.filter(
        (x) =>
          x &&
          typeof x === "object" &&
          typeof /** @type {{ id?: unknown }} */ (x).id === "string" &&
          typeof /** @type {{ time?: unknown }} */ (x).time === "string"
      )
    ),
    carsToWash: typeof d.carsToWash === "number" ? d.carsToWash : Number(d.carsToWash) || 0,
    staffAwayWeighted:
      typeof d.staffAwayWeighted === "number"
        ? d.staffAwayWeighted
        : Number(d.staffAwayWeighted) || 0,
    staffAwayCount:
      typeof d.staffAwayCount === "number"
        ? d.staffAwayCount
        : Number(d.staffAwayCount) || 0,
  };
}

/**
 * Map a Supabase row to the JSON shape the frontend expects.
 * @param {{ generated_at?: string | null, days?: unknown } | null | undefined} row
 * @returns {ClientStaffingPayload}
 */
function rowToClientPayload(row) {
  if (!row) {
    return { generatedAt: null, days: [] };
  }
  const rawDays = row.days;
  const days = Array.isArray(rawDays) ? rawDays.map((d) => normalizeDay(d)) : [];
  const generatedAt =
    typeof row.generated_at === "string"
      ? row.generated_at
      : row.generated_at == null
        ? null
        : String(row.generated_at);
  return { generatedAt, days };
}

/**
 * @param {unknown} value
 * @returns {value is StaffingDayEntry}
 */
function isValidDayEntry(value) {
  if (!value || typeof value !== "object") {
    console.error("[validation] day is not an object:", value);
    return false;
  }
  const day = value;

  if (typeof day.date !== "string") {
    console.error("[validation] invalid day.date (expected string):", day.date);
    return false;
  }
  if (typeof day.pickups !== "number") {
    console.error("[validation] invalid day.pickups (expected number):", day.pickups);
    return false;
  }
  if (typeof day.dropoffs !== "number") {
    console.error("[validation] invalid day.dropoffs (expected number):", day.dropoffs);
    return false;
  }
  if (typeof day.carsToWash !== "number") {
    console.error("[validation] invalid day.carsToWash (expected number):", day.carsToWash);
    return false;
  }
  if (typeof day.staffAwayWeighted !== "number") {
    console.error(
      "[validation] invalid day.staffAwayWeighted (expected number):",
      day.staffAwayWeighted
    );
    return false;
  }
  if (typeof day.staffAwayCount !== "number") {
    console.error("[validation] invalid day.staffAwayCount (expected number):", day.staffAwayCount);
    return false;
  }
  if (!Array.isArray(day.pickupsList)) {
    console.error("[validation] invalid day.pickupsList (expected array):", day.pickupsList);
    return false;
  }
  if (!Array.isArray(day.dropoffsList)) {
    console.error("[validation] invalid day.dropoffsList (expected array):", day.dropoffsList);
    return false;
  }

  for (const [idx, p] of day.pickupsList.entries()) {
    if (!p || typeof p !== "object") {
      console.error(`[validation] invalid pickupsList[${idx}] (expected object):`, p);
      return false;
    }
    if (typeof p.id !== "string") {
      console.error(`[validation] invalid pickupsList[${idx}].id (expected string):`, p.id);
      return false;
    }
    if (typeof p.time !== "string") {
      console.error(`[validation] invalid pickupsList[${idx}].time (expected string):`, p.time);
      return false;
    }
  }
  for (const [idx, d] of day.dropoffsList.entries()) {
    if (!d || typeof d !== "object") {
      console.error(`[validation] invalid dropoffsList[${idx}] (expected object):`, d);
      return false;
    }
    if (typeof d.id !== "string") {
      console.error(`[validation] invalid dropoffsList[${idx}].id (expected string):`, d.id);
      return false;
    }
    if (typeof d.time !== "string") {
      console.error(`[validation] invalid dropoffsList[${idx}].time (expected string):`, d.time);
      return false;
    }
  }
  return true;
}

/**
 * Accept either:
 * 1) { generatedAt: string, days: StaffingDayEntry[] }
 * 2) one StaffingDayEntry object directly
 * 3) top-level StaffingDayEntry[] array
 * @param {unknown} value
 * @returns {StaffingPayload | null}
 */
function coerceIncomingPayload(value) {
  if (Array.isArray(value)) {
    for (const [idx, day] of value.entries()) {
      if (!isValidDayEntry(day)) {
        console.error(`[validation] top-level array invalid at index ${idx}.`);
        return null;
      }
    }
    return {
      generatedAt: new Date().toISOString(),
      days: value,
    };
  }

  if (!value || typeof value !== "object") return null;
  const obj = /** @type {Record<string, unknown>} */ (value);

  if (typeof obj.generatedAt === "string" && Array.isArray(obj.days)) {
    const days = obj.days;
    for (const [idx, day] of days.entries()) {
      if (!isValidDayEntry(day)) {
        console.error(`[validation] payload.days invalid at index ${idx}.`);
        return null;
      }
    }
    return {
      generatedAt: obj.generatedAt,
      days,
    };
  }

  if (isValidDayEntry(obj)) {
    return {
      generatedAt: new Date().toISOString(),
      days: [obj],
    };
  }

  console.error(
    "[validation] payload did not match any accepted format. Expected one of: {generatedAt, days[]}, day object, or day array."
  );
  return null;
}

app.post("/api/airtable", async (req, res) => {
  const payload = coerceIncomingPayload(req.body);
  const generatedAt = payload?.generatedAt ?? "(missing generatedAt)";
  const daysCount = Array.isArray(payload?.days) ? payload.days.length : 0;

  console.log(`[airtable] received payload generatedAt=${generatedAt} days=${daysCount}`);

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

    const clientPayload = rowToClientPayload(inserted);
    console.log(
      `[airtable] data saved to Supabase id=${inserted.id} generatedAt=${payload.generatedAt} days=${payload.days.length}`
    );
    broadcast("data", clientPayload);
    return res.status(200).json({ ok: true });
  } catch (error) {
    console.error("[airtable] unexpected error while saving payload:", error);
    return res.status(500).json({ error: "Failed to save data." });
  }
});

app.get("/api/data", async (_req, res) => {
  try {
    const { data, error } = await supabase
      .from("staffing_data")
      .select("generated_at, days")
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (error) {
      console.error("[data] failed to fetch latest payload from Supabase:", error);
      return res.status(500).json({ error: "Failed to fetch data." });
    }

    if (!data) {
      console.log("[data] no data found, returning empty payload.");
      return res.status(200).json({
        generatedAt: null,
        days: [],
      });
    }

    const responsePayload = rowToClientPayload(data);

    console.log(
      `[data] fetched latest payload generatedAt=${responsePayload.generatedAt} days=${responsePayload.days.length}`
    );
    return res.status(200).json(responsePayload);
  } catch (error) {
    console.error("[data] unexpected error while fetching payload:", error);
    return res.status(500).json({ error: "Failed to fetch data." });
  }
});

app.get("/api/stream", async (req, res) => {
  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");
  res.setHeader("X-Accel-Buffering", "no");

  // Send an initial event so clients know they’re connected.
  sseSend(res, "connected", { ok: true });
  try {
    const { data, error } = await supabase
      .from("staffing_data")
      .select("generated_at, days")
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (error) {
      console.error("[stream] failed to fetch latest payload for new client:", error);
    } else if (data) {
      sseSend(res, "data", rowToClientPayload(data));
    }
  } catch (error) {
    console.error("[stream] unexpected error while fetching latest payload for new client:", error);
  }

  // Flush headers immediately (helps some proxies/browsers).
  res.flushHeaders?.();

  sseClients.add(res);

  req.on("close", () => {
    sseClients.delete(res);
  });
});

const PORT = process.env.PORT || 3001;
app.listen(PORT, () => {
  console.log(`Server listening on http://localhost:${PORT}`);
});
