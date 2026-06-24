// /api/data?key=...   GET -> read,  POST (json body) -> write
// Server-side proxy to Upstash Redis (REST). The Upstash token lives ONLY on the
// server, never in the browser. Stores one JSON blob per key.
//
// AUTH: this endpoint is owner-only. When ADMIN_PASSWORD is set, every request
// must send a matching `x-admin-token` header (the dashboard does this after
// login). Public visitors never touch this — the contact form writes through the
// separate, write-only /api/contact path instead.

function sanitizeKey(k) {
  return String(k || "fda:default").replace(/[^a-zA-Z0-9:_-]/g, "_").slice(0, 120);
}

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, x-admin-token");
  if (req.method === "OPTIONS") return res.status(200).end();

  // Owner login (formerly /api/login, rewritten here as ?action=login in
  // vercel.json — merged to stay under the Hobby 12-function limit). Handled
  // BEFORE the owner-gate below, since this is how the dashboard gets its token.
  if (req.query && req.query.action === "login") {
    if (req.method !== "POST") return res.status(405).json({ error: "Use POST" });
    const adminPw = process.env.ADMIN_PASSWORD;
    if (!adminPw) return res.status(200).json({ ok: true, noPassword: true });
    let b = req.body;
    if (typeof b === "string") { try { b = JSON.parse(b); } catch { b = {}; } }
    if (b && b.password === adminPw) return res.status(200).json({ ok: true });
    return res.status(401).json({ ok: false, error: "Wrong password" });
  }

  // Owner-only gate. If no password is configured, stay open (app still works).
  const admin = process.env.ADMIN_PASSWORD;
  if (admin && req.headers["x-admin-token"] !== admin) {
    return res.status(401).json({ error: "Unauthorized. Log in to the dashboard." });
  }

  const url = process.env.UPSTASH_REDIS_REST_URL;
  const token = process.env.UPSTASH_REDIS_REST_TOKEN;
  if (!url || !token) {
    return res.status(500).json({ error: "Upstash env vars (UPSTASH_REDIS_REST_URL / UPSTASH_REDIS_REST_TOKEN) are not configured." });
  }
  const auth = { Authorization: "Bearer " + token };
  const base = url.replace(/\/$/, "");
  const key = sanitizeKey(req.query.key);

  // Never expose API keys through this endpoint — secrets live behind /api/secrets.
  if (/secret/i.test(key)) {
    return res.status(403).json({ error: "Forbidden key. Manage secrets via /api/secrets." });
  }

  try {
    if (req.method === "GET") {
      const r = await fetch(`${base}/get/${encodeURIComponent(key)}`, { headers: auth });
      const j = await r.json();
      let value = null;
      if (j && j.result) {
        try { value = JSON.parse(j.result); } catch { value = j.result; }
      }
      return res.status(200).json({ key, value });
    }

    if (req.method === "POST") {
      let body = req.body;
      if (typeof body === "string") {
        try { body = JSON.parse(body); } catch { body = {}; }
      }
      const payload = JSON.stringify(body == null ? {} : body);
      const r = await fetch(`${base}/set/${encodeURIComponent(key)}`, {
        method: "POST",
        headers: { ...auth, "content-type": "text/plain" },
        body: payload,
      });
      if (!r.ok) {
        const t = await r.text();
        return res.status(502).json({ error: "Upstash write failed: " + t });
      }
      return res.status(200).json({ ok: true, key });
    }

    return res.status(405).json({ error: "Use GET or POST" });
  } catch (e) {
    return res.status(500).json({ error: e.message || "Request failed" });
  }
}
