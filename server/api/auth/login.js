import { handleCors } from "../../helpers/cors.js";
import { supabase } from "../../supabase.js";

export default async function handler(req, res) {
  if (handleCors(req, res)) return;
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method Not Allowed" });
  }

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
  } catch (error) {
    console.error("[auth] unexpected error:", error);
    return res.status(500).json({ error: "Login failed." });
  }
}
