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
 *   staffsAway?: Array<{ staffName: string, startDate: string, endDate: string, reason: string }>,
 *   fleetNextBookings?: Array<{ vehicleName: string, nextPickupDateTime: string | null }>
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
  const object = /** @type {Record<string, unknown>} */ (raw);
  if (typeof object.id !== "string" || typeof object.time !== "string") return null;
  if (object.vehicle !== undefined && typeof object.vehicle !== "string") return null;

  /** @type {{ id: string, time: string, vehicle?: string }} */
  const row = { id: object.id, time: object.time };
  if (typeof object.vehicle === "string") row.vehicle = object.vehicle;
  return row;
}

/**
 * @param {unknown} value
 * @returns {Array<{ id: string, time: string, vehicle?: string }>}
 */
function normalizeTripList(value) {
  if (!Array.isArray(value)) return [];

  const rows = [];
  for (const item of value) {
    const row = normalizeTripListItem(item);
    if (row) rows.push(row);
  }
  return rows;
}

/**
 * @param {unknown} raw
 * @returns {{ vehicleName: string, nextPickupDateTime: string | null } | null}
 */
function normalizeFleetNextBookingItem(raw) {
  if (!raw || typeof raw !== "object") return null;
  const object = /** @type {Record<string, unknown>} */ (raw);
  const vehicleName =
    typeof object.vehicleName === "string"
      ? object.vehicleName
      : typeof object.vehicle_name === "string"
        ? object.vehicle_name
        : "";
  if (!vehicleName) return null;

  return {
    vehicleName,
    nextPickupDateTime:
      typeof object.nextPickupDateTime === "string"
        ? object.nextPickupDateTime
        : typeof object.next_pickup_date_time === "string"
          ? object.next_pickup_date_time
          : null,
  };
}

/**
 * @param {unknown} value
 * @returns {Array<{ vehicleName: string, nextPickupDateTime: string | null }>}
 */
function normalizeFleetNextBookings(value) {
  if (!Array.isArray(value)) return [];

  const rows = [];
  for (const item of value) {
    const row = normalizeFleetNextBookingItem(item);
    if (row) rows.push(row);
  }
  return rows;
}

/**
 * First finite numeric value among record keys (camelCase then snake_case).
 * @param {Record<string, unknown>} record
 * @param {string[]} keys
 * @returns {number}
 */
function readDayNumeric(record, keys) {
  for (const key of keys) {
    const value = record[key];
    if (value === undefined || value === null || typeof value === "boolean") continue;
    if (typeof value === "number" && Number.isFinite(value)) return value;
    if (typeof value === "string" && value.trim() !== "") {
      const numberValue = Number(value);
      if (Number.isFinite(numberValue)) return numberValue;
    }
  }
  return 0;
}

/**
 * @param {Record<string, unknown>} record
 * @param {string[]} keys
 */
function hasReadableDayNumber(record, keys) {
  for (const key of keys) {
    if (!Object.prototype.hasOwnProperty.call(record, key)) continue;
    const value = record[key];
    if (value === null || typeof value === "boolean") continue;
    if (typeof value === "number" && Number.isFinite(value)) return true;
    if (typeof value === "string" && value.trim() !== "") {
      const numberValue = Number(value);
      if (Number.isFinite(numberValue)) return true;
    }
  }
  return false;
}

/**
 * @param {unknown} raw
 * @returns {Array<{ staffName: string, startDate: string, endDate: string, reason: string }>}
 */
export function normalizeStaffsAway(raw) {
  if (!Array.isArray(raw)) return [];

  const rows = [];
  for (const item of raw) {
    if (!item || typeof item !== "object") continue;
    const object = /** @type {Record<string, unknown>} */ (item);
    const staffName =
      typeof object.staffName === "string"
        ? object.staffName
        : typeof object.staff_name === "string"
          ? object.staff_name
          : "";
    const startDate =
      typeof object.startDate === "string"
        ? object.startDate
        : typeof object.start_date === "string"
          ? object.start_date
          : "";
    const endDate =
      typeof object.endDate === "string"
        ? object.endDate
        : typeof object.end_date === "string"
          ? object.end_date
          : "";
    const reason = typeof object.reason === "string" ? object.reason : "";
    if (!staffName || !startDate || !endDate) continue;
    rows.push({ staffName, startDate, endDate, reason });
  }
  return rows;
}

/**
 * @param {unknown} day
 * @returns {StaffingDayEntry}
 */
