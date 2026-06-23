/**
 * Test script for the quick turnaround Slack notification.
 * Run with: node test-quick-turnaround.js
 *
 * Modes (set MODE below):
 *   "mock" — uses hardcoded dropoffsList data (matches the new Airtable/Supabase
 *            shape) and actually sends a Slack message to the alert channel.
 *            Use this to check formatting/delivery without touching real data.
 *   "live" — fetches today's real day from Supabase and dry-runs the filter
 *            logic (logs what would be sent, does NOT call Slack). Use this to
 *            confirm `nextBookingWithin24h` is coming through correctly once
 *            Airtable starts sending it.
 *
 * This mirrors test-slack.js: logic is duplicated locally (not imported from
 * index.js) since index.js has side effects (starts the HTTP server).
 */

import "dotenv/config";
import { createClient } from "@supabase/supabase-js";
import {
  sendSlackNotification,
  headerBlock,
  sectionBlock,
  contextBlock,
  dividerBlock,
} from "./slack.js";

const MODE = "mock"; // "mock" | "live"

const NZ_TZ = "Pacific/Auckland";

// ── Mock data — matches the shape described in the handover ────────────────

const TODAY_ISO = new Date().toLocaleDateString("en-CA", { timeZone: NZ_TZ });

const MOCK_DAY = {
  date: TODAY_ISO,
  dropoffsList: [
    {
      id: "3459",
      time: "2:30 PM",
      vehicle: "Audi R8 V10 (Gen 2)",
      nextPickupDateTime: "2026-06-24T13:30:00.000Z",
      nextBookingWithin24h: false,
    },
    {
      id: "3401",
      time: "12:00 PM",
      vehicle: "Audi R8 V10 (Gen 2)",
      nextPickupDateTime: "2026-06-24T13:30:00.000Z",
      nextBookingWithin24h: true,
    },
  ],
};

// ── Helpers (mirrors the new functions in index.js) ─────────────────────────

function findQuickTurnarounds(rawDay) {
  const dropoffsList = rawDay && Array.isArray(rawDay.dropoffsList) ? rawDay.dropoffsList : [];
  const out = [];
  for (const item of dropoffsList) {
    if (!item || typeof item !== "object") continue;
    if (item.nextBookingWithin24h !== true) continue;
    out.push({
      id: typeof item.id === "string" ? item.id : String(item.id ?? ""),
      time: typeof item.time === "string" ? item.time : "",
      vehicle: typeof item.vehicle === "string" ? item.vehicle : "Unknown vehicle",
      nextPickupDateTime: typeof item.nextPickupDateTime === "string" ? item.nextPickupDateTime : null,
    });
  }
  return out;
}

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

function formatDayLabel(iso) {
  const d = new Date(`${iso}T12:00:00Z`);
  return d.toLocaleDateString("en-NZ", { weekday: "long", day: "numeric", month: "short", timeZone: "UTC" });
}

// ── Run ──────────────────────────────────────────────────────────────────────

console.log(`\nRunning quick turnaround test — mode: "${MODE}"\n`);

if (MODE === "mock") {
  const items = findQuickTurnarounds(MOCK_DAY);
  console.log(`Found ${items.length} quick turnaround(s) for ${MOCK_DAY.date}:`, items);

  if (items.length === 0) {
    console.log("No quick turnarounds — nothing would be sent.");
  } else {
    const dateLabel = formatDayLabel(MOCK_DAY.date);
    await sendSlackNotification("alert", {
      text: `🔄 ${items.length} quick turnaround${items.length > 1 ? "s" : ""} today (${dateLabel})`,
      blocks: buildQuickTurnaroundBlocks(dateLabel, items),
    });
    console.log("Sent test Slack message to the alert channel.");
  }
} else if (MODE === "live") {
  const supabaseUrl = process.env.SUPABASE_URL;
  const supabaseAnonKey = process.env.SUPABASE_ANON_KEY;
  if (!supabaseUrl || !supabaseAnonKey) {
    console.error("Missing SUPABASE_URL or SUPABASE_ANON_KEY — cannot run live test.");
    process.exit(1);
  }
  const supabase = createClient(supabaseUrl, supabaseAnonKey);

  const { data, error } = await supabase
    .from("staffing_data")
    .select("days")
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) {
    console.error("Failed to fetch staffing_data:", error);
    process.exit(1);
  }

  const days = Array.isArray(data?.days) ? data.days : [];
  const rawDay = days.find((d) => d && d.date === TODAY_ISO) ?? null;
  console.log(rawDay ? `Found day entry for today (${TODAY_ISO}): ${JSON.stringify(rawDay, null, 2)}.` : `No day entry for today (${TODAY_ISO}).`);

  if (!rawDay) {
    console.log(`No day entry found for today (${TODAY_ISO}). Available dates:`, days.map((d) => d?.date));
  } else {
    const items = findQuickTurnarounds(rawDay);
    console.log(`Found ${items.length} quick turnaround(s) for ${TODAY_ISO}:`, items);
    console.log("(Live mode is a dry run — no Slack message sent. Switch MODE to 'mock' to test delivery.)");
  }
} else {
  console.error(`Unknown MODE "${MODE}" — expected "mock" or "live".`);
  process.exit(1);
}

console.log("\nDone.");
