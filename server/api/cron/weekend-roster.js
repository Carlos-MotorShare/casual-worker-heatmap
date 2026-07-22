import { runWeekendRosterNotification } from "../../services/notifications.js";

export default async function handler(req, res) {
  const auth = req.headers.authorization;

  if (auth !== `Bearer ${process.env.CRON_SECRET}`) {
    return res.status(401).json({ error: "Unauthorized" });
  }

  console.log("[cron] weekend-roster triggered:", new Date().toISOString());

  try {
    await runWeekendRosterNotification();
    return res.status(200).json({ ok: true });
  } catch (err) {
    console.error("[cron] weekend-roster failed:", err);
    return res.status(500).json({ error: "Cron job failed." });
  }
}