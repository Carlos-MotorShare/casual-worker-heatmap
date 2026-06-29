import express from "express";
import cors from "cors";
import { createClient } from "@supabase/supabase-js";
import "dotenv/config"; // loads .env into process.env
import {
  sendSlackNotification,
  slackMention,
  headerBlock,
  sectionBlock,
  contextBlock,
  dividerBlock,
} from "./slack.js";

const app = express();

app.use(cors());
app.use(express.json({ limit: "2mb" }));

/** Quick check that this process is the current API (use if /api/auth/login returns 404). */
app.get("/api/health", (_req, res) => {
  res.status(200).json({ ok: true });
});

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseAnonKey = process.env.SUPABASE_ANON_KEY;

if (!supabaseUrl || !supabaseAnonKey) {
  console.error("[supabase] Missing SUPABASE_URL or SUPABASE_ANON_KEY environment variables.");
  process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseAnonKey);

/** @type {Set<import("express").Response>} */
// const sseClients = new Set();

function sseSend(res, event, data) {
  if (event) res.write(`event: ${event}\n`);
  res.write(`data: ${JSON.stringify(data)}\n\n`);
}

// function broadcast(event, data) {
//   for (const res of sseClients) {
//     try {
//       sseSend(res, event, data);
//     } catch {
//       sseClients.delete(res);
//     }
//   }
// }

/**
 * One day row as stored in `staffing_data.days` (JSONB) and sent to the client.
 * @typedef {{
 *   date: string,
 *   pickups: number,
 *   dropoffs: number,
 *   pickupsList: Array<{ id: string, time: string, vehicle?: string }>,
 *   dropoffsList: Array<{ id: string, time: string, vehicle?: string }>,
 *   carsToWash: number,
 *   staffAwayWeighted: number,
 *   staffAwayCount: number,
 *   staffsAway?: Array<{ staffName: string, startDate: string, endDate: string, reason: string }>
 * }} StaffingDayEntry
 */

/**
 * Airtable webhook body: one snapshot with multiple days.
 * @typedef {{
 *   generatedAt: string,
 *   days: StaffingDayEntry[],
 *   staffsAway: Array<{ staffName: string, startDate: string, endDate: string, reason: string }>
 * }} StaffingPayload
 */

/**
 * Client-facing shape (unchanged for existing frontend).
 * @typedef {{
 *   generatedAt: string | null,
 *   days: StaffingDayEntry[],
 *   staffsAway: Array<{ staffName: string, startDate: string, endDate: string, reason: string }>
 * }} ClientStaffingPayload
 */

/**
 * @param {unknown} raw
 * @returns {{ id: string, time: string, vehicle?: string } | null}
 */
function normalizeTripListItem(raw) {
  if (!raw || typeof raw !== "object") return null;
  const o = /** @type {Record<string, unknown>} */ (raw);
  if (typeof o.id !== "string" || typeof o.time !== "string") return null;
  if (o.vehicle !== undefined && typeof o.vehicle !== "string") return null;
  /** @type {{ id: string, time: string, vehicle?: string }} */
  const row = { id: o.id, time: o.time };
  if (typeof o.vehicle === "string") {
    row.vehicle = o.vehicle;
  }
  return row;
}

/**
 * @param {unknown} arr
 * @returns {Array<{ id: string, time: string, vehicle?: string }>}
 */
function normalizeTripList(arr) {
  if (!Array.isArray(arr)) return [];
  const out = [];
  for (const item of arr) {
    const row = normalizeTripListItem(item);
    if (row) out.push(row);
  }
  return out;
}

/**
 * First finite numeric value among record keys (camelCase then snake_case).
 * Avoids `Number(x) || 0` swallowing 0 and supports Airtable/SQL `cars_to_wash` vs `carsToWash`.
 * @param {Record<string, unknown>} rec
 * @param {string[]} keys
 * @returns {number}
 */
function readDayNumeric(rec, keys) {
  for (const key of keys) {
    const v = rec[key];
    if (v === undefined || v === null || typeof v === "boolean") continue;
    if (typeof v === "number" && Number.isFinite(v)) return v;
    if (typeof v === "string" && v.trim() !== "") {
      const n = Number(v);
      if (Number.isFinite(n)) return n;
    }
  }
  return 0;
}

/**
 * True if at least one key exists on the record and holds a finite number (0 is valid).
 * @param {Record<string, unknown>} rec
 * @param {string[]} keys
 */
