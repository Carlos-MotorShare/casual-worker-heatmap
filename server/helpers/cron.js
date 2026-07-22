/** Verify Vercel cron secret so only Vercel can invoke these endpoints. */
export function verifyCronSecret(req, res) {
  const secret = process.env.CRON_SECRET;
  if (secret && req.headers.authorization !== `Bearer ${secret}`) {
    res.status(401).json({ error: "Unauthorized" });
    return false;
  }
  return true;
}
