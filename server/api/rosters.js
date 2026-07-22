import { handleCors } from "../helpers/cors.js";
import { getUserFlags, isIsoDateString, normalizePgDateString, normalizePgTimeString } from "../helpers/rosters.js";
import { supabase } from "../supabase.js";

async function getRosters(req, res) {
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
    const rows = list.map((row) => ({
      blockId: row.block_id,
      rosterId: row.roster_id,
      userId: row.user_id,
      date: normalizePgDateString(row.roster_date),
      username: row.username,
      colour: typeof row.colour === "string" ? row.colour : row.colour ?? null,
      rosterUserIsAdmin: row.roster_user_admin === true,
      startTime: normalizePgTimeString(row.start_time),
      endTime: normalizePgTimeString(row.end_time),
    }));
    return res.status(200).json({ rows });
  } catch (error) {
    console.error("[rosters] unexpected error:", error);
    return res.status(500).json({ error: "Failed to fetch rosters." });
  }
}

async function saveRoster(req, res) {
  const body = req.body && typeof req.body === "object" ? req.body : {};
  const userId = typeof body.userId === "string" ? body.userId : "";
  const date = typeof body.date === "string" ? body.date : "";
  const actorUserId =
    typeof body.actorUserId === "string" && body.actorUserId.trim()
      ? body.actorUserId.trim()
      : userId;
  const blocks = /** @type {unknown} */ (body.blocks ?? []);

  if (!userId || !isIsoDateString(date)) {
    return res.status(400).json({ error: "Valid userId and date (YYYY-MM-DD) are required." });
  }
  if (!Array.isArray(blocks) || blocks.length === 0) {
    return res.status(400).json({ error: "blocks must be a non-empty array." });
  }

  const normalizedBlocks = [];
  for (const block of blocks) {
    if (!block || typeof block !== "object") {
      return res.status(400).json({ error: "Invalid block." });
    }
    const { startTime, endTime } = /** @type {{ startTime?: unknown, endTime?: unknown }} */ (block);
    if (typeof startTime !== "string" || typeof endTime !== "string") {
      return res.status(400).json({ error: "Each block needs startTime and endTime (HH:MM:SS)." });
    }
    normalizedBlocks.push({ startTime, endTime });
  }

  try {
    const [actorFlags, targetFlags] = await Promise.all([
      getUserFlags(actorUserId),
      getUserFlags(userId),
    ]);
    if (!actorFlags || !targetFlags) {
      return res.status(403).json({ error: "Could not verify permissions." });
    }
    if (actorUserId !== userId && !actorFlags.canRoster) {
      return res.status(403).json({ error: "You cannot assign rosters for other users." });
    }

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

    const { error: blocksError } = await supabase
      .from("roster_blocks")
      .insert(normalizedBlocks.map((block) => ({
        roster_id: rosterRow.id,
        start_time: block.startTime,
        end_time: block.endTime,
      })));
    if (blocksError) {
      console.error("[rosters] insert roster_blocks failed:", blocksError);
      await supabase.from("rosters").delete().eq("id", rosterRow.id);
      return res.status(500).json({ error: "Failed to save roster." });
    }

    return res.status(200).json({ ok: true, rosterId: rosterRow.id });
  } catch (error) {
    console.error("[rosters] unexpected error:", error);
    return res.status(500).json({ error: "Failed to save roster." });
  }
}

export default function handler(req, res) {
  if (handleCors(req, res)) return;
  if (req.method === "GET") return getRosters(req, res);
  if (req.method === "POST") return saveRoster(req, res);
  return res.status(405).json({ error: "Method Not Allowed" });
}