function hasReadableDayNumber(rec, keys) {
  for (const key of keys) {
    if (!Object.prototype.hasOwnProperty.call(rec, key)) continue;
    const v = rec[key];
    if (v === null || typeof v === "boolean") continue;
    if (typeof v === "number" && Number.isFinite(v)) return true;
    if (typeof v === "string" && v.trim() !== "") {
      const n = Number(v);
      if (Number.isFinite(n)) return true;
    }
  }
  return false;
}

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
      staffsAway: [],
    };
  }
  const d = /** @type {Record<string, unknown>} */ (day);
  const out = {
    date: typeof d.date === "string" ? d.date : "",
    pickups: readDayNumeric(d, ["pickups"]),
    dropoffs: readDayNumeric(d, ["dropoffs"]),
    pickupsList: normalizeTripList(d.pickupsList),
    dropoffsList: normalizeTripList(d.dropoffsList),
    /* Prefer snake_case when both exist (often the live DB field); camel alone still works. */
    carsToWash: readDayNumeric(d, ["cars_to_wash", "carsToWash"]),
    staffAwayWeighted: readDayNumeric(d, ["staff_away_weighted", "staffAwayWeighted"]),
    staffAwayCount: readDayNumeric(d, ["staff_away_count", "staffAwayCount"]),
    staffsAway: normalizeStaffsAway(
      d.staffsAway ?? d.staffs_away ?? d.staffsData ?? d.staffs_data,
    ),
  };
  
  // Preserve dirtyCars if present
  const dirtyCarsRaw = d.dirtyCars ?? d.dirty_cars;
  if (Array.isArray(dirtyCarsRaw)) {
    out.dirtyCars = dirtyCarsRaw.filter((car) => {
      if (!car || typeof car !== "object") return false;
      const c = /** @type {Record<string, unknown>} */ (car);
      return typeof c.vehicleName === "string" || typeof c.vehicle_name === "string";
    }).map((car) => {
      const c = /** @type {Record<string, unknown>} */ (car);
      return {
        vehicleName: typeof c.vehicleName === "string" ? c.vehicleName : String(c.vehicle_name ?? ""),
        nextPickupDateTime: typeof c.nextPickupDateTime === "string" ? c.nextPickupDateTime : (typeof c.next_pickup_date_time === "string" ? c.next_pickup_date_time : null),
      };
    });
  }
  
  return out;
}

/**
 * @param {unknown} raw
 * @returns {Array<{ staffName: string, startDate: string, endDate: string, reason: string }>}
 */
function normalizeStaffsAway(raw) {
  if (!Array.isArray(raw)) return [];
  const out = [];
  for (const item of raw) {
    if (!item || typeof item !== "object") continue;
    const o = /** @type {Record<string, unknown>} */ (item);
    const staffName =
      typeof o.staffName === "string"
        ? o.staffName
        : typeof o.staff_name === "string"
          ? o.staff_name
          : "";
    const startDate =
      typeof o.startDate === "string"
        ? o.startDate
        : typeof o.start_date === "string"
          ? o.start_date
          : "";
    const endDate =
      typeof o.endDate === "string"
        ? o.endDate
        : typeof o.end_date === "string"
          ? o.end_date
          : "";
    const reason = typeof o.reason === "string" ? o.reason : "";
    if (!staffName || !startDate || !endDate) continue;
    out.push({ staffName, startDate, endDate, reason });
  }
  return out;
}

/**
 * Map a Supabase row to the JSON shape the frontend expects.
 * @param {{ generated_at?: string | null, days?: unknown, staffsAway?: unknown, staffs_data?: unknown, staffsData?: unknown } | null | undefined} row
 * @returns {ClientStaffingPayload}
 */
