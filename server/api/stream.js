export default function handler(req, res) {
  if (req.method !== "GET") {
    return res.status(405).json({ error: "Method Not Allowed" });
  }

  return res.status(410).json({
    error: "SSE endpoint deprecated. Use /api/data instead.",
  });
}
