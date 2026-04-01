import express from "express";
import cors from "cors";
import { createClient } from "@supabase/supabase-js";
import "dotenv/config"; // loads .env into process.env

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
 * @param {{ generated_at?: string | null, days?: unknown, staffs_away?: unknown, staffsAway?: unknown, staffs_data?: unknown, staffsData?: unknown } | null | undefined} row
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
  const staffsAwayRaw = r.staffs_away ?? r.staffsAway ?? r.staffs_data ?? r.staffsData;
  const staffsAway = normalizeStaffsAway(staffsAwayRaw);
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
        staffs_away: payload.staffsAway ?? [],
      })
      .select("id, generated_at, days, staffs_away")
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

    const weekend = isWeekendIso(date);
    const self = actorUserId === userId;

    if (!self) {
      if (!actorFlags.canRoster) {
        return res.status(403).json({ error: "You cannot assign rosters for other users." });
      }
      if (!weekend) {
        return res.status(403).json({ error: "You can only assign weekend shifts for others." });
      }
    } else if (targetFlags.admin) {
      if (!weekend) {
        return res.status(403).json({ error: "Admins can only self-roster on weekends." });
      }
    }
    // Non-admin users may self-roster on any day (weekday or weekend).
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
      .select("*")
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