function rowToClientPayload(row) {
  if (!row) {
    return { generatedAt: null, days: [], staffsAway: [] };
  }
  const r = /** @type {Record<string, unknown>} */ (row);
  const rawDays = r.days;
  const days = Array.isArray(rawDays) ? rawDays.map((d) => normalizeDay(d)) : [];
  const generatedAt =
    typeof r.generated_at === "string"
      ? r.generated_at
      : r.generated_at == null
        ? null
        : String(r.generated_at);

  // Try top-level staffs_away first, then fall back to aggregating from per-day data
  const staffsAwayRaw = r.staffs_away ?? r.staffsAway ?? r.staffs_data ?? r.staffsData;
  let staffsAway = normalizeStaffsAway(staffsAwayRaw);

  // If no top-level staffsAway, flatten from each day's staffsAway array
  if (staffsAway.length === 0) {
    const nested = days.flatMap((d) =>
      Array.isArray(d.staffsAway) ? d.staffsAway : []
    );
    staffsAway = normalizeStaffsAway(nested);
  }

  return { generatedAt, days, staffsAway };
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
  const day = /** @type {Record<string, unknown>} */ (value);

  if (typeof day.date !== "string") {
    console.error("[validation] invalid day.date (expected string):", day.date);
    return false;
  }
  if (!hasReadableDayNumber(day, ["pickups"])) {
    console.error("[validation] invalid day.pickups (expected finite number):", day.pickups);
    return false;
  }
  if (!hasReadableDayNumber(day, ["dropoffs"])) {
    console.error("[validation] invalid day.dropoffs (expected finite number):", day.dropoffs);
    return false;
  }
  if (!hasReadableDayNumber(day, ["carsToWash", "cars_to_wash"])) {
    console.error(
      "[validation] invalid day.carsToWash / cars_to_wash (expected finite number):",
      day.carsToWash,
      day.cars_to_wash
    );
    return false;
  }
  if (!hasReadableDayNumber(day, ["staffAwayWeighted", "staff_away_weighted"])) {
    console.error(
      "[validation] invalid day.staffAwayWeighted (expected finite number):",
      day.staffAwayWeighted
    );
    return false;
  }
  if (!hasReadableDayNumber(day, ["staffAwayCount", "staff_away_count"])) {
    console.error(
      "[validation] invalid day.staffAwayCount (expected finite number):",
      day.staffAwayCount
    );
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
    if (p.vehicle !== undefined && typeof p.vehicle !== "string") {
      console.error(`[validation] invalid pickupsList[${idx}].vehicle (expected string):`, p.vehicle);
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
    if (d.vehicle !== undefined && typeof d.vehicle !== "string") {
      console.error(`[validation] invalid dropoffsList[${idx}].vehicle (expected string):`, d.vehicle);
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
      staffsAway: [],
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
    const staffsAway = normalizeStaffsAway(
      obj.staffsAway ?? obj.staffs_away ?? obj.staffsData ?? obj.staffs_data,
    );
    return {
      generatedAt: obj.generatedAt,
      days,
      staffsAway,
    };
  }

  if (isValidDayEntry(obj)) {
    return {
      generatedAt: new Date().toISOString(),
      days: [obj],
      staffsAway: [],
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
  if (payload?.days?.[0]) {
    const firstDay = /** @type {Record<string, unknown>} */ (payload.days[0]);
    console.log(`[airtable] days[0] keys:`, Object.keys(firstDay));
    console.log(`[airtable] days[0] dirtyCars:`, firstDay.dirtyCars);
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

    const clientPayload = rowToClientPayload(inserted);
    console.log(
      `[airtable] data saved to Supabase id=${inserted.id} generatedAt=${payload.generatedAt} days=${payload.days.length}`
    );
    //broadcast("data", clientPayload);
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
      .select("*")
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
        staffsAway: [],
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

function isIsoDateString(value) {
  return typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value);
}

/** Civil date YYYY-MM-DD → Sat/Sun in UTC (matches roster `date` weekday). */
function isWeekendIso(iso) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
  if (!m) return false;
  const y = Number(m[1]);
  const mo = Number(m[2]);
  const d = Number(m[3]);
  const day = new Date(Date.UTC(y, mo - 1, d)).getUTCDay();
  return day === 0 || day === 6;
}

/**
 * @param {string} userId
 * @returns {Promise<{ admin: boolean, canRoster: boolean } | null>}
 */
async function getUserFlags(userId) {
  const { data, error } = await supabase.rpc("get_user_flags", { p_user_id: userId });
  if (error) {
    console.error("[users] get_user_flags failed:", error);
    return null;
  }
  const row = Array.isArray(data) ? data[0] : data;
  if (!row || typeof row !== "object") return null;
  const o = /** @type {Record<string, unknown>} */ (row);
  return {
    admin: o.admin === true,
    canRoster: o.can_roster === true,
  };
}

/**
 * @param {unknown} t
 * @returns {string}
 */
function normalizePgTimeString(t) {
  if (typeof t === "string") {
    const m = t.match(/^(\d{2}):(\d{2}):(\d{2})/);
    if (m) return `${m[1]}:${m[2]}:${m[3]}`;
  }
  return String(t);
}

/**
 * Normalize Supabase date/date-like values to YYYY-MM-DD for frontend keying.
 * @param {unknown} value
 * @returns {string}
 */
function normalizePgDateString(value) {
  if (typeof value === "string") {
    const m = value.match(/^(\d{4}-\d{2}-\d{2})/);
    if (m) return m[1];
  }
  return String(value);
}

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
  } catch (e) {
    console.error("[auth] unexpected error:", e);
    return res.status(500).json({ error: "Login failed." });
  }
});

app.get("/api/worker-users", async (_req, res) => {
  try {
    const { data, error } = await supabase.rpc("list_worker_users");
    if (error) {
      console.error("[worker-users] rpc failed:", error);
      return res.status(500).json({ error: "Failed to load workers." });
    }
    const list = Array.isArray(data) ? data : [];
    const rows = list.map((r) => ({
      id: typeof r.id === "string" ? r.id : "",
      username: typeof r.username === "string" ? r.username : "",
      colour: typeof r.colour === "string" ? r.colour : null,
    }));
    return res.status(200).json({ rows });
  } catch (e) {
    console.error("[worker-users] unexpected error:", e);
    return res.status(500).json({ error: "Failed to load workers." });
  }
});

app.get("/api/admin-users", async (req, res) => {
  try {
    const excludeUserId = typeof req.query.exclude === "string" ? req.query.exclude : null;
    const { data, error } = await supabase.rpc("list_admin_users", {
      exclude_user_id: excludeUserId ? excludeUserId : null,
    });
    if (error) {
      console.error("[admin-users] rpc failed:", error);
      return res.status(500).json({ error: "Failed to load admins." });
    }
    const list = Array.isArray(data) ? data : [];
    const rows = list.map((r) => ({
      id: typeof r.id === "string" ? r.id : "",
      username: typeof r.username === "string" ? r.username : "",
      colour: typeof r.colour === "string" ? r.colour : null,
    }));
    return res.status(200).json({ rows });
  } catch (e) {
    console.error("[admin-users] unexpected error:", e);
    return res.status(500).json({ error: "Failed to load admins." });
  }
});

app.get("/api/staff-colours", async (_req, res) => {
  try {
    const { data, error } = await supabase.rpc("staff_colours");
    if (error) {
      console.error("[staff-colours] rpc failed:", error);
      return res.status(500).json({ error: "Failed to load staff colours." });
    }
    const list = Array.isArray(data) ? data : [];
    const rows = list.map((r) => ({
      username: typeof r.username === "string" ? r.username : "",
      colour: typeof r.colour === "string" ? r.colour : null,
    }));
    return res.status(200).json({ rows });
  } catch (e) {
    console.error("[staff-colours] unexpected error:", e);
    return res.status(500).json({ error: "Failed to load staff colours." });
  }
});

app.get("/api/rosters", async (req, res) => {
  const start = req.query.start;
  const end = req.query.end;
  if (!isIsoDateString(start) || !isIsoDateString(end)) {
    return res.status(400).json({ error: "Query start and end are required (YYYY-MM-DD)." });
  }
  try {
    const { data, error } = await supabase.rpc("rosters_for_range", {
      payload: { start, end },
    });
    if (error) {
      console.error("[rosters] rosters_for_range RPC failed:", error);
      if (error.code === "PGRST202") {
        console.error(
          "[rosters] Hint: run supabase/migrations/20260326160000_rosters_for_range_ensure.sql in the Supabase SQL editor, then wait ~30s or redeploy.",
        );
      }
      return res.status(500).json({ error: "Failed to fetch rosters." });
    }
    const list = Array.isArray(data) ? data : [];
    const rows = list.map((r) => ({
      blockId: r.block_id,
      rosterId: r.roster_id,
      userId: r.user_id,
      date: normalizePgDateString(r.roster_date),
      username: r.username,
      colour: typeof r.colour === "string" ? r.colour : r.colour ?? null,
      rosterUserIsAdmin: r.roster_user_admin === true,
      startTime: normalizePgTimeString(r.start_time),
      endTime: normalizePgTimeString(r.end_time),
    }));
    return res.status(200).json({ rows });
  } catch (e) {
    console.error("[rosters] unexpected error:", e);
    return res.status(500).json({ error: "Failed to fetch rosters." });
  }
});

app.post("/api/rosters", async (req, res) => {
  const body = req.body && typeof req.body === "object" ? req.body : {};
  const userId = typeof body.userId === "string" ? body.userId : "";
  const date = typeof body.date === "string" ? body.date : "";
  const actorUserId =
    typeof body.actorUserId === "string" && body.actorUserId.trim() ? body.actorUserId.trim() : userId;
  const blocks = /** @type {unknown} */ (body.blocks ?? []);

  if (!userId || !isIsoDateString(date)) {
    return res.status(400).json({ error: "Valid userId and date (YYYY-MM-DD) are required." });
  }
  if (!Array.isArray(blocks) || blocks.length === 0) {
    return res.status(400).json({ error: "blocks must be a non-empty array." });
  }

  const normalized = [];
  for (const b of blocks) {
    if (!b || typeof b !== "object") {
      return res.status(400).json({ error: "Invalid block." });
    }
    const startTime = /** @type {{ startTime?: unknown }} */ (b).startTime;
    const endTime = /** @type {{ endTime?: unknown }} */ (b).endTime;
    if (typeof startTime !== "string" || typeof endTime !== "string") {
      return res.status(400).json({ error: "Each block needs startTime and endTime (HH:MM:SS)." });
    }
    normalized.push({ startTime, endTime });
  }

  try {
    const [actorFlags, targetFlags] = await Promise.all([
      getUserFlags(actorUserId),
      getUserFlags(userId),
    ]);
    if (!actorFlags || !targetFlags) {
      return res.status(403).json({ error: "Could not verify permissions." });
    }

    const self = actorUserId === userId;

    if (!self) {
      if (!actorFlags.canRoster) {
        return res.status(403).json({ error: "You cannot assign rosters for other users." });
      }
    }
    // Any user (admin or non-admin) may self-roster on any day.
    // canRoster users may assign others on any day (weekday, weekend, or public holiday).
    const { error: deleteError } = await supabase
      .from("rosters")
      .delete()
      .eq("user_id", userId)
      .eq("date", date);

    if (deleteError) {
      console.error("[rosters] delete roster failed:", deleteError);
      return res.status(500).json({ error: "Failed to save roster." });
    }

    const { data: rosterRow, error: rosterInsertError } = await supabase
      .from("rosters")
      .insert({ user_id: userId, date })
      .select("id")
      .single();

    if (rosterInsertError || !rosterRow?.id) {
      console.error("[rosters] insert roster failed:", rosterInsertError);
      return res.status(500).json({ error: "Failed to save roster." });
    }

    const rosterId = rosterRow.id;
    const blockRows = normalized.map((b) => ({
      roster_id: rosterId,
      start_time: b.startTime,
      end_time: b.endTime,
    }));

    const { error: blocksError } = await supabase.from("roster_blocks").insert(blockRows);

    if (blocksError) {
      console.error("[rosters] insert roster_blocks failed:", blocksError);
      await supabase.from("rosters").delete().eq("id", rosterId);
      return res.status(500).json({ error: "Failed to save roster." });
    }

    return res.status(200).json({ ok: true, rosterId });
  } catch (e) {
    console.error("[rosters] unexpected error:", e);
    return res.status(500).json({ error: "Failed to save roster." });
  }
});

app.post("/api/rosters/delete-block", async (req, res) => {
  const body = req.body && typeof req.body === "object" ? req.body : {};
  const blockId = typeof body.blockId === "string" ? body.blockId : "";
  const actorUserId = typeof body.actorUserId === "string" ? body.actorUserId : "";
  if (!blockId || !actorUserId) {
    return res.status(400).json({ error: "blockId and actorUserId are required." });
  }
  try {
    const { data, error } = await supabase.rpc("delete_roster_block", {
      payload: { blockId, actorUserId },
    });
    if (error) {
      console.error("[rosters] delete_roster_block RPC failed:", error);
      return res.status(500).json({ error: "Failed to delete block." });
    }
    const result = data && typeof data === "object" ? /** @type {Record<string, unknown>} */ (data) : {};
    if (result.ok !== true) {
      const err = typeof result.error === "string" ? result.error : "";
      if (err === "not_found") {
        return res.status(404).json({ error: "That shift block was not found." });
      }
      if (err === "forbidden") {
        return res.status(403).json({ error: "You cannot remove this shift." });
      }
      return res.status(400).json({ error: "Could not delete this block." });
    }
    return res.status(200).json({ ok: true });
  } catch (e) {
    console.error("[rosters] delete-block unexpected error:", e);
    return res.status(500).json({ error: "Failed to delete block." });
  }
});

app.post('/api/webhooks/airtable/vehicle-cleaned', async (req, res) => {
  const { vehicleName, timestamp } = req.body
  
  // Forward to Airtable webhook URL
  try {
    await fetch('https://hooks.airtable.com/workflows/v1/genericWebhook/apprkS2KIK9UVyF14/wfli6NJF5p9Kcu9Dk/wtr36Ftt2QXX3pBwl', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ vehicleName, timestamp })
    })
    res.json({ ok: true })
  } catch (err) {
    console.error('Webhook error:', err)
    res.status(500).json({ error: err.message })
  }
})

