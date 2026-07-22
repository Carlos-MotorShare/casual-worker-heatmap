import { supabase } from "../supabase.js";

export default async function handler(req, res) {
  if (req.method !== "GET") {
    return res.status(405).json({ error: "Method Not Allowed" });
  }

  try {
    const { data, error } = await supabase.rpc("list_worker_users");
    if (error) {
      console.error("[worker-users] rpc failed:", error);
      return res.status(500).json({ error: "Failed to load workers." });
    }

    const list = Array.isArray(data) ? data : [];
    const rows = list.map((row) => ({
      id: typeof row.id === "string" ? row.id : "",
      username: typeof row.username === "string" ? row.username : "",
      colour: typeof row.colour === "string" ? row.colour : null,
    }));
    return res.status(200).json({ rows });
  } catch (error) {
    console.error("[worker-users] unexpected error:", error);
    return res.status(500).json({ error: "Failed to load workers." });
  }
}
