import {
  sendSlackNotification,
  slackMention,
  headerBlock,
  sectionBlock,
  contextBlock,
  dividerBlock,
} from "../slack.js";
import { supabase } from "../supabase.js";
import { normalizeDay } from "./staffing-data.js";
import { normalizePgDateString, normalizePgTimeString } from "./rosters.js";

const NZ_TZ = "Pacific/Auckland";

/**
 * @param {Date} fridayNz
 * @returns {{ satIso: string, sunIso: string }}
 */
function nextWeekendDates(fridayNz) {
  const toIso = (date) => date.toISOString().slice(0, 10);
  const saturday = new Date(
    Date.UTC(fridayNz.getFullYear(), fridayNz.getMonth(), fridayNz.getDate() + 1),
  );
  const sunday = new Date(
    Date.UTC(fridayNz.getFullYear(), fridayNz.getMonth(), fridayNz.getDate() + 2),
  );
  return { satIso: toIso(saturday), sunIso: toIso(sunday) };
}

/** @param {string[]} dates */
async function fetchStaffingDays(dates) {
  const { data, error } = await supabase
    .from("staffing_data")
    .select("days")
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error || !data) return new Map();

  const days = Array.isArray(data.days) ? data.days.map((day) => normalizeDay(day)) : [];
  const dateSet = new Set(dates);
  return new Map(days.filter((day) => dateSet.has(day.date)).map((day) => [day.date, day]));
}

/** @param {string} start @param {string} end */
async function fetchRostersForDates(start, end) {
  const { data, error } = await supabase.rpc("rosters_for_range", {
    payload: { start, end },
  });
  if (error || !Array.isArray(data)) return [];

  return data.map((row) => ({
    userId: row.user_id,
    date: normalizePgDateString(row.roster_date),
    username: row.username,
    startTime: normalizePgTimeString(row.start_time),
    endTime: normalizePgTimeString(row.end_time),
    isAdmin: row.roster_user_admin === true,
  }));
}

const EXTRA_HANDS_SLOTS = [
  { name: "Morning", min: 8, max: 12 },
  { name: "Afternoon", min: 12, max: 17 },
  { name: "Evening", min: 17, max: 21 },
];

/**
 * @param {Array<{time: string}>} pickupsList
 * @param {Array<{time: string}>} dropoffsList
 * @returns {{ slot: string, reason: string } | null}
 */
function computeExtraHandsRequired(pickupsList, dropoffsList) {
  const getHour = (time) => parseInt(time.split(":")[0], 10);
  const pickupsByHour = new Map();
  for (const pickup of pickupsList) {
    const hour = getHour(pickup.time);
    if (Number.isFinite(hour)) {
      pickupsByHour.set(hour, (pickupsByHour.get(hour) ?? 0) + 1);
    }
  }

  const dropoffsByHour = new Map();
  for (const dropoff of dropoffsList) {
    const hour = getHour(dropoff.time);
    if (Number.isFinite(hour)) {
      dropoffsByHour.set(hour, (dropoffsByHour.get(hour) ?? 0) + 1);
    }
  }

  const needed = new Map();
  for (const [hour, count] of pickupsByHour) {
    if (count < 3) continue;
    const slot = EXTRA_HANDS_SLOTS.find((candidate) => hour >= candidate.min && hour < candidate.max);
    if (slot && !needed.has(slot.name)) needed.set(slot.name, `${count} pickups in the same hour`);
  }

  for (const [hour, dropoffCount] of dropoffsByHour) {
    const pickupCount = pickupsByHour.get(hour) ?? 0;
    if (dropoffCount < 2 || pickupCount < 1) continue;
    const slot = EXTRA_HANDS_SLOTS.find((candidate) => hour >= candidate.min && hour < candidate.max);
    if (slot && !needed.has(slot.name)) {
      needed.set(
        slot.name,
        `${dropoffCount} dropoffs overlapping with ${pickupCount} pickup${pickupCount > 1 ? "s" : ""}`,
      );
    }
  }

  const coveredSlots = EXTRA_HANDS_SLOTS.filter((slot) =>
    [...pickupsByHour.entries()].some(
      ([hour, count]) => count > 0 && hour >= slot.min && hour < slot.max,
    ),
  );
  if (coveredSlots.length === EXTRA_HANDS_SLOTS.length) {
    for (const slot of EXTRA_HANDS_SLOTS) {
      if (!needed.has(slot.name)) needed.set(slot.name, "pickups span the full day");
    }
  }

  for (const slot of EXTRA_HANDS_SLOTS) {
    if (needed.has(slot.name)) return { slot: slot.name, reason: needed.get(slot.name) };
  }
  return null;
}

/** @param {{ pickups: number, dropoffs: number, carsToWash: number }} day */
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
  const date = new Date(`${iso}T12:00:00Z`);
  return date.toLocaleDateString("en-NZ", {
    weekday: "long",
    day: "numeric",
    month: "short",
    timeZone: "UTC",
  });
}

/** @param {string} time */
function formatTime(time) {
  const hour = parseInt(time.split(":")[0], 10);
  return hour === 0 ? "12am" : hour < 12 ? `${hour}am` : hour === 12 ? "12pm" : `${hour - 12}pm`;
}