// app.get("/api/stream", async (req, res) => {
//   res.setHeader("Content-Type", "text/event-stream");
//   res.setHeader("Cache-Control", "no-cache");
//   res.setHeader("Connection", "keep-alive");
//   res.setHeader("X-Accel-Buffering", "no");

//   // Send an initial event so clients know they’re connected.
//   sseSend(res, "connected", { ok: true });
//   try {
//     const { data, error } = await supabase
//       .from("staffing_data")
//       .select("*")
//       .order("created_at", { ascending: false })
//       .limit(1)
//       .maybeSingle();

//     if (error) {
//       console.error("[stream] failed to fetch latest payload for new client:", error);
//     } else if (data) {
//       sseSend(res, "data", rowToClientPayload(data));
//     }
//   } catch (error) {
//     console.error("[stream] unexpected error while fetching latest payload for new client:", error);
//   }

//   // Flush headers immediately (helps some proxies/browsers).
//   res.flushHeaders?.();

//   sseClients.add(res);

//   req.on("close", () => {
//     sseClients.delete(res);
//   });
// });

app.get("/api/stream", (_req, res) => {
  return res.status(410).json({
    error: "SSE endpoint deprecated. Use /api/data instead.",
  });
});

// ── Weekend roster Slack notifications ──────────────────────────────────────

