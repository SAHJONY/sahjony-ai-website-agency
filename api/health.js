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

export default async function handler(req, res) {
  // Analytics-beacon mode (rewritten from /api/track) — disambiguated by ?slug=.
  if (req.query && req.query.slug != null) return trackBeacon(req, res);

  const secrets = await loadSecrets();
  const get = (name) => process.env[name] || secrets[name] || "";
  const has = (name) => !!get(name);
  const higgsfield = has("HIGGSFIELD_API_KEY") || (has("HIGGSFIELD_KEY_ID") && has("HIGGSFIELD_KEY_SECRET"));

  // Safe credential SHAPE check (no secret leaked) — GET /api/health?diag=higgsfield.
  // Tells us if the credential is structurally a KEY_ID:KEY_SECRET pair.
  if (req.query && req.query.diag === "higgsfield") {
    const id = get("HIGGSFIELD_KEY_ID"), sec = get("HIGGSFIELD_KEY_SECRET");
    const combined = (id && sec) ? (id + ":" + sec) : get("HIGGSFIELD_API_KEY");
    const parts = combined.split(":");
    return res.status(200).json({
      source: (id && sec) ? "separate (KEY_ID + KEY_SECRET)" : has("HIGGSFIELD_API_KEY") ? "combined (HIGGSFIELD_API_KEY)" : "none",
      hasKeyId: !!id, hasKeySecret: !!sec, hasCombinedVar: has("HIGGSFIELD_API_KEY"),
      totalLength: combined.length,
      hasColon: combined.includes(":"),
      partsCount: parts.length,
      part1Length: parts[0] ? parts[0].length : 0,
      part2Length: parts[1] ? parts[1].length : 0,
      hasWhitespace: /\s/.test(combined),
      idPreview: combined.slice(0, 4) + "…",   // first 4 chars only, never the secret
    });
  }
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
      secretsManager: !!process.env.ADMIN_PASSWORD,
      model: process.env.CLAUDE_MODEL || "claude-3-5-sonnet-20241022",
    },
    engineRotation: ["claude (primary)", "openai", "gemini", "grok", "glm (z.ai)", "nvidia nim (rotating)"],
  });
}
