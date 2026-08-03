import { handleCors } from "../helpers/cors.js";
import { rowToClientPayload } from "../helpers/staffing-data.js";
import { supabase } from "../supabase.js";

export default async function handler(req, res) {
  if (handleCors(req, res)) return;
  if (req.method !== "GET") {
    return res.status(405).json({ error: "Method Not Allowed" });
  }

  try {
    const { data, error } = await supabase
      .from("staffing_data")
      .select("*")
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (error) {
      console.error("[data] failed to fetch latest payload from Supabase:", error);
      return res.status(500).json({ error: "Failed to fetch data." });
    }

    if (!data) {
      console.log("[data] no data found, returning empty payload.");
      return res.status(200).json({
        generatedAt: null,
        days: [],
        staffsAway: [],
      });
    }

    const responsePayload = rowToClientPayload(data);

    console.log(
      `[data] fetched latest payload generatedAt=${responsePayload.generatedAt} days=${responsePayload.days.length}`
    );

    return res.status(200).json(responsePayload);
  } catch (error) {
    console.error("[data] unexpected error while fetching payload:", error);
    return res.status(500).json({ error: "Failed to fetch data." });
  }
}