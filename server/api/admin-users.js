import { supabase } from "../supabase.js";

export default async function handler(req, res) {
  if (req.method !== "GET") {
    return res.status(405).json({ error: "Method Not Allowed" });
  }

  try {
    const excludeUserId = typeof req.query.exclude === "string" ? req.query.exclude : null;
    const { data, error } = await supabase.rpc("list_admin_users", {
      exclude_user_id: excludeUserId || null,
    });
    if (error) {
      console.error("[admin-users] rpc failed:", error);
      return res.status(500).json({ error: "Failed to load admins." });
    }

    const list = Array.isArray(data) ? data : [];
    const rows = list.map((row) => ({
      id: typeof row.id === "string" ? row.id : "",
      username: typeof row.username === "string" ? row.username : "",
      colour: typeof row.colour === "string" ? row.colour : null,
    }));
    return res.status(200).json({ rows });
  } catch (error) {
    console.error("[admin-users] unexpected error:", error);
    return res.status(500).json({ error: "Failed to load admins." });
  }
}
