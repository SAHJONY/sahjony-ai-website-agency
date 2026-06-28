// POST /api/leads-find  — owner-only. Two modes (one Google Places function,
// to stay under the Hobby 12-function limit). Requires GOOGLE_PLACES_API_KEY.
//
//   1. NEARBY (lead finder):  { lat, lng, keyword?, radius? } | { locationText }
//      -> { leads: [...] }  — nearby businesses, no-website prospects first.
//
//   2. LOOKUP (autonomous builder):  { lookup:true, name, address }
//      -> { business: {...} }  — researches ONE named business and returns its
//      type, city, phone, website, hours, rating, reviews, summary + a scraped
//      email/about, so the builder can design a full site from just name+address.
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

// Pull a short "about" blurb out of HTML (meta description / og:description, then
// the first substantial <p>). Used to feed the AI real copy from the client's
// existing site instead of inventing it.
function extractAbout(html) {
  const meta =
    html.match(/<meta[^>]+name=["']description["'][^>]+content=["']([^"']{20,})["']/i) ||
    html.match(/<meta[^>]+content=["']([^"']{20,})["'][^>]+name=["']description["']/i) ||
    html.match(/<meta[^>]+property=["']og:description["'][^>]+content=["']([^"']{20,})["']/i);
  if (meta) return meta[1].replace(/\s+/g, " ").trim().slice(0, 500);
  const p = html.match(/<p[^>]*>([\s\S]*?)<\/p>/gi) || [];
  for (const block of p) {
    const text = block.replace(/<[^>]+>/g, " ").replace(/&[a-z#0-9]+;/gi, " ").replace(/\s+/g, " ").trim();
    if (text.length >= 60) return text.slice(0, 500);
  }
  return "";
}

// Resolve a possibly-relative URL against a base; "" if it can't be parsed.
function absUrl(base, u) { try { return new URL(u, base).href; } catch (_) { return ""; } }

// Find the client's social-media profile links in their site HTML (first per platform).
function extractSocial(html) {
  const social = {};
  const want = [
    ["facebook", /(?:facebook|fb)\.com\/(?!sharer|plugins|tr\b|dialog)/i],
    ["instagram", /instagram\.com\/(?!p\/|reel\/)/i],
    ["tiktok", /tiktok\.com\/@/i],
    ["youtube", /(?:youtube\.com\/(?:channel\/|c\/|user\/|@)|youtu\.be\/)/i],
    ["x", /(?:twitter\.com|x\.com)\/(?!intent|share|home)/i],
    ["linkedin", /linkedin\.com\/(?:company|in|school)\//i],
    ["whatsapp", /(?:wa\.me\/|api\.whatsapp\.com\/send)/i],
  ];
  const re = /https?:\/\/[^"'\s)<>]+/gi;
  let m;
  while ((m = re.exec(html))) {
    const url = m[0].replace(/[\\"'<>].*$/, "");
    for (const [k, rx] of want) { if (!social[k] && rx.test(url)) social[k] = url; }
  }
  return social;
}

// Pull images / videos / audio out of the site HTML (bounded, deduped, absolute).
function extractSiteMedia(html, base) {
  const images = [], videos = [], audios = [];
  const og = html.match(/<meta[^>]+property=["']og:image["'][^>]+content=["']([^"']+)["']/i);
  if (og) { const u = absUrl(base, og[1]); if (u) images.push(u); }
  let m, re = /<img[^>]+src=["']([^"']+)["']/gi;
  while ((m = re.exec(html)) && images.length < 8) {
    const u = absUrl(base, m[1]);
    if (!u || /^data:/.test(u)) continue;
    if (/\.(svg|gif)(\?|$)/i.test(u)) continue;
    if (/(sprite|icon|logo|favicon|pixel|spacer|blank|1x1|placeholder|avatar|badge|loader)/i.test(u)) continue;
    if (!images.includes(u)) images.push(u);
  }
  re = /https?:\/\/[^"'\s)<>]+/gi;
  while ((m = re.exec(html))) {
    const u = m[0].replace(/[\\"'<>].*$/, "");
    if (videos.length < 2 && /(youtube\.com\/watch|youtu\.be\/|player\.vimeo\.com|vimeo\.com\/\d+|\.mp4(\?|$))/i.test(u) && !videos.includes(u)) videos.push(u);
    if (audios.length < 1 && /\.(mp3|m4a)(\?|$)/i.test(u) && !audios.includes(u)) audios.push(u);
  }
  return { images, videos, audios };
}

// Fetch a client's existing site and extract { email, about, social, images,
// videos, audios } in one bounded pass.
async function scrapeSite(website) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), 5000);
  try {
    const r = await fetch(website, { signal: ctrl.signal, redirect: "follow", headers: { "user-agent": "Mozilla/5.0 (compatible; FrontDeskLeadBot/1.0)" } });
    if (!r.ok) return { email: "", about: "", social: {}, images: [], videos: [], audios: [] };
    const base = r.url || website;
    const html = (await r.text()).slice(0, 800000);
    let email = extractEmail(html);
    if (!email) { try { email = await scrapeEmail(new URL(base).origin + "/contact"); } catch (_) {} }
    const media = extractSiteMedia(html, base);
    return { email, about: extractAbout(html), social: extractSocial(html), images: media.images, videos: media.videos, audios: media.audios };
  } catch (_) { return { email: "", about: "", social: {}, images: [], videos: [], audios: [] }; } finally { clearTimeout(t); }
}

// Resolve Google Places photo references to public CDN URLs (no key exposed to
// the browser). Each is one Places Photo call, so we cap how many we fetch.
async function placePhotoUrls(key, photos, max) {
  const list = (photos || []).slice(0, max || 6).filter((ph) => ph && ph.name);
  const results = await Promise.all(list.map(async (ph) => {
    try {
      const ctrl = new AbortController();
      const t = setTimeout(() => ctrl.abort(), 4000);
      const r = await fetch("https://places.googleapis.com/v1/" + ph.name + "/media?maxWidthPx=1280&skipHttpRedirect=true", { signal: ctrl.signal, headers: { "X-Goog-Api-Key": key } });
      clearTimeout(t);
      if (!r.ok) return "";
      const j = await r.json();
      return (j && j.photoUri) || "";
    } catch (_) { return ""; }
  }));
  return results.filter(Boolean);
}

// Humanize a Google Places type list ("hair_care","point_of_interest") -> "Hair care".
function humanizeType(types) {
  const SKIP = new Set(["point_of_interest", "establishment", "store", "food", "premise", "geocode", "health"]);
  const t = (types || []).find((x) => !SKIP.has(x)) || (types || [])[0] || "";
  if (!t) return "";
  return t.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

// Derive a "City, Region, Country" string from Places addressComponents, falling
// back to the tail of the formatted address.
function cityFrom(components, formatted) {
  const find = (type) => {
    const c = (components || []).find((x) => (x.types || []).includes(type));
    return c ? (c.longText || c.shortText || "") : "";
  };
  const locality = find("locality") || find("postal_town") || find("sublocality");
  const region = find("administrative_area_level_1");
  const country = find("country");
  const parts = [locality, region, country].filter(Boolean);
  if (parts.length) return parts.join(", ");
  // Fallback: middle of the formatted address (drop the street line and zip line).
  const segs = String(formatted || "").split(",").map((s) => s.trim()).filter(Boolean);
  return segs.length > 2 ? segs.slice(1).join(", ") : (segs[segs.length - 1] || "");
}

// LOOKUP mode: research one named business and return enriched details.
async function lookupBusiness(key, name, address, res) {
  const textQuery = [name, address].filter(Boolean).join(", ");
  let j;
  try {
    const r = await fetch("https://places.googleapis.com/v1/places:searchText", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "X-Goog-Api-Key": key,
        "X-Goog-FieldMask": "places.id,places.displayName,places.formattedAddress,places.addressComponents,places.primaryTypeDisplayName,places.types,places.nationalPhoneNumber,places.internationalPhoneNumber,places.websiteUri,places.googleMapsUri,places.businessStatus,places.rating,places.userRatingCount,places.regularOpeningHours,places.editorialSummary,places.reviews,places.location,places.photos",
      },
      body: JSON.stringify({ textQuery, maxResultCount: 10 }),
    });
    j = await r.json();
    if (!r.ok) {
      const msg = (j && j.error && (j.error.message || j.error.status)) || ("HTTP " + r.status);
      return res.status(502).json({ error: "Places error: " + msg });
    }
  } catch (e) {
    return res.status(500).json({ error: e.message || "Lookup request failed" });
  }

  const all = j.places || [];
  const p = all[0];
  if (!p) {
    return res.status(404).json({ error: "No matching business found on Google. Check the name & address, or build manually." });
  }

  // Multi-location: keep every returned place whose name matches the same brand
  // (a chain often has several branches). Each place already carries its own
  // address/phone/hours from the field mask — no extra calls needed.
  const norm = (s) => String(s || "").toLowerCase().replace(/[^a-z0-9]+/g, "");
  const brand = norm((p.displayName && p.displayName.text) || name);
  const matches = all.filter((x) => {
    const xn = norm(x.displayName && x.displayName.text);
    return xn.length >= 3 && (xn.includes(brand) || brand.includes(xn));
  });
  const locations = (matches.length > 1 ? matches : []).map((x) => ({
    name: (x.displayName && x.displayName.text) || "",
    address: x.formattedAddress || "",
    phone: x.nationalPhoneNumber || x.internationalPhoneNumber || "",
    hours: (x.regularOpeningHours && x.regularOpeningHours.weekdayDescriptions) || [],
    mapsUrl: x.googleMapsUri || "",
    rating: x.rating || null,
    reviewsCount: x.userRatingCount || 0,
    lat: (x.location && x.location.latitude) || null,
    lng: (x.location && x.location.longitude) || null,
  }));

  const business = {
    name: (p.displayName && p.displayName.text) || name,
    type: (p.primaryTypeDisplayName && p.primaryTypeDisplayName.text) || humanizeType(p.types) || "local business",
    address: p.formattedAddress || address,
    city: cityFrom(p.addressComponents, p.formattedAddress),
    phone: p.nationalPhoneNumber || p.internationalPhoneNumber || "",
    website: p.websiteUri || "",
    mapsUrl: p.googleMapsUri || "",
    status: p.businessStatus || "",
    rating: p.rating || null,
    reviewsCount: p.userRatingCount || 0,
    summary: (p.editorialSummary && p.editorialSummary.text) || "",
    hours: (p.regularOpeningHours && p.regularOpeningHours.weekdayDescriptions) || [],
    reviews: (p.reviews || []).slice(0, 4).map((rv) => ({
      text: (rv.text && rv.text.text) || rv.originalText && rv.originalText.text || "",
      author: (rv.authorAttribution && rv.authorAttribution.displayName) || "",
      rating: rv.rating || null,
    })).filter((rv) => rv.text),
    lat: (p.location && p.location.latitude) || null,
    lng: (p.location && p.location.longitude) || null,
    email: "",
    about: "",
    social: {},          // facebook / instagram / tiktok / youtube / x / linkedin / whatsapp
    photos: [],          // real gallery/hero images (Google photos first, site images next)
    video: "",
    audio: "",
    locations,           // every branch when the business has more than one location
  };

  // Fetch real photos from Google + scrape the business's own site for an email,
  // about copy, social links and any embedded media. Run both in parallel so the
  // request stays well under the function budget.
  const [googlePhotos, site] = await Promise.all([
    placePhotoUrls(key, p.photos, 6).catch(() => []),
    business.website ? scrapeSite(business.website).catch(() => null) : Promise.resolve(null),
  ]);
  const photos = [];
  for (const u of [...(googlePhotos || []), ...((site && site.images) || [])]) {
    if (u && !photos.includes(u)) photos.push(u);
  }
  business.photos = photos.slice(0, 8);
  if (site) {
    business.email = site.email || "";
    business.about = site.about || "";
    business.social = site.social || {};
    business.video = (site.videos && site.videos[0]) || "";
    business.audio = (site.audios && site.audios[0]) || "";
  }

  return res.status(200).json({ business });
}

// ---- Outdated-website detector ----------------------------------------------
// Fetch a prospect's own homepage and decide whether the site is outdated/poor
// enough to pitch a rebuild. Returns { reachable, outdated, staleness(0-100),
// reasons[] }. This is what lets the engine find not just no-website businesses
// but businesses whose site is old/broken.
const LEGACY_PATTERNS = [
  ["Flash content", /\.swf\b|application\/x-shockwave-flash|<embed[^>]+flash/i],
  ["Table-based layout", /<table[^>]*>[\s\S]*?<table/i],
  ["Deprecated <font>/<center> tags", /<font\b|<center\b|<marquee\b|<blink\b/i],
  ["FrontPage / legacy generator", /FrontPage|Microsoft Word|Dreamweaver|GeoCities|Joomla! 1\.|WordPress 3\.|WordPress 4\./i],
  ["Ancient jQuery", /jquery[-.]?1\.[0-9]+(\.[0-9]+)?(\.min)?\.js/i],
  ["XHTML/HTML4 doctype", /<!DOCTYPE\s+html\s+PUBLIC/i],
];
const BOOKING_HINTS = /(book|booking|schedule|appointment|reserve|reservation|order online|contact form|request a quote|get a quote|calendly|squareup|opentable|resy|acuity)/i;
const PARKED_HINTS = /(domain (is )?for sale|buy this domain|parked( free)?|godaddy\.com\/forsale|this domain is parked|under construction|coming soon|website coming soon|sedo\.com|hugedomains)/i;

async function auditSite(website) {
  const url = String(website || "").trim();
  if (!url) return { reachable: false, outdated: false, staleness: 100, reasons: ["No website on record"] };
  let finalUrl = url, html = "", ok = false;
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), 6000);
  try {
    const r = await fetch(url, { signal: ctrl.signal, redirect: "follow", headers: { "user-agent": "Mozilla/5.0 (compatible; FrontDeskLeadBot/1.0)" } });
    finalUrl = r.url || url; ok = r.ok;
    if (r.ok) html = (await r.text()).slice(0, 600000);
  } catch (_) { ok = false; } finally { clearTimeout(t); }

  if (!ok || html.length < 200) return { reachable: false, outdated: true, staleness: 95, reasons: [ok ? "Site returns almost no content" : "Website is unreachable / down"] };
  if (PARKED_HINTS.test(html)) return { reachable: true, outdated: true, staleness: 90, reasons: ["Parked / placeholder domain (no real site)"] };

  const reasons = [];
  let staleness = 0;
  const https = /^https:/i.test(finalUrl);
  if (!/<meta[^>]+name=["']viewport["']/i.test(html)) { staleness += 30; reasons.push("No mobile viewport (not responsive)"); }
  if (!https) { staleness += 15; reasons.push("No HTTPS / insecure"); }
  for (const [label, rx] of LEGACY_PATTERNS) { if (rx.test(html)) { staleness += 12; reasons.push(label); } }
  const yr = new Date().getUTCFullYear();
  const years = (html.match(/(?:©|&copy;|copyright)\s*(?:&copy;\s*)?((?:19|20)\d{2})/gi) || [])
    .map((m) => parseInt((m.match(/((?:19|20)\d{2})/) || [])[1] || "0", 10)).filter((y) => y >= 1995 && y <= yr);
  if (years.length) { const newest = Math.max(...years), age = yr - newest;
    if (age >= 4) { staleness += 20; reasons.push("Copyright last updated " + newest + " (" + age + "y old)"); }
    else if (age >= 2) { staleness += 10; reasons.push("Copyright " + newest); } }
  if (!/<meta[^>]+property=["']og:/i.test(html)) { staleness += 8; reasons.push("No Open Graph / social metadata"); }
  if (!BOOKING_HINTS.test(html)) { staleness += 10; reasons.push("No online booking / contact automation"); }
  const textLen = html.replace(/<script[\s\S]*?<\/script>/gi, "").replace(/<style[\s\S]*?<\/style>/gi, "").replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim().length;
  if (textLen < 600) { staleness += 10; reasons.push("Very little page content"); }
  staleness = Math.max(0, Math.min(100, staleness));
  const noViewport = !/<meta[^>]+name=["']viewport["']/i.test(html);
  return { reachable: true, outdated: noViewport || staleness >= 35, staleness, reasons };
}

// ---- Compact lead scorer (0-100) --------------------------------------------
const HOT_INDUSTRIES = /(dental|dentist|orthodont|legal|law|attorney|lawyer|medical|clinic|doctor|chiro|plumb|hvac|roof|electric|construction|landscap|pest|contractor|real estate|realtor|broker|auto|mechanic|repair|hotel|restaurant|salon|spa|insurance|account|consult|financial|advisor|veterinar)/i;
function scoreLead(o) {
  let s = 0; const why = [];
  if (o.needsSite) { s += 40; why.push("No website (+40)"); }
  else if (o.outdated) { s += Math.min(35, 15 + Math.round((o.staleness || 0) * 0.2)); why.push("Outdated site (+" + Math.min(35, 15 + Math.round((o.staleness || 0) * 0.2)) + ")"); }
  if (HOT_INDUSTRIES.test(String(o.industry || ""))) { s += 30; why.push("High-value industry (+30)"); }
  if ((o.reviews || 0) >= 25) { s += 15; why.push("Established (reviews) (+15)"); }
  else if ((o.reviews || 0) >= 5) { s += 8; }
  s = Math.max(0, Math.min(100, s));
  const tier = s >= 80 ? "hot" : s >= 60 ? "qualified" : s >= 40 ? "marketing" : "cold";
  return { score: s, tier, reasons: why };
}

// ---- Upstash KV (sweep cursor + discovered leads) ---------------------------
async function kv(getCmdPath) {
  const url = process.env.UPSTASH_REDIS_REST_URL, token = process.env.UPSTASH_REDIS_REST_TOKEN;
  if (!url || !token) return null;
  try {
    const r = await fetch(url.replace(/\/$/, "") + getCmdPath, { headers: { Authorization: "Bearer " + token } });
    if (!r.ok) return null;
    return await r.json();
  } catch (_) { return null; }
}
async function kvGetJson(key, fallback) {
  const j = await kv("/get/" + encodeURIComponent(key));
  if (j && j.result) { try { return JSON.parse(j.result); } catch { return fallback; } }
  return fallback;
}
async function kvSetJson(key, value) {
  const url = process.env.UPSTASH_REDIS_REST_URL, token = process.env.UPSTASH_REDIS_REST_TOKEN;
  if (!url || !token) return;
  try {
    await fetch(url.replace(/\/$/, "") + "/set/" + encodeURIComponent(key), {
      method: "POST", headers: { Authorization: "Bearer " + token, "content-type": "application/json" }, body: JSON.stringify(value),
    });
  } catch (_) {}
}

// ---- Worldwide autonomous sweep ---------------------------------------------
const METROS = [
  "New York, USA", "Los Angeles, USA", "Chicago, USA", "Houston, USA", "Miami, USA", "Toronto, Canada", "Mexico City, Mexico", "Monterrey, Mexico",
  "São Paulo, Brazil", "Buenos Aires, Argentina", "Bogotá, Colombia", "Lima, Peru", "Santiago, Chile",
  "London, UK", "Manchester, UK", "Madrid, Spain", "Barcelona, Spain", "Paris, France", "Berlin, Germany", "Rome, Italy", "Milan, Italy", "Amsterdam, Netherlands", "Lisbon, Portugal", "Warsaw, Poland",
  "Dubai, UAE", "Riyadh, Saudi Arabia", "Istanbul, Turkey", "Cairo, Egypt", "Lagos, Nigeria", "Nairobi, Kenya", "Johannesburg, South Africa", "Cape Town, South Africa",
  "Mumbai, India", "Delhi, India", "Bengaluru, India", "Singapore", "Bangkok, Thailand", "Jakarta, Indonesia", "Manila, Philippines", "Kuala Lumpur, Malaysia", "Ho Chi Minh City, Vietnam", "Tokyo, Japan", "Seoul, South Korea",
  "Sydney, Australia", "Melbourne, Australia", "Auckland, New Zealand",
];
const INDUSTRIES = ["dentist", "law firm", "plumber", "HVAC contractor", "roofing contractor", "electrician", "auto repair shop", "real estate agency", "hair salon", "med spa", "chiropractor", "landscaping company", "pest control", "restaurant", "veterinary clinic", "accounting firm", "insurance agency"];
const GRID = METROS.length * INDUSTRIES.length;
function cellAt(i) { i = ((i % GRID) + GRID) % GRID; return { location: METROS[Math.floor(i / INDUSTRIES.length)], industry: INDUSTRIES[i % INDUSTRIES.length] }; }

// One paginated Places text search (≈20/page via nextPageToken).
async function searchTextPaged(key, textQuery, maxPages) {
  const out = []; let pageToken;
  for (let page = 0; page < Math.max(1, maxPages); page++) {
    const body = { textQuery, maxResultCount: 20 };
    if (pageToken) body.pageToken = pageToken;
    let j;
    try {
      const r = await fetch("https://places.googleapis.com/v1/places:searchText", {
        method: "POST",
        headers: { "content-type": "application/json", "X-Goog-Api-Key": key, "X-Goog-FieldMask": "nextPageToken,places.id,places.displayName,places.formattedAddress,places.nationalPhoneNumber,places.internationalPhoneNumber,places.websiteUri,places.googleMapsUri,places.businessStatus,places.rating,places.userRatingCount" },
        body: JSON.stringify(body),
      });
      j = await r.json();
      if (!r.ok) break;
    } catch (_) { break; }
    for (const p of j.places || []) out.push(p);
    pageToken = j.nextPageToken;
    if (!pageToken) break;
  }
  return out;
}

// Run one batch of the worldwide sweep: process N (metro × industry) cells from
// the persisted cursor, keep only no-site/outdated prospects, score + dedupe,
// persist to Redis (fda:sweep:leads), advance the cursor.
async function runSweep(key, opts) {
  const cells = Math.max(1, Math.min(6, Number(opts.cells) || 2));
  const maxPages = Math.max(1, Math.min(3, Number(opts.pages) || 2));
  const state = (await kvGetJson("fda:sweep:state", null)) || { cursor: 0, runs: 0, lastRunAt: null, totalScanned: 0, totalFound: 0, totalSaved: 0 };
  const stored = (await kvGetJson("fda:sweep:leads", [])) || [];
  const seen = new Set(stored.map((l) => l.placeId).filter(Boolean));
  const cellResults = []; let scanned = 0, found = 0, saved = 0;
  const stamp = new Date().toISOString();

  for (let n = 0; n < cells; n++) {
    const { location, industry } = cellAt(state.cursor + n);
    const places = await searchTextPaged(key, industry + " in " + location, maxPages);
    scanned += places.length;
    let cellFound = 0, cellSaved = 0;
    for (const p of places) {
      const website = p.websiteUri || "";
      const needsSite = !website;
      const audit = website ? await auditSite(website).catch(() => null) : null;
      const outdated = needsSite ? false : !!(audit && audit.outdated);
      if (!needsSite && !outdated) continue; // only no-site / outdated prospects
      cellFound++;
      const placeId = p.id || "";
      if (placeId && seen.has(placeId)) continue;
      const name = (p.displayName && p.displayName.text) || "(unnamed)";
      const email = outdated ? await scrapeEmail(website).catch(() => "") : "";
      const sc = scoreLead({ industry, needsSite, outdated, staleness: audit ? audit.staleness : 100, reviews: p.userRatingCount || 0 });
      const note = needsSite ? "No website — prime rebuild target" : ("Outdated site (" + (audit ? audit.staleness : 0) + "/100): " + ((audit && audit.reasons.slice(0, 2).join("; ")) || ""));
      stored.unshift({ placeId, name, phone: p.nationalPhoneNumber || p.internationalPhoneNumber || "", email, website, address: p.formattedAddress || "", mapsUrl: p.googleMapsUri || "", location, industry, needsSite, outdated, staleness: audit ? audit.staleness : 100, score: sc.score, tier: sc.tier, note, source: "worldwide-sweep", at: stamp });
      if (placeId) seen.add(placeId);
      cellSaved++;
    }
    found += cellFound; saved += cellSaved;
    cellResults.push({ location, industry, scanned: places.length, found: cellFound, saved: cellSaved });
  }

  const next = { cursor: (state.cursor + cells) % GRID, runs: (state.runs || 0) + 1, lastRunAt: stamp, totalScanned: (state.totalScanned || 0) + scanned, totalFound: (state.totalFound || 0) + found, totalSaved: (state.totalSaved || 0) + saved };
  await kvSetJson("fda:sweep:state", next);
  await kvSetJson("fda:sweep:leads", stored.slice(0, 1000));
  return { ok: true, ranCells: cells, scanned, found, saved, cells: cellResults, cursor: next.cursor, gridSize: GRID, coverage: { metros: METROS.length, industries: INDUSTRIES.length, cyclePercent: Math.round((next.cursor / GRID) * 100) } };
}

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, x-admin-token");
  if (req.method === "OPTIONS") return res.status(200).end();

  const secrets = await loadSecrets();
  const key = process.env.GOOGLE_PLACES_API_KEY || secrets.GOOGLE_PLACES_API_KEY;
  if (!key) return res.status(500).json({ error: "Set GOOGLE_PLACES_API_KEY to use the lead finder." });

  // GET = autonomous sweep (Vercel Cron). Gated by CRON_SECRET when set:
  //   GET /api/leads-find?sweep=1   (Authorization: Bearer $CRON_SECRET)
  if (req.method === "GET") {
    if ((req.query && (req.query.sweep || req.query.action === "sweep"))) {
      const cs = process.env.CRON_SECRET;
      if (cs && req.headers.authorization !== "Bearer " + cs) return res.status(401).json({ error: "Unauthorized." });
      const out = await runSweep(key, { cells: req.query.cells, pages: req.query.pages });
      return res.status(200).json(out);
    }
    // GET status: cursor + coverage (owner can poll the sweep progress).
    const state = (await kvGetJson("fda:sweep:state", null)) || { cursor: 0, runs: 0 };
    return res.status(200).json({ state, coverage: { gridSize: GRID, metros: METROS.length, industries: INDUSTRIES.length, cyclePercent: Math.round(((state.cursor || 0) / GRID) * 100) } });
  }

  if (req.method !== "POST") return res.status(405).json({ error: "Use POST" });

  const admin = process.env.ADMIN_PASSWORD;
  if (admin && req.headers["x-admin-token"] !== admin) return res.status(401).json({ error: "Unauthorized." });

  let body = req.body;
  if (typeof body === "string") { try { body = JSON.parse(body); } catch { body = {}; } }
  body = body || {};

  // SWEEP mode (manual owner trigger): run one worldwide batch right now.
  if (body.sweep) {
    const out = await runSweep(key, { cells: body.cells, pages: body.pages });
    return res.status(200).json(out);
  }

  // LOOKUP mode (autonomous builder): research one named business by name+address.
  if (body.lookup || (body.name && body.address && !body.keyword && body.lat == null && body.lng == null)) {
    const name = String(body.name || "").slice(0, 120).trim();
    const address = String(body.address || "").slice(0, 200).trim();
    if (!name) return res.status(400).json({ error: "Provide a business name to look up." });
    return lookupBusiness(key, name, address, res);
  }

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

    // Google doesn't expose emails, so scrape one from each lead's own site and
    // AUDIT it for staleness (best-effort, in parallel). This surfaces not just
    // no-website prospects but businesses with OUTDATED sites worth rebuilding.
    await Promise.all(leads.map(async (l) => {
      if (!l.website) { l.outdated = false; l.staleness = 100; return; }
      try { l.email = await scrapeEmail(l.website); } catch (_) {}
      try {
        const a = await auditSite(l.website);
        l.outdated = a.outdated; l.staleness = a.staleness; l.auditReasons = a.reasons;
      } catch (_) { l.outdated = false; l.staleness = 0; }
    }));

    // Score + tier every lead; need-a-site/outdated prospects float to the top.
    for (const l of leads) {
      const sc = scoreLead({ industry: keyword, needsSite: l.needsSite, outdated: l.outdated, staleness: l.staleness, reviews: l.reviews });
      l.score = sc.score; l.tier = sc.tier;
    }
    leads.sort((a, b) => (b.needsSite ? 1 : 0) - (a.needsSite ? 1 : 0) || (b.outdated ? 1 : 0) - (a.outdated ? 1 : 0) || (b.score || 0) - (a.score || 0));
    return res.status(200).json({ leads });
  } catch (e) {
    return res.status(500).json({ error: e.message || "Request failed" });
  }
}
