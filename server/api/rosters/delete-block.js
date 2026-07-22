import { handleCors } from "../../helpers/cors.js";
import { supabase } from "../../supabase.js";

export default async function handler(req, res) {
  if (handleCors(req, res)) return;
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method Not Allowed" });
  }

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
      const errorCode = typeof result.error === "string" ? result.error : "";
      if (errorCode === "not_found") {
        return res.status(404).json({ error: "That shift block was not found." });
      }
      if (errorCode === "forbidden") {
        return res.status(403).json({ error: "You cannot remove this shift." });
      }
      return res.status(400).json({ error: "Could not delete this block." });
    }

    return res.status(200).json({ ok: true });
  } catch (error) {
    console.error("[rosters] delete-block unexpected error:", error);
    return res.status(500).json({ error: "Failed to delete block." });
  }
}
