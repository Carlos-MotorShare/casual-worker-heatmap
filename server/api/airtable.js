import { handleCors } from "../helpers/cors.js";
import { coerceIncomingPayload } from "../helpers/staffing-data.js";
import { supabase } from "../supabase.js";

export default async function handler(req, res) {
  if (handleCors(req, res)) return;
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method Not Allowed" });
  }

  const payload = coerceIncomingPayload(req.body);
  const generatedAt = payload?.generatedAt ?? "(missing generatedAt)";
  const daysCount = Array.isArray(payload?.days) ? payload.days.length : 0;

  console.log(`[airtable] received payload generatedAt=${generatedAt} days=${daysCount}`);
  if (payload?.days?.[0]) {
    const firstDay = /** @type {Record<string, unknown>} */ (payload.days[0]);
    console.log("[airtable] days[0] keys:", Object.keys(firstDay));
    console.log("[airtable] days[0] dirtyCars:", firstDay.dirtyCars);
  }

  if (!payload) {
    console.error("[airtable] invalid payload format.");
    return res.status(500).json({ error: "Failed to save data." });
  }

  try {
    const { data: inserted, error: insertError } = await supabase
      .from("staffing_data")
      .insert({
        generated_at: payload.generatedAt,
        days: payload.days,
      })
      .select("id, generated_at, days")
      .single();

    if (insertError) {
      console.error("[airtable] failed to save payload to Supabase:", insertError);
      return res.status(500).json({ error: "Failed to save data." });
    }

    if (!inserted?.id) {
      console.error("[airtable] insert returned no row id.");
      return res.status(500).json({ error: "Failed to save data." });
    }

    const { error: deleteError } = await supabase
      .from("staffing_data")
      .delete()
      .not("id", "eq", inserted.id);
    if (deleteError) {
      console.error("[airtable] failed to prune older rows:", deleteError);
      return res.status(500).json({ error: "Failed to save data." });
    }

    console.log(
      `[airtable] data saved to Supabase id=${inserted.id} generatedAt=${payload.generatedAt} days=${payload.days.length}`,
    );
    return res.status(200).json({ ok: true });
  } catch (error) {
    console.error("[airtable] unexpected error while saving payload:", error);
    return res.status(500).json({ error: "Failed to save data." });
  }
}
