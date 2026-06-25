// POST /api/leads-find  { lat, lng, keyword?, radius? }  — owner-only.
// Finds nearby local businesses via the Places API (NEW) and flags those with
// no website (your best prospects). Requires GOOGLE_PLACES_API_KEY.
//
// Uses Text Search (New): POST https://places.googleapis.com/v1/places:searchText
// with X-Goog-Api-Key + X-Goog-FieldMask. One call returns name/address/phone/
// website/rating — no per-place detail lookups. The legacy /maps/api/place
// endpoints are NOT available to new Google Cloud projects, so we use New.

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

  const textQuery = keyword || "local business";
  try {
    const r = await fetch("https://places.googleapis.com/v1/places:searchText", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "X-Goog-Api-Key": key,
        // Field mask is REQUIRED by the New API; it also bounds billing/SKU.
        "X-Goog-FieldMask": "places.id,places.displayName,places.formattedAddress,places.nationalPhoneNumber,places.websiteUri,places.rating",
      },
      body: JSON.stringify({
        textQuery,
        maxResultCount: 12,
        locationBias: { circle: { center: { latitude: lat, longitude: lng }, radius } },
      }),
    });
    const j = await r.json();
    if (!r.ok) {
      const msg = (j && j.error && (j.error.message || j.error.status)) || ("HTTP " + r.status);
      return res.status(502).json({ error: "Places error: " + msg });
    }

    const leads = (j.places || []).map((p) => ({
      name: (p.displayName && p.displayName.text) || "(unnamed)",
      address: p.formattedAddress || "",
      phone: p.nationalPhoneNumber || "",
      website: p.websiteUri || "",
      needsSite: !p.websiteUri,
      rating: p.rating || null,
      placeId: p.id,
    }));

    // Best prospects first (no website).
    leads.sort((a, b) => (a.needsSite === b.needsSite ? 0 : a.needsSite ? -1 : 1));
    return res.status(200).json({ leads });
  } catch (e) {
    return res.status(500).json({ error: e.message || "Request failed" });
  }
}
