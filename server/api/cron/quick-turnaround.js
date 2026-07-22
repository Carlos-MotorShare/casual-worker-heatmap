import { runQuickTurnaroundNotification } from "../../index.js";

export default async function handler(req, res) {
    if (req.headers.authorization !== `Bearer ${process.env.CRON_SECRET}`) {
        return res.status(401).end();
    }

    try {
        await runQuickTurnaroundNotification();
        res.status(200).json({ ok: true });
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: "Failed" });
    }
}