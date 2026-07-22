import { handleCors } from "../../../helpers/cors.js";

export default async function handler(req, res) {
  if (handleCors(req, res)) return;
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method Not Allowed" });
  }

  const { vehicleName, timestamp } = req.body;

  try {
    await fetch("https://hooks.airtable.com/workflows/v1/genericWebhook/apprkS2KIK9UVyF14/wfli6NJF5p9Kcu9Dk/wtr36Ftt2QXX3pBwl", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ vehicleName, timestamp }),
    });
    return res.json({ ok: true });
  } catch (error) {
    console.error("Webhook error:", error);
    return res.status(500).json({ error: error.message });
  }
}
