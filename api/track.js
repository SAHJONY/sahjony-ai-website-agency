// GET|POST /api/track?slug=...  — PUBLIC analytics beacon.
// Increments a per-site view counter in Upstash (fda:views:<slug>). Read-only to
// the rest of the store; slug is sanitized so it can't touch other keys.
function cleanSlug(s) { return String(s || "").toLowerCase().replace(/[^a-z0-9-]/g, "").slice(0, 60); }

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  if (req.method === "OPTIONS") return res.status(200).end();

  const slug = cleanSlug(req.query.slug);
  const url = process.env.UPSTASH_REDIS_REST_URL;
  const token = process.env.UPSTASH_REDIS_REST_TOKEN;
  if (slug && url && token) {
    try {
      await fetch(url.replace(/\/$/, "") + "/incr/" + encodeURIComponent("fda:views:" + slug), {
        headers: { Authorization: "Bearer " + token },
      });
    } catch (_) { /* best-effort */ }
  }
  // 1x1 transparent gif so it can also be used as an <img> beacon.
  res.status(200).setHeader("content-type", "image/gif");
  res.setHeader("cache-control", "no-store");
  res.end(Buffer.from("R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7", "base64"));
}
