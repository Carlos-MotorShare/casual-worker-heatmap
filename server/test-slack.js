/**
 * Test script for Slack notifications.
 * Run with: node test-slack.js
 *
 * Swap the SCENARIO variable to test different notification states.
 */

import "dotenv/config";
import {
  sendSlackNotification,
  slackMention,
  headerBlock,
  sectionBlock,
  contextBlock,
  dividerBlock,
} from "./slack.js";

// ── Hardcoded test data ──────────────────────────────────────────────────────

const SCENARIO = "summary"; // "warning" | "summary" | "alert"

const SAT_LABEL = "Saturday, 21 Jun";
const SUN_LABEL = "Sunday, 22 Jun";

const TEST_DATA = {
  warning: {
    satWorkers: [],
    sunWorkers: [],
    satDay: { pickups: 0, dropoffs: 0, carsToWash: 0, pickupsList: [], dropoffsList: [] },
    sunDay: { pickups: 0, dropoffs: 0, carsToWash: 0, pickupsList: [], dropoffsList: [] },
  },
  summary: {
    satWorkers: [
      { username: "Carlos", startTime: "08:00:00", endTime: "20:00:00" },
      { username: "Test", startTime: "08:00:00", endTime: "14:00:00" },
    ],
    sunWorkers: [
      { username: "Test", startTime: "08:00:00", endTime: "20:00:00" },
      { username: "Test", startTime: "10:00:00", endTime: "16:00:00" },
    ],
    satDay: { pickups: 2, dropoffs: 1, carsToWash: 6, pickupsList: [], dropoffsList: [] },
    sunDay: { pickups: 5, dropoffs: 3, carsToWash: 2, pickupsList: [], dropoffsList: [] },
  },
  alert: {
    satWorkers: [{ username: "Joe", startTime: "08:00:00", endTime: "20:00:00" }],
    sunWorkers: [],
    satDay: {
      pickups: 7,
      dropoffs: 4,
      carsToWash: 3,
      // Three pickups in the 9am hour → triggers intensity alert
      pickupsList: [
        { id: "1", time: "09:00:00" },
        { id: "2", time: "09:15:00" },
        { id: "3", time: "09:45:00" },
        { id: "4", time: "14:00:00" },
      ],
      dropoffsList: [
        { id: "5", time: "09:00:00" },
        { id: "6", time: "09:30:00" },
      ],
    },
    sunDay: { pickups: 0, dropoffs: 0, carsToWash: 1, pickupsList: [], dropoffsList: [] },
  },
};

// ── Helpers (mirrors index.js) ───────────────────────────────────────────────

const EXTRA_HANDS_SLOTS = [
  { name: "Morning", min: 8, max: 12 },
  { name: "Afternoon", min: 12, max: 17 },
  { name: "Evening", min: 17, max: 21 },
];

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

  const needed = new Map();

  for (const [h, count] of pickupsByHour) {
    if (count >= 3) {
      const slot = EXTRA_HANDS_SLOTS.find((s) => h >= s.min && h < s.max);
      if (slot && !needed.has(slot.name))
        needed.set(slot.name, `${count} pickups in the same hour`);
    }
  }

  for (const [h, dCount] of dropoffsByHour) {
    const pCount = pickupsByHour.get(h) ?? 0;
    if (dCount >= 2 && pCount >= 1) {
      const slot = EXTRA_HANDS_SLOTS.find((s) => h >= s.min && h < s.max);
      if (slot && !needed.has(slot.name))
        needed.set(slot.name, `${dCount} dropoffs overlapping with ${pCount} pickup${pCount > 1 ? "s" : ""}`);
    }
  }

  const coveredSlots = EXTRA_HANDS_SLOTS.filter((s) =>
    [...pickupsByHour.entries()].some(([h, c]) => c > 0 && h >= s.min && h < s.max),
  );
  if (coveredSlots.length === 3) {
    for (const s of EXTRA_HANDS_SLOTS)
      if (!needed.has(s.name)) needed.set(s.name, "pickups span the full day");
  }

  if (needed.size === 0) return null;
  for (const slot of EXTRA_HANDS_SLOTS)
    if (needed.has(slot.name)) return { slot: slot.name, reason: needed.get(slot.name) };
  return null;
}

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

function formatTime(t) {
  const h = parseInt(t.split(":")[0], 10);
  return h === 0 ? "12am" : h < 12 ? `${h}am` : h === 12 ? "12pm" : `${h - 12}pm`;
}

// ── Run ──────────────────────────────────────────────────────────────────────

const { satWorkers, sunWorkers, satDay, sunDay } = TEST_DATA[SCENARIO];

console.log(`\nRunning scenario: "${SCENARIO}"\n`);

// AUTO
const noOneSat = satWorkers.length === 0;
const noOneSun = sunWorkers.length === 0;

if (noOneSat && noOneSun) {
  await sendSlackNotification("auto", {
    text: `⚠️ No one is rostered for this weekend (${SAT_LABEL} & ${SUN_LABEL}).`,
    blocks: [
      headerBlock("⚠️ Weekend Roster Warning"),
      sectionBlock(
        `No workers have been assigned for the upcoming weekend.\n\n*${SAT_LABEL}* — unassigned\n*${SUN_LABEL}* — unassigned`,
      ),
      dividerBlock,
      contextBlock(["Please assign workers as soon as possible."]),
    ],
  });
} else {
  const buildDaySummary = (label, workers, day) => {
    const workerList =
      workers.length > 0
        ? workers.map((w) => `• ${slackMention(w.username)} (${formatTime(w.startTime)}–${formatTime(w.endTime)})`).join("\n")
        : "_No one assigned_";
    const brief = day ? buildDayBrief(day) : "No staffing data available.";
    return `*${label}*\n${workerList}\n_${brief}_`;
  };

  const blocks = [
    headerBlock("📅 Weekend Roster Summary"),
    sectionBlock(buildDaySummary(SAT_LABEL, satWorkers, satDay)),
    dividerBlock,
    sectionBlock(buildDaySummary(SUN_LABEL, sunWorkers, sunDay)),
  ];

  const warningLines = [];
  if (noOneSat) warningLines.push(`⚠️ No one assigned for ${SAT_LABEL}`);
  if (noOneSun) warningLines.push(`⚠️ No one assigned for ${SUN_LABEL}`);
  if (warningLines.length > 0) {
    blocks.push(dividerBlock);
    blocks.push(sectionBlock(warningLines.join("\n")));
  }

  await sendSlackNotification("auto", {
    text: `Weekend roster for ${SAT_LABEL} & ${SUN_LABEL}`,
    blocks,
  });
}

// ALERT
for (const { label, day, workers } of [
  { label: SAT_LABEL, day: satDay, workers: satWorkers },
  { label: SUN_LABEL, day: sunDay, workers: sunWorkers },
]) {
  if (!day) continue;
  const extraHands = computeExtraHandsRequired(day.pickupsList, day.dropoffsList);
  if (!extraHands) continue;

  const rosterLine =
    workers.length > 0 ? workers.map((w) => slackMention(w.username)).join(", ") : "_No one assigned yet_";

  await sendSlackNotification("alert", {
    text: `🚨 Extra hands needed on ${label} (${extraHands.slot})`,
    blocks: [
      headerBlock(`🚨 Extra Hands Needed — ${label}`),
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

console.log("Done.");
