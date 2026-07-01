// GET /api/health — quick check that engines/env are wired up (does not leak secrets)
//
// Also serves the PUBLIC analytics beacon (formerly /api/track) when called with
// a ?slug= param — /api/track is rewritten here in vercel.json. Merging the two
// keeps the deployment under the Hobby plan's 12-Serverless-Function limit.
function cleanSlug(s) { return String(s || "").toLowerCase().replace(/[^a-z0-9-]/g, "").slice(0, 60); }

async function trackBeacon(req, res) {
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

async function loadSecrets() {
  const url = process.env.UPSTASH_REDIS_REST_URL;
  const token = process.env.UPSTASH_REDIS_REST_TOKEN;
  if (!url || !token) return {};
  try {
    const r = await fetch(url.replace(/\/$/, "") + "/get/" + encodeURIComponent("fda:secrets"), {
      headers: { Authorization: "Bearer " + token },
    });
    const j = await r.json();
    if (j && j.result) { try { return JSON.parse(j.result) || {}; } catch { return {}; } }
  } catch (_) { /* ignore */ }
  return {};
}

// PUBLIC marketing config: social profile links for the whole app. Sourced from
// env (SOCIAL_*) and overridable via the owner's Marketing settings (fda:marketing
// in Upstash). No secrets — just public profile URLs shown in footers etc.
const SOCIAL_PLATFORMS = [
  ["facebook", "Facebook"], ["instagram", "Instagram"], ["tiktok", "TikTok"],
  ["youtube", "YouTube"], ["x", "X"], ["linkedin", "LinkedIn"], ["threads", "Threads"],
  ["pinterest", "Pinterest"], ["whatsapp", "WhatsApp"], ["telegram", "Telegram"],
  ["google", "Google"], ["yelp", "Yelp"],
];
async function loadMarketing() {
  const url = process.env.UPSTASH_REDIS_REST_URL;
  const token = process.env.UPSTASH_REDIS_REST_TOKEN;
  if (!url || !token) return {};
  try {
    const r = await fetch(url.replace(/\/$/, "") + "/get/" + encodeURIComponent("fda:marketing"), {
      headers: { Authorization: "Bearer " + token },
    });
    const j = await r.json();
    if (j && j.result) { try { return JSON.parse(j.result) || {}; } catch { return {}; } }
  } catch (_) { /* ignore */ }
  return {};
}
function buildSocial(marketing) {
  const m = (marketing && marketing.social) || {};
  const out = {};
  for (const [key] of SOCIAL_PLATFORMS) {
    const v = m[key] || process.env["SOCIAL_" + key.toUpperCase()] || (key === "x" ? process.env.SOCIAL_TWITTER : "") || "";
    if (v && String(v).trim()) out[key] = String(v).trim();
  }
  return out;
}

export default async function handler(req, res) {
  // Analytics-beacon mode (rewritten from /api/track) — disambiguated by ?slug=.
  if (req.query && req.query.slug != null) return trackBeacon(req, res);

  const secrets = await loadSecrets();
  const marketing = await loadMarketing();
  const social = buildSocial(marketing);
  const get = (name) => process.env[name] || secrets[name] || "";
  const has = (name) => !!get(name);
  const higgsfield = has("HIGGSFIELD_API_KEY") || (has("HIGGSFIELD_KEY_ID") && has("HIGGSFIELD_KEY_SECRET"));

  // Which image provider /api/image will actually use (mirror its resolver order).
  const forced = (process.env.IMAGE_PROVIDER || secrets.IMAGE_PROVIDER || "").toLowerCase();
  const imageProvider =
    (forced === "higgsfield" && higgsfield) ? "higgsfield"
    : has("FAL_API_KEY") ? "fal"
    : (has("IMAGE_API_URL") && has("IMAGE_API_KEY")) ? "custom"
    : higgsfield ? "higgsfield"
    : has("OPENAI_API_KEY") ? "openai"
    : "none";

  res.status(200).json({
    ok: true,
    service: "frontdeskagents website factory",
    time: new Date().toISOString(),
    config: {
      claude: has("ANTHROPIC_API_KEY"),
      nvidia: has("NVIDIA_API_KEY"),
      openai: has("OPENAI_API_KEY"),
      grok: has("XAI_API_KEY"),
      gemini: has("GEMINI_API_KEY"),
      glm: has("ZAI_API_KEY"),
      image: imageProvider !== "none",
      imageProvider,
      higgsfield,
      fal: has("FAL_API_KEY"),
      upstash: !!(process.env.UPSTASH_REDIS_REST_URL && process.env.UPSTASH_REDIS_REST_TOKEN),
      stripe: !!process.env.STRIPE_SECRET_KEY,
      square: !!(process.env.SQUARE_ACCESS_TOKEN && process.env.SQUARE_LOCATION_ID),
      zelle: has("ZELLE_HANDLE"),
      cashapp: has("CASHAPP_CASHTAG"),
      telegram: !!(process.env.TELEGRAM_BOT_TOKEN && process.env.TELEGRAM_OWNER_CHAT),
      googlePlaces: has("GOOGLE_PLACES_API_KEY"),
      secretsManager: !!process.env.ADMIN_PASSWORD,
      adminPassword: !!process.env.ADMIN_PASSWORD,
      rateLimit: Number(process.env.GEN_RATE_LIMIT || 60) > 0,
      paymentsPrimary: String(process.env.PAYMENTS_PRIMARY || "manual").toLowerCase(),
      model: process.env.CLAUDE_MODEL || "claude-3-5-sonnet-20241022",
    },
    engineRotation: ["claude (primary)", "openai", "gemini", "grok", "glm (z.ai)", "nvidia nim (rotating)"],
    social,
  });
}
