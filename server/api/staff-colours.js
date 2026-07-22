import { handleCors } from "../helpers/cors.js";
import { supabase } from "../supabase.js";

export default async function handler(req, res) {
  if (handleCors(req, res)) return;
  if (req.method !== "GET") {
    return res.status(405).json({ error: "Method Not Allowed" });
  }

  try {
    const { data, error } = await supabase.rpc("staff_colours");
    if (error) {
      console.error("[staff-colours] rpc failed:", error);
      return res.status(500).json({ error: "Failed to load staff colours." });
    }

    const list = Array.isArray(data) ? data : [];
    const rows = list.map((row) => ({
      username: typeof row.username === "string" ? row.username : "",
      colour: typeof row.colour === "string" ? row.colour : null,
    }));
    return res.status(200).json({ rows });
  } catch (error) {
    console.error("[staff-colours] unexpected error:", error);
    return res.status(500).json({ error: "Failed to load staff colours." });
  }
}