const NZ_TZ = "Pacific/Auckland";

/**
 * Returns the next Saturday and Sunday ISO dates relative to a Friday in NZ time.
 * @param {Date} fridayNz - a Date whose local time is already in NZ context
 * @returns {{ satIso: string, sunIso: string }}
 */
function nextWeekendDates(fridayNz) {
  const toIso = (/** @type {Date} */ d) => d.toISOString().slice(0, 10);
  const sat = new Date(Date.UTC(fridayNz.getFullYear(), fridayNz.getMonth(), fridayNz.getDate() + 1));
  const sun = new Date(Date.UTC(fridayNz.getFullYear(), fridayNz.getMonth(), fridayNz.getDate() + 2));
  return { satIso: toIso(sat), sunIso: toIso(sun) };
}

/**
 * Fetch staffing data for specific dates from the latest Supabase snapshot.
 * @param {string[]} dates - YYYY-MM-DD
 * @returns {Promise<Map<string, import('./index.js').StaffingDayEntry>>}
 */
async function fetchStaffingDays(dates) {
  const { data, error } = await supabase
    .from("staffing_data")
    .select("days")
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error || !data) return new Map();

  const all = Array.isArray(data.days) ? data.days.map((d) => normalizeDay(d)) : [];
  const dateSet = new Set(dates);
  return new Map(all.filter((d) => dateSet.has(d.date)).map((d) => [d.date, d]));
}

/**
 * Fetch roster rows for a date range.
 * @param {string} start
 * @param {string} end
 */
async function fetchRostersForDates(start, end) {
  const { data, error } = await supabase.rpc("rosters_for_range", {
    payload: { start, end },
  });
  if (error || !Array.isArray(data)) return [];
  return data.map((r) => ({
    userId: r.user_id,
    date: normalizePgDateString(r.roster_date),
    username: r.username,
    startTime: normalizePgTimeString(r.start_time),
    endTime: normalizePgTimeString(r.end_time),
    isAdmin: r.roster_user_admin === true,
  }));
}

