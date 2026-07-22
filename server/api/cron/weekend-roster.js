import { verifyCronSecret } from "../../helpers/cron.js";
import { handleCors } from "../../helpers/cors.js";
import { runWeekendRosterNotification } from "../../helpers/notifications.js";

export default async function handler(req, res) {
  if (handleCors(req, res)) return;
  if (req.method !== "GET") {
    return res.status(405).json({ error: "Method Not Allowed" });
  }
  if (!verifyCronSecret(req, res)) return;

  console.log("[cron] weekend-roster triggered:", new Date().toISOString());

  try {
    await runWeekendRosterNotification();
    return res.status(200).json({ ok: true });
  } catch (err) {
    console.error("[cron] weekend-roster failed:", err);
    return res.status(500).json({ error: "Cron job failed." });
  }
}
