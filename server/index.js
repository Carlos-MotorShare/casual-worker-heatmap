import express from "express";
import cors from "cors";

const app = express();

app.use(cors());
app.use(express.json({ limit: "2mb" }));

/** @type {null | {generatedAt: string, days: Array<{date: string, pickups: number, dropoffs: number, carsToWash: number, staffAway: number}>}} */
let latestPayload = null;

/** @type {Set<import("express").Response>} */
const sseClients = new Set();

function sseSend(res, event, data) {
  if (event) res.write(`event: ${event}\n`);
  res.write(`data: ${JSON.stringify(data)}\n\n`);
}

function broadcast(event, data) {
  for (const res of sseClients) {
    try {
      sseSend(res, event, data);
    } catch {
      sseClients.delete(res);
    }
  }
}

app.post("/api/airtable", (req, res) => {
  latestPayload = req.body ?? null;

  const generatedAt =
    latestPayload && typeof latestPayload.generatedAt === "string"
      ? latestPayload.generatedAt
      : "(missing generatedAt)";
  const daysCount = Array.isArray(latestPayload?.days) ? latestPayload.days.length : 0;

  console.log(`[airtable] received payload generatedAt=${generatedAt} days=${daysCount}`);

  if (latestPayload) {
    broadcast("data", latestPayload);
  }

  res.status(200).json({ ok: true });
});

app.get("/api/data", (_req, res) => {
  if (!latestPayload) {
    return res.status(404).json({ error: "No data received yet." });
  }
  return res.status(200).json(latestPayload);
});

app.get("/api/stream", (req, res) => {
  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");
  res.setHeader("X-Accel-Buffering", "no");

  // Send an initial event so clients know they’re connected.
  sseSend(res, "connected", { ok: true });
  if (latestPayload) {
    sseSend(res, "data", latestPayload);
  }

  // Flush headers immediately (helps some proxies/browsers).
  res.flushHeaders?.();

  sseClients.add(res);

  req.on("close", () => {
    sseClients.delete(res);
  });
});

const port = process.env.PORT || 3001;
app.listen(port, () => {
  console.log(`Server listening on http://localhost:${port}`);
});