export async function runWeekendRosterNotification() {
  console.log("[cron] Running weekend roster notification...");

  const nzDate = new Date().toLocaleDateString("en-CA", { timeZone: NZ_TZ });
  const [year, month, day] = nzDate.split("-").map(Number);
  const fridayNz = new Date(Date.UTC(year, month - 1, day));
  const { satIso, sunIso } = nextWeekendDates(fridayNz);

  const [staffingDays, rosterRows] = await Promise.all([
    fetchStaffingDays([satIso, sunIso]),
    fetchRostersForDates(satIso, sunIso),
  ]);

  const selectWorkers = (date) =>
    [...new Map(
      rosterRows
        .filter((row) => row.date === date && row.isAdmin)
        .map((row) => [row.userId, row]),
    ).values()];
  const satWorkers = selectWorkers(satIso);
  const sunWorkers = selectWorkers(sunIso);
  const satDay = staffingDays.get(satIso);
  const sunDay = staffingDays.get(sunIso);
  const satLabel = formatDayLabel(satIso);
  const sunLabel = formatDayLabel(sunIso);
  const noOneSat = satWorkers.length === 0;
  const noOneSun = sunWorkers.length === 0;

  if (noOneSat && noOneSun) {
    await sendSlackNotification("auto", {
      text: `⚠️ No one is rostered for this weekend (${satLabel} & ${sunLabel}).`,
      blocks: [
        headerBlock("⚠️ Weekend Roster Warning"),
        sectionBlock(
          `No workers have been assigned for the upcoming weekend.\n\n*${satLabel}* — unassigned\n*${sunLabel}* — unassigned`,
        ),
        dividerBlock,
        contextBlock(["Please assign workers as soon as possible."]),
      ],
    });
  } else {
    const buildDaySummary = (label, workers, staffingDay) => {
      const workerList = workers.length > 0
        ? workers
            .map((worker) => `• ${slackMention(worker.username)} (${formatTime(worker.startTime)}–${formatTime(worker.endTime)})`)
            .join("\n")
        : "_No one assigned_";
      const brief = staffingDay ? buildDayBrief(staffingDay) : "No staffing data available.";
      return `*${label}*\n${workerList}\n_${brief}_`;
    };

    const warningLines = [];
    if (noOneSat) warningLines.push(`⚠️ No one assigned for ${satLabel}`);
    if (noOneSun) warningLines.push(`⚠️ No one assigned for ${sunLabel}`);
    const blocks = [
      headerBlock("📅 Weekend Roster Summary"),
      sectionBlock(buildDaySummary(satLabel, satWorkers, satDay)),
      dividerBlock,
      sectionBlock(buildDaySummary(sunLabel, sunWorkers, sunDay)),
    ];
    if (warningLines.length > 0) {
      blocks.push(dividerBlock, sectionBlock(warningLines.join("\n")));
    }

    await sendSlackNotification("auto", {
      text: `Weekend roster for ${satLabel} & ${sunLabel}`,
      blocks,
    });
  }

  for (const { label, staffingDay } of [
    { label: satLabel, staffingDay: satDay },
    { label: sunLabel, staffingDay: sunDay },
  ]) {
    if (!staffingDay) continue;
    const extraHands = computeExtraHandsRequired(
      staffingDay.pickupsList ?? [],
      staffingDay.dropoffsList ?? [],
    );
    if (!extraHands) continue;

    const workerNames = selectWorkers(staffingDay.date).map((worker) => slackMention(worker.username));
    const rosterLine = workerNames.length > 0 ? workerNames.join(", ") : "_No one assigned yet_";
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
          `${staffingDay.pickups} pickup${staffingDay.pickups !== 1 ? "s" : ""} · ` +
            `${staffingDay.dropoffs} dropoff${staffingDay.dropoffs !== 1 ? "s" : ""} · ` +
            `${staffingDay.carsToWash ?? 0} car${staffingDay.carsToWash !== 1 ? "s" : ""} to wash`,
        ]),
      ],
    });
  }

  console.log("[cron] Weekend roster notification complete.");
}

/** @param {string} dateIso */
async function fetchRawStaffingDay(dateIso) {
  const { data, error } = await supabase
    .from("staffing_data")
    .select("days")
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error || !data || !Array.isArray(data.days)) return null;
  const match = data.days.find(
    (day) => day && typeof day === "object" && /** @type {Record<string, unknown>} */ (day).date === dateIso,
  );
  return match ? /** @type {Record<string, unknown>} */ (match) : null;
}

/** @param {Record<string, unknown> | null} rawDay */
function findQuickTurnarounds(rawDay) {
  const dropoffs = rawDay && Array.isArray(rawDay.dropoffsList) ? rawDay.dropoffsList : [];
  const items = [];
  for (const item of dropoffs) {
    if (!item || typeof item !== "object") continue;
    const record = /** @type {Record<string, unknown>} */ (item);
    if (record.nextBookingWithin24h !== true) continue;
    items.push({
      id: typeof record.id === "string" ? record.id : String(record.id ?? ""),
      time: typeof record.time === "string" ? record.time : "",
      vehicle: typeof record.vehicle === "string" ? record.vehicle : "Unknown vehicle",
      nextPickupDateTime:
        typeof record.nextPickupDateTime === "string" ? record.nextPickupDateTime : null,
    });
  }
  return items;
}

/** @param {string | null} iso */
function formatNzTimeFromIso(iso) {
  if (!iso) return null;
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return null;
  const hours = date.getUTCHours();
  const minutes = date.getUTCMinutes();
  const period = hours >= 12 ? "PM" : "AM";
  const displayHour = hours % 12 === 0 ? 12 : hours % 12;
  return `${displayHour}:${String(minutes).padStart(2, "0")} ${period}`;
}

/** @param {string} dateLabel @param {Array<{time: string, vehicle: string, nextPickupDateTime: string | null}>} items */
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

export async function runQuickTurnaroundNotification() {
  console.log("[cron] Running quick turnaround notification...");

  const todayIso = new Date().toLocaleDateString("en-CA", { timeZone: NZ_TZ });
  const items = findQuickTurnarounds(await fetchRawStaffingDay(todayIso));
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
