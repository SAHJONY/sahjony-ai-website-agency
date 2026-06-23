// /api/data?key=...   GET -> read,  POST (json body) -> write
// Server-side proxy to Upstash Redis (REST). The Upstash token lives ONLY on the
// server, never in the browser. Stores one JSON blob per key.

function sanitizeKey(k) {
  return String(k || "fda:default").replace(/[^a-zA-Z0-9:_-]/g, "_").slice(0, 120);
}

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  if (req.method === "OPTIONS") return res.status(200).end();

  const url = process.env.UPSTASH_REDIS_REST_URL;
  const token = process.env.UPSTASH_REDIS_REST_TOKEN;
  if (!url || !token) {
    return res.status(500).json({ error: "Upstash env vars (UPSTASH_REDIS_REST_URL / UPSTASH_REDIS_REST_TOKEN) are not configured." });
  }
  const auth = { Authorization: "Bearer " + token };
  const base = url.replace(/\/$/, "");
  const key = sanitizeKey(req.query.key);

  // Never expose API keys through this open endpoint — secrets live behind /api/secrets.
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
