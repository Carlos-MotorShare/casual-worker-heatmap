import { handleCors } from "../helpers/cors.js";
import { fetchStackerData } from "../helpers/stacker-data.js";
import { supabase } from "../supabase.js";

export default async function handler(req, res) {
  if (handleCors(req, res)) return;
  if (req.method !== "GET") {
    return res.status(405).json({ error: "Method Not Allowed" });
  }

  try {
    const cloudflareResponse = await fetchStackerData(supabase);
    return res.status(200).json({ cloudflare: cloudflareResponse });
  } catch (error) {
    console.error("[stacker-data] unexpected error while fetching payload:", error);
    return res.status(500).json({ error: "Failed to fetch stacker data." });
  }
}