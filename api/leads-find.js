// POST /api/leads-find  { lat, lng, keyword?, radius? }  — owner-only.
// Finds nearby local businesses via Google Places and flags those with no
// website (your best prospects). Requires GOOGLE_PLACES_API_KEY.

async function loadSecrets() {
  const url = process.env.UPSTASH_REDIS_REST_URL, token = process.env.UPSTASH_REDIS_REST_TOKEN;
  if (!url || !token) return {};
  try {
    const r = await fetch(url.replace(/\/$/, "") + "/get/" + encodeURIComponent("fda:secrets"), { headers: { Authorization: "Bearer " + token } });
    const j = await r.json();
    if (j && j.result) { try { return JSON.parse(j.result) || {}; } catch { return {}; } }
  } catch (_) {}
  return {};
}

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, x-admin-token");
  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST") return res.status(405).json({ error: "Use POST" });

  const admin = process.env.ADMIN_PASSWORD;
  if (admin && req.headers["x-admin-token"] !== admin) return res.status(401).json({ error: "Unauthorized." });

  const secrets = await loadSecrets();
  const key = process.env.GOOGLE_PLACES_API_KEY || secrets.GOOGLE_PLACES_API_KEY;
  if (!key) return res.status(500).json({ error: "Set GOOGLE_PLACES_API_KEY to use the lead finder." });

  let body = req.body;
  if (typeof body === "string") { try { body = JSON.parse(body); } catch { body = {}; } }
  body = body || {};
  const lat = Number(body.lat), lng = Number(body.lng);
  if (!isFinite(lat) || !isFinite(lng)) return res.status(400).json({ error: "lat and lng are required." });
  const keyword = String(body.keyword || "").slice(0, 60);
  const radius = Math.min(50000, Math.max(500, Number(body.radius) || 4000));

  try {
    const near = `https://maps.googleapis.com/maps/api/place/nearbysearch/json?location=${lat},${lng}&radius=${radius}${keyword ? "&keyword=" + encodeURIComponent(keyword) : ""}&key=${key}`;
    const r = await fetch(near);
    const j = await r.json();
    if (j.status && j.status !== "OK" && j.status !== "ZERO_RESULTS") {
      return res.status(502).json({ error: "Places error: " + j.status + (j.error_message ? " — " + j.error_message : "") });
    }
    const places = (j.results || []).slice(0, 12);

    // Enrich with phone + website to flag who has no site.
    const leads = await Promise.all(places.map(async (p) => {
      let phone = "", website = "", address = p.vicinity || "";
      try {
        const d = await fetch(`https://maps.googleapis.com/maps/api/place/details/json?place_id=${p.place_id}&fields=formatted_phone_number,website,formatted_address&key=${key}`);
        const dj = await d.json();
        const r2 = dj.result || {};
        phone = r2.formatted_phone_number || "";
        website = r2.website || "";
        address = r2.formatted_address || address;
      } catch (_) {}
      return { name: p.name, address, phone, website, needsSite: !website, rating: p.rating || null, placeId: p.place_id };
    }));

    // Best prospects first (no website).
    leads.sort((a, b) => (a.needsSite === b.needsSite ? 0 : a.needsSite ? -1 : 1));
    return res.status(200).json({ leads });
  } catch (e) {
    return res.status(500).json({ error: e.message || "Request failed" });
  }
}