const EXTRA_HANDS_SLOTS = [
  { name: "Morning", min: 8, max: 12 },
  { name: "Afternoon", min: 12, max: 17 },
  { name: "Evening", min: 17, max: 21 },
];

/**
 * JS port of the frontend computeExtraHandsRequired.
 * Returns null for no extra hands needed, or { slot, reason } when needed.
 * @param {Array<{time: string}>} pickupsList
 * @param {Array<{time: string}>} dropoffsList
 * @returns {{ slot: string, reason: string } | null}
 */
function computeExtraHandsRequired(pickupsList, dropoffsList) {
  const getHour = (t) => parseInt(t.split(":")[0], 10);

  const pickupsByHour = new Map();
  for (const p of pickupsList) {
    const h = getHour(p.time);
    if (Number.isFinite(h)) pickupsByHour.set(h, (pickupsByHour.get(h) ?? 0) + 1);
  }

  const dropoffsByHour = new Map();
  for (const d of dropoffsList) {
    const h = getHour(d.time);
    if (Number.isFinite(h)) dropoffsByHour.set(h, (dropoffsByHour.get(h) ?? 0) + 1);
  }

  const needed = new Map(); // slot name → reason string

  for (const [h, count] of pickupsByHour) {
    if (count >= 3) {
      const slot = EXTRA_HANDS_SLOTS.find((s) => h >= s.min && h < s.max);
      if (slot && !needed.has(slot.name)) {
        needed.set(slot.name, `${count} pickups in the same hour`);
      }
    }
  }

  for (const [h, dCount] of dropoffsByHour) {
    const pCount = pickupsByHour.get(h) ?? 0;
    if (dCount >= 2 && pCount >= 1) {
      const slot = EXTRA_HANDS_SLOTS.find((s) => h >= s.min && h < s.max);
      if (slot && !needed.has(slot.name)) {
        needed.set(slot.name, `${dCount} dropoffs overlapping with ${pCount} pickup${pCount > 1 ? "s" : ""}`);
      }
    }
  }

  // Range: pickups across all three windows
  const coveredSlots = EXTRA_HANDS_SLOTS.filter((s) =>
    [...pickupsByHour.entries()].some(([h, c]) => c > 0 && h >= s.min && h < s.max),
  );
  if (coveredSlots.length === 3) {
    for (const s of EXTRA_HANDS_SLOTS) {
      if (!needed.has(s.name)) needed.set(s.name, "pickups span the full day");
    }
  }

  if (needed.size === 0) return null;

  for (const slot of EXTRA_HANDS_SLOTS) {
    if (needed.has(slot.name)) return { slot: slot.name, reason: needed.get(slot.name) };
  }
  return null;
}

/**
 * Build a one-line plain-English brief for a day's workload.
 * @param {{ pickups: number, dropoffs: number, carsToWash: number }} day
 */
function buildDayBrief(day) {
  const parts = [];
  if (day.pickups > 0) parts.push(`${day.pickups} pickup${day.pickups > 1 ? "s" : ""}`);
  if (day.dropoffs > 0) parts.push(`${day.dropoffs} dropoff${day.dropoffs > 1 ? "s" : ""}`);
  if (day.carsToWash > 0) parts.push(`${day.carsToWash} car${day.carsToWash > 1 ? "s" : ""} to wash`);
  if (parts.length === 0) return "Quiet day — no scheduled pickups or dropoffs.";

  let brief = parts.join(", ");
  if (day.carsToWash >= 5) brief += " — plenty of washing ahead";
  else if (day.pickups >= 5) brief += " — busy pickup day";
  else if (day.pickups === 0 && day.carsToWash > 0) brief += " — washing only";
  return brief;
}

/** @param {string} iso */
function formatDayLabel(iso) {
  const d = new Date(`${iso}T12:00:00Z`);
  return d.toLocaleDateString("en-NZ", { weekday: "long", day: "numeric", month: "short", timeZone: "UTC" });
}

/** Format HH:MM:SS → "8am" style */
function formatTime(t) {
  const h = parseInt(t.split(":")[0], 10);
  return h === 0 ? "12am" : h < 12 ? `${h}am` : h === 12 ? "12pm" : `${h - 12}pm`;
}

