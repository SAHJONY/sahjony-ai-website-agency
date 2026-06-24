// GET /api/site?slug=...   (mapped to /s/:slug)  — PUBLIC.
// Serves a published website's HTML. Read-only; can ONLY read fda:site:<slug>
// (slug is sanitized), so it can't reach any other stored key.

function cleanSlug(s) { return String(s || "").toLowerCase().replace(/[^a-z0-9-]/g, "").slice(0, 60); }

export default async function handler(req, res) {
  const slug = cleanSlug(req.query.slug);
  const notFound = (msg) => {
    res.status(404).setHeader("content-type", "text/html; charset=utf-8");
    res.end(`<!doctype html><meta charset="utf-8"><title>Not found</title><body style="font-family:system-ui;background:#0d0d12;color:#f0eef2;display:grid;place-items:center;height:100vh;margin:0;text-align:center"><div><h1 style="font-size:48px;margin:0">404</h1><p style="color:#aaa7b5">${msg || "This site isn't published."}</p><a href="/" style="color:#ff8366">← frontdeskagents.com</a></div></body>`);
  };

  if (!slug) return notFound("No site specified.");
  const url = process.env.UPSTASH_REDIS_REST_URL;
  const token = process.env.UPSTASH_REDIS_REST_TOKEN;
  if (!url || !token) return notFound("Storage not configured.");

  try {
    const r = await fetch(url.replace(/\/$/, "") + "/get/" + encodeURIComponent("fda:site:" + slug), {
      headers: { Authorization: "Bearer " + token },
    });
    const j = await r.json();
    if (!j || !j.result) return notFound();
    let rec;
    try { rec = JSON.parse(j.result); } catch { return notFound(); }
    if (!rec || !rec.html) return notFound();

    res.status(200);
    res.setHeader("content-type", "text/html; charset=utf-8");
    res.setHeader("cache-control", "public, max-age=60");
    res.end(rec.html);
  } catch (e) {
    return notFound("Temporarily unavailable.");
  }
}
