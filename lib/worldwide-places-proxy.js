const PLACES_URL = "https://places.googleapis.com/v1/places:searchText";
const AUTH_CHECK_URL = "https://www.sahjony.com/api/connect/worldwide/auth-check";
const FIELD_MASK = [
  "places.id", "places.displayName", "places.formattedAddress", "places.websiteUri",
  "places.nationalPhoneNumber", "places.internationalPhoneNumber", "places.googleMapsUri",
  "places.primaryType", "places.businessStatus", "places.rating", "places.userRatingCount",
].join(",");

function safePlace(place) {
  const display = place && place.displayName;
  return {
    place_id: place?.id || null,
    name: display && typeof display === "object" ? display.text || null : null,
    address: place?.formattedAddress || null,
    website: place?.websiteUri || null,
    phone: place?.internationalPhoneNumber || place?.nationalPhoneNumber || null,
    google_maps_url: place?.googleMapsUri || null,
    primary_type: place?.primaryType || null,
    business_status: place?.businessStatus || null,
    rating: place?.rating ?? null,
    user_rating_count: place?.userRatingCount ?? null,
  };
}

export async function worldwidePlacesProxy(req, res) {
  res.setHeader("Cache-Control", "no-store");
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  const authorization = String(req.headers.authorization || "");
  if (!authorization.startsWith("Bearer ")) return res.status(401).json({ error: "Owner authorization required" });

  try {
    const auth = await fetch(AUTH_CHECK_URL, {
      method: "POST",
      headers: { Authorization: authorization },
      signal: AbortSignal.timeout(8000),
    });
    if (!auth.ok) return res.status(auth.status === 403 ? 403 : 401).json({ error: "Owner authorization failed" });
  } catch {
    return res.status(502).json({ error: "Owner authorization service unavailable" });
  }

  const apiKey = String(process.env.GOOGLE_PLACES_API_KEY || "").trim();
  if (!apiKey) return res.status(503).json({ error: "Google Places is not configured" });

  const input = req.body && typeof req.body === "object" ? req.body : {};
  const query = String(input.query || "").trim().slice(0, 240);
  const limit = Math.max(1, Math.min(20, Number(input.limit || 10)));
  const languageCode = String(input.language_code || "en").slice(0, 12);
  const regionCode = String(input.region_code || "US").toUpperCase().slice(0, 2);
  if (query.length < 3) return res.status(400).json({ error: "query must contain at least 3 characters" });

  let upstream;
  try {
    upstream = await fetch(PLACES_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Goog-Api-Key": apiKey,
        "X-Goog-FieldMask": FIELD_MASK,
      },
      body: JSON.stringify({ textQuery: query, pageSize: limit, languageCode, regionCode }),
      signal: AbortSignal.timeout(20000),
    });
  } catch {
    return res.status(502).json({ error: "Google Places transport failed" });
  }
  if (!upstream.ok) return res.status(502).json({ error: `Google Places request failed with HTTP ${upstream.status}` });

  let payload;
  try { payload = await upstream.json(); } catch { return res.status(502).json({ error: "Google Places returned a non-JSON response" }); }
  const results = (Array.isArray(payload.places) ? payload.places : [])
    .map(safePlace).filter((x) => x.place_id && x.name).slice(0, limit);
  return res.status(200).json({
    status: "ok", provider: "google_places", query, result_count: results.length,
    usable_results: results.length > 0, results, api_key_exposed: false,
  });
}