async function runWeekendRosterNotification() {
  console.log("[cron] Running weekend roster notification...");

  // Derive next Saturday/Sunday from current NZ date
  const nzDateStr = new Date().toLocaleDateString("en-CA", { timeZone: NZ_TZ }); // YYYY-MM-DD
  const [y, m, d] = nzDateStr.split("-").map(Number);
  const fridayNz = new Date(Date.UTC(y, m - 1, d));
  const { satIso, sunIso } = nextWeekendDates(fridayNz);

  const [staffingDays, rosterRows] = await Promise.all([
    fetchStaffingDays([satIso, sunIso]),
    fetchRostersForDates(satIso, sunIso),
  ]);

  const rosterBySat = rosterRows.filter((r) => r.date === satIso && r.isAdmin);
  const rosterBySun = rosterRows.filter((r) => r.date === sunIso && r.isAdmin);
  const satWorkers = [...new Map(rosterBySat.map((r) => [r.userId, r])).values()];
  const sunWorkers = [...new Map(rosterBySun.map((r) => [r.userId, r])).values()];

  const satDay = staffingDays.get(satIso);
  const sunDay = staffingDays.get(sunIso);

  const satLabel = formatDayLabel(satIso);
  const sunLabel = formatDayLabel(sunIso);

  // ── AUTO notification ──────────────────────────────────────────────────────

  const noOneSat = satWorkers.length === 0;
  const noOneSun = sunWorkers.length === 0;

  if (noOneSat && noOneSun) {
    await sendSlackNotification("auto", {
      text: `⚠️ No one is rostered for this weekend (${satLabel} & ${sunLabel}).`,
      blocks: [
        headerBlock("⚠️ Weekend Roster Warning"),
        sectionBlock(`No workers have been assigned for the upcoming weekend.\n\n*${satLabel}* — unassigned\n*${sunLabel}* — unassigned`),
        dividerBlock,
        contextBlock(["Please assign workers as soon as possible."]),
      ],
    });
  } else {
    const buildDaySummary = (label, workers, day) => {
      const workerList = workers.length > 0
        ? workers.map((w) => `• ${slackMention(w.username)} (${formatTime(w.startTime)}–${formatTime(w.endTime)})`).join("\n")
        : "_No one assigned_";
      const brief = day ? buildDayBrief(day) : "No staffing data available.";
      return `*${label}*\n${workerList}\n_${brief}_`;
    };

    const satSummary = buildDaySummary(satLabel, satWorkers, satDay);
    const sunSummary = buildDaySummary(sunLabel, sunWorkers, sunDay);

    const warningLines = [];
    if (noOneSat) warningLines.push(`⚠️ No one assigned for ${satLabel}`);
    if (noOneSun) warningLines.push(`⚠️ No one assigned for ${sunLabel}`);

    const blocks = [
      headerBlock("📅 Weekend Roster Summary"),
      sectionBlock(satSummary),
      dividerBlock,
      sectionBlock(sunSummary),
    ];

    if (warningLines.length > 0) {
      blocks.push(dividerBlock);
      blocks.push(sectionBlock(warningLines.join("\n")));
    }

    await sendSlackNotification("auto", {
      text: `Weekend roster for ${satLabel} & ${sunLabel}`,
      blocks,
    });
  }

  // ── ALERT notification — extra hands ──────────────────────────────────────

  const alertDays = [
    { iso: satIso, label: satLabel, day: satDay },
    { iso: sunIso, label: sunLabel, day: sunDay },
  ];

  for (const { label, day } of alertDays) {
    if (!day) continue;
    const extraHands = computeExtraHandsRequired(
      day.pickupsList ?? [],
      day.dropoffsList ?? [],
    );
    if (!extraHands) continue;

    const rosterForDay = rosterRows.filter((r) => r.date === day.date && r.isAdmin);
    const workerNames = [...new Map(rosterForDay.map((r) => [r.userId, r])).values()]
      .map((w) => slackMention(w.username));
    const rosterLine = workerNames.length > 0
      ? workerNames.join(", ")
      : "_No one assigned yet_";

    await sendSlackNotification("alert", {
      text: `Extra hands recommended on ${label} (${extraHands.slot})`,
      blocks: [
        headerBlock(`Extra Hands Recommended — ${label}`),
        sectionBlock(
          `*Recommended slot:* ${extraHands.slot}\n` +
          `*Reason:* ${extraHands.reason}\n` +
          `*Current roster:* ${rosterLine}`,
        ),
        dividerBlock,
        contextBlock([
          `${day.pickups} pickup${day.pickups !== 1 ? "s" : ""} · ` +
          `${day.dropoffs} dropoff${day.dropoffs !== 1 ? "s" : ""} · ` +
          `${day.carsToWash ?? 0} car${day.carsToWash !== 1 ? "s" : ""} to wash`,
        ]),
      ],
    });
  }

  console.log("[cron] Weekend roster notification complete.");
}

/** Verify Vercel cron secret so only Vercel can invoke these endpoints. */
function verifyCronSecret(req, res) {
  const secret = process.env.CRON_SECRET;
  if (secret && req.headers.authorization !== `Bearer ${secret}`) {
    res.status(401).json({ error: "Unauthorized" });
    return false;
  }
  return true;
}

// Vercel cron: every Friday at 1am UTC = 1pm NZST
// vercel.json schedule: "0 1 * * 5"
app.get("/api/cron/weekend-roster", async (req, res) => {
  if (!verifyCronSecret(req, res)) return;
  console.log("[cron] weekend-roster triggered:", new Date().toISOString());
  try {
    await runWeekendRosterNotification();
    return res.status(200).json({ ok: true });
  } catch (err) {
    console.error("[cron] weekend-roster failed:", err);
    return res.status(500).json({ error: "Cron job failed." });
  }
});

// ── Quick turnaround Slack notifications ─────────────────────────────────────
//
// "Quick turnaround" = a dropoff today whose vehicle has another booking
// starting within 24h (`nextBookingWithin24h: true` on the dropoffsList item).
// These come straight from the raw Airtable/Supabase payload, so this reads
// the un-normalized day object rather than going through normalizeDay() —
// normalizeDay/normalizeTripList intentionally strip unlisted fields and feed
// the client-facing /api/data shape, which we don't want to change here.

