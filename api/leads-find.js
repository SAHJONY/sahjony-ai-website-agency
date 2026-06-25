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

// Pull the first plausible contact email out of HTML (prefer mailto: links).
function extractEmail(html) {
  const out = [];
  const mailto = html.match(/mailto:([^"'?>\s]+@[^"'?>\s]+)/i);
  if (mailto) out.push(mailto[1]);
  const found = html.match(/[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g) || [];
  out.push(...found);
  for (const c of out) {
    const e = c.toLowerCase().trim().replace(/[.,;]+$/, "");
    if (/\.(png|jpe?g|gif|webp|svg|css|js|ico)$/.test(e)) continue;        // asset filenames
    if (/(example|sentry|wixpress|\.wix|@2x|@3x|sentry\.io|godaddy|squarespace|yourdomain|domain\.com|email@|name@|user@)/.test(e)) continue;
    return e;
  }
  return "";
}

// Fetch a site (homepage, then /contact) and extract a contact email. Bounded so
// a slow site can't hang the request.
async function scrapeEmail(website) {
  const grab = async (u) => {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), 3500);
    try {
      const r = await fetch(u, { signal: ctrl.signal, redirect: "follow", headers: { "user-agent": "Mozilla/5.0 (compatible; FrontDeskLeadBot/1.0)" } });
      if (!r.ok) return "";
      return extractEmail((await r.text()).slice(0, 500000));
    } catch (_) { return ""; } finally { clearTimeout(t); }
  };
  let email = await grab(website);
  if (!email) { try { email = await grab(new URL(website).origin + "/contact"); } catch (_) {} }
  return email;
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
  const hasGeo = isFinite(lat) && isFinite(lng);
  const locationText = String(body.locationText || "").slice(0, 120).trim();
  if (!hasGeo && !locationText) {
    return res.status(400).json({ error: "Provide either lat/lng or a locationText (city/area)." });
  }
  const keyword = String(body.keyword || "").slice(0, 60);
  const radius = Math.min(50000, Math.max(500, Number(body.radius) || 4000));

  // With GPS we bias by a circle; without it we put the location in the query
  // text (e.g. "barbershop in Houston, TX") so the finder still works.
  const baseTerm = keyword || "local business";
  const textQuery = hasGeo ? baseTerm : `${baseTerm} in ${locationText}`;
  const reqBody = { textQuery, maxResultCount: 12 };
  if (hasGeo) reqBody.locationBias = { circle: { center: { latitude: lat, longitude: lng }, radius } };

  try {
    const r = await fetch("https://places.googleapis.com/v1/places:searchText", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "X-Goog-Api-Key": key,
        // Field mask is REQUIRED by the New API; it also bounds billing/SKU.
        "X-Goog-FieldMask": "places.id,places.displayName,places.formattedAddress,places.nationalPhoneNumber,places.internationalPhoneNumber,places.websiteUri,places.googleMapsUri,places.businessStatus,places.rating,places.userRatingCount",
      },
      body: JSON.stringify(reqBody),
    });
    const j = await r.json();
    if (!r.ok) {
      const msg = (j && j.error && (j.error.message || j.error.status)) || ("HTTP " + r.status);
      return res.status(502).json({ error: "Places error: " + msg });
    }

    const leads = (j.places || []).map((p) => ({
      name: (p.displayName && p.displayName.text) || "(unnamed)",
      address: p.formattedAddress || "",
      phone: p.nationalPhoneNumber || p.internationalPhoneNumber || "",
      email: "",                                  // filled below by scraping the site
      website: p.websiteUri || "",
      mapsUrl: p.googleMapsUri || "",
      status: p.businessStatus || "",
      needsSite: !p.websiteUri,
      rating: p.rating || null,
      reviews: p.userRatingCount || 0,
      placeId: p.id,
    }));

    // Google doesn't expose emails, so scrape one from each lead's own site
    // (best-effort, in parallel). No-website prospects simply won't have one.
    await Promise.all(leads.map(async (l) => {
      if (l.website) { try { l.email = await scrapeEmail(l.website); } catch (_) {} }
    }));

    // Best prospects first (no website).
    leads.sort((a, b) => (a.needsSite === b.needsSite ? 0 : a.needsSite ? -1 : 1));
    return res.status(200).json({ leads });
  } catch (e) {
    return res.status(500).json({ error: e.message || "Request failed" });
  }
}
