import { verifyCronSecret } from "../../helpers/cron.js";
import { runQuickTurnaroundNotification } from "../../helpers/notifications.js";

export default async function handler(req, res) {
    if (req.method !== "GET") {
        return res.status(405).json({ error: "Method Not Allowed" });
    }
    if (!verifyCronSecret(req, res)) return;

    try {
        await runQuickTurnaroundNotification();
        res.status(200).json({ ok: true });
    } catch (err) {
        console.error("[cron] quick-turnaround failed:", err);
        return res.status(500).json({ error: "Cron job failed." });
    }
}