/**
 * Fetch the raw (un-normalized) day object for a given ISO date from the
 * latest staffing_data snapshot.
 * @param {string} dateIso - YYYY-MM-DD
 * @returns {Promise<Record<string, unknown> | null>}
 */
async function fetchRawStaffingDay(dateIso) {
  const { data, error } = await supabase
    .from("staffing_data")
    .select("days")
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error || !data || !Array.isArray(data.days)) return null;

  const match = data.days.find(
    (d) => d && typeof d === "object" && /** @type {Record<string, unknown>} */ (d).date === dateIso,
  );
  return match ? /** @type {Record<string, unknown>} */ (match) : null;
}

/**
 * @typedef {{ id: string, time: string, vehicle: string, nextPickupDateTime: string | null }} QuickTurnaroundItem
 */

/**
 * @param {Record<string, unknown> | null} rawDay
 * @returns {QuickTurnaroundItem[]}
 */
function findQuickTurnarounds(rawDay) {
  const dropoffsList =
    rawDay && Array.isArray(rawDay.dropoffsList) ? rawDay.dropoffsList : [];
  /** @type {QuickTurnaroundItem[]} */
  const out = [];
  for (const item of dropoffsList) {
    if (!item || typeof item !== "object") continue;
    const o = /** @type {Record<string, unknown>} */ (item);
    if (o.nextBookingWithin24h !== true) continue;
    out.push({
      id: typeof o.id === "string" ? o.id : String(o.id ?? ""),
      time: typeof o.time === "string" ? o.time : "",
      vehicle: typeof o.vehicle === "string" ? o.vehicle : "Unknown vehicle",
      nextPickupDateTime: typeof o.nextPickupDateTime === "string" ? o.nextPickupDateTime : null,
    });
  }
  return out;
}

/**
 * Format an ISO datetime string's clock value directly (e.g. "1:30 PM"). Returns null on bad input.
 *
 * Airtable sends these timestamps with a trailing "Z" but the hour/minute is already the
 * intended NZ wall-clock time (not true UTC) — so we read the UTC components as-is rather
 * than applying a timezone conversion, which would double-shift the hour.
 * @param {string | null} iso
 * @returns {string | null}
 */
function formatNzTimeFromIso(iso) {
  if (!iso) return null;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  const hours = d.getUTCHours();
  const minutes = d.getUTCMinutes();
  const period = hours >= 12 ? "PM" : "AM";
  const displayHour = hours % 12 === 0 ? 12 : hours % 12;
  return `${displayHour}:${String(minutes).padStart(2, "0")} ${period}`;
}

/**
 * @param {string} dateLabel
 * @param {QuickTurnaroundItem[]} items
 */
function buildQuickTurnaroundBlocks(dateLabel, items) {
  const lines = items.map((item) => {
    const nextPickup = formatNzTimeFromIso(item.nextPickupDateTime);
    const nextPickupText = nextPickup ? `next pickup ${nextPickup}` : "next pickup time unknown";
    return `• *${item.vehicle}* — dropping off ${item.time || "time unknown"}, ${nextPickupText}`;
  });

  return [
    headerBlock("🔄 Quick Turnarounds Today"),
    sectionBlock(
      `*${dateLabel}* — ${items.length} vehicle${items.length > 1 ? "s" : ""} ` +
        `need${items.length === 1 ? "s" : ""} turning around within 24h:\n\n${lines.join("\n")}`,
    ),
    dividerBlock,
    contextBlock(["Make sure these are cleaned and ready before the next pickup."]),
  ];
}

async function runQuickTurnaroundNotification() {
  console.log("[cron] Running quick turnaround notification...");

  const todayIso = new Date().toLocaleDateString("en-CA", { timeZone: NZ_TZ }); // YYYY-MM-DD
  const rawDay = await fetchRawStaffingDay(todayIso);
  const items = findQuickTurnarounds(rawDay);

  if (items.length === 0) {
    console.log(`[cron] No quick turnarounds for ${todayIso}. Skipping notification.`);
    return;
  }

  const dateLabel = formatDayLabel(todayIso);
  await sendSlackNotification("alert", {
    text: `🔄 ${items.length} quick turnaround${items.length > 1 ? "s" : ""} today (${dateLabel})`,
    blocks: buildQuickTurnaroundBlocks(dateLabel, items),
  });

  console.log("[cron] Quick turnaround notification complete.");
}

// Vercel cron: every day at 7pm UTC = 7am NZST
// vercel.json schedule: "0 19 * * *"
app.get("/api/cron/quick-turnaround", async (req, res) => {
  if (!verifyCronSecret(req, res)) return;
  console.log("[cron] quick-turnaround triggered:", new Date().toISOString());
  try {
    await runQuickTurnaroundNotification();
    return res.status(200).json({ ok: true });
  } catch (err) {
    console.error("[cron] quick-turnaround failed:", err);
    return res.status(500).json({ error: "Cron job failed." });
  }
});

// ── Server start ─────────────────────────────────────────────────────────────

const PORT = process.env.PORT || 3001;
app.listen(PORT, () => {
  console.log(`Server listening on http://localhost:${PORT}`);
});
