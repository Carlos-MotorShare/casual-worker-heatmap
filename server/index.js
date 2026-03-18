import express from "express";
import cors from "cors";

const app = express();

app.use(cors());
app.use(express.json({ limit: "2mb" }));

/** @type {null | {generatedAt: string, days: Array<{date: string, pickups: number, dropoffs: number, carsToWash: number, staffAway: number}>}} */
let latestPayload = null;

app.post("/api/airtable", (req, res) => {
  latestPayload = req.body ?? null;

  const generatedAt =
    latestPayload && typeof latestPayload.generatedAt === "string"
      ? latestPayload.generatedAt
      : "(missing generatedAt)";
  const daysCount = Array.isArray(latestPayload?.days) ? latestPayload.days.length : 0;

  console.log(`[airtable] received payload generatedAt=${generatedAt} days=${daysCount}`);

  res.status(200).json({ ok: true });
});

app.get("/api/data", (_req, res) => {
  if (!latestPayload) {
    return res.status(404).json({ error: "No data received yet." });
  }
  return res.status(200).json(latestPayload);
});

const port = 3001;
app.listen(port, () => {
  console.log(`Server listening on http://localhost:${port}`);
});