export function normalizeDay(day) {
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
      fleetNextBookings: [],
    };
  }

  const record = /** @type {Record<string, unknown>} */ (day);
  const normalized = {
    date: typeof record.date === "string" ? record.date : "",
    pickups: readDayNumeric(record, ["pickups"]),
    dropoffs: readDayNumeric(record, ["dropoffs"]),
    pickupsList: normalizeTripList(record.pickupsList),
    dropoffsList: normalizeTripList(record.dropoffsList),
    carsToWash: readDayNumeric(record, ["cars_to_wash", "carsToWash"]),
    staffAwayWeighted: readDayNumeric(record, ["staff_away_weighted", "staffAwayWeighted"]),
    staffAwayCount: readDayNumeric(record, ["staff_away_count", "staffAwayCount"]),
    staffsAway: normalizeStaffsAway(
      record.staffsAway ?? record.staffs_away ?? record.staffsData ?? record.staffs_data,
    ),
    fleetNextBookings: normalizeFleetNextBookings(
      record.fleetNextBookings ?? record.fleet_next_bookings,
    ),
  };

  const dirtyCarsRaw = record.dirtyCars ?? record.dirty_cars;
  if (Array.isArray(dirtyCarsRaw)) {
    normalized.dirtyCars = dirtyCarsRaw
      .filter((car) => {
        if (!car || typeof car !== "object") return false;
        const vehicle = /** @type {Record<string, unknown>} */ (car);
        return typeof vehicle.vehicleName === "string" || typeof vehicle.vehicle_name === "string";
      })
      .map((car) => {
        const vehicle = /** @type {Record<string, unknown>} */ (car);
        return {
          vehicleName:
            typeof vehicle.vehicleName === "string"
              ? vehicle.vehicleName
              : String(vehicle.vehicle_name ?? ""),
          nextPickupDateTime:
            typeof vehicle.nextPickupDateTime === "string"
              ? vehicle.nextPickupDateTime
              : typeof vehicle.next_pickup_date_time === "string"
                ? vehicle.next_pickup_date_time
                : null,
        };
      });
  }

  return normalized;
}

/**
 * Map a Supabase row to the JSON shape the frontend expects.
 * @param {{ generated_at?: string | null, days?: unknown, staffsAway?: unknown, staffs_data?: unknown, staffsData?: unknown } | null | undefined} row
 * @returns {ClientStaffingPayload}
 */
export function rowToClientPayload(row) {
  if (!row) return { generatedAt: null, days: [], staffsAway: [] };

  const record = /** @type {Record<string, unknown>} */ (row);
  const days = Array.isArray(record.days) ? record.days.map((day) => normalizeDay(day)) : [];
  const generatedAt =
    typeof record.generated_at === "string"
      ? record.generated_at
      : record.generated_at == null
        ? null
        : String(record.generated_at);

  const staffsAwayRaw =
    record.staffs_away ?? record.staffsAway ?? record.staffs_data ?? record.staffsData;
  let staffsAway = normalizeStaffsAway(staffsAwayRaw);
  if (staffsAway.length === 0) {
    const nested = days.flatMap((day) => (Array.isArray(day.staffsAway) ? day.staffsAway : []));
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

  const numberFields = [
    ["pickups"],
    ["dropoffs"],
    ["carsToWash", "cars_to_wash"],
    ["staffAwayWeighted", "staff_away_weighted"],
    ["staffAwayCount", "staff_away_count"],
  ];
  for (const keys of numberFields) {
    if (!hasReadableDayNumber(day, keys)) {
      console.error(`[validation] invalid day.${keys.join(" / ")} (expected finite number):`);
      return false;
    }
  }

  for (const [field, trips] of [
    ["pickupsList", day.pickupsList],
    ["dropoffsList", day.dropoffsList],
  ]) {
    if (!Array.isArray(trips)) {
      console.error(`[validation] invalid day.${field} (expected array):`, trips);
      return false;
    }
    for (const [index, trip] of trips.entries()) {
      if (!trip || typeof trip !== "object") {
        console.error(`[validation] invalid ${field}[${index}] (expected object):`, trip);
        return false;
      }
      const record = /** @type {Record<string, unknown>} */ (trip);
      if (typeof record.id !== "string" || typeof record.time !== "string") {
        console.error(`[validation] invalid ${field}[${index}] (expected id and time strings):`, trip);
        return false;
      }
      if (record.vehicle !== undefined && typeof record.vehicle !== "string") {
        console.error(`[validation] invalid ${field}[${index}].vehicle (expected string):`, record.vehicle);
        return false;
      }
    }
  }

  return true;
}

/**
 * Accept either a complete payload, one day entry, or an array of day entries.
 * @param {unknown} value
 * @returns {StaffingPayload | null}
 */
export function coerceIncomingPayload(value) {
  if (Array.isArray(value)) {
    for (const [index, day] of value.entries()) {
      if (!isValidDayEntry(day)) {
        console.error(`[validation] top-level array invalid at index ${index}.`);
        return null;
      }
    }
    return { generatedAt: new Date().toISOString(), days: value, staffsAway: [] };
  }

  if (!value || typeof value !== "object") return null;
  const record = /** @type {Record<string, unknown>} */ (value);

  if (typeof record.generatedAt === "string" && Array.isArray(record.days)) {
    for (const [index, day] of record.days.entries()) {
      if (!isValidDayEntry(day)) {
        console.error(`[validation] payload.days invalid at index ${index}.`);
        return null;
      }
    }
    return {
      generatedAt: record.generatedAt,
      days: record.days,
      staffsAway: normalizeStaffsAway(
        record.staffsAway ?? record.staffs_away ?? record.staffsData ?? record.staffs_data,
      ),
    };
  }

  if (isValidDayEntry(record)) {
    return { generatedAt: new Date().toISOString(), days: [record], staffsAway: [] };
  }

  console.error(
    "[validation] payload did not match any accepted format. Expected one of: {generatedAt, days[]}, day object, or day array.",
  );
  return null;
}
