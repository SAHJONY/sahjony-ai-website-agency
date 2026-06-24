// POST /api/image  { prompt: string, size?: string }
//
// Generates a stunning, on-brand image for a client's website. Provider-agnostic
// so you can point it at OpenAI Images, Higgsfield, or any compatible API — keys
// stay server-side. Returns { url } (a hosted URL or a data: URL).
//
// Configuration (env or dashboard secrets), in priority order:
//   IMAGE_API_URL + IMAGE_API_KEY [+ IMAGE_MODEL]   — generic OpenAI-images-style
//   HIGGSFIELD_API_KEY [+ HIGGSFIELD_API_URL/MODEL] — Higgsfield
//   OPENAI_API_KEY [+ IMAGE_MODEL]                  — falls back to OpenAI Images
//
// The expected response shapes handled: OpenAI ({data:[{url|b64_json}]}),
// and common {url}/{image_url}/{output:[url]} variants.

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
  } catch (_) {}
  return {};
}

function pickUrl(data) {
  if (!data) return "";
  if (Array.isArray(data.data) && data.data[0]) {
    if (data.data[0].url) return data.data[0].url;
    if (data.data[0].b64_json) return "data:image/png;base64," + data.data[0].b64_json;
  }
  if (data.url) return data.url;
  if (data.image_url) return data.image_url;
  if (Array.isArray(data.output) && data.output[0]) return typeof data.output[0] === "string" ? data.output[0] : (data.output[0].url || "");
  if (Array.isArray(data.images) && data.images[0]) return typeof data.images[0] === "string" ? data.images[0] : (data.images[0].url || "");
  return "";
}

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST") return res.status(405).json({ error: "Use POST" });

  let body = req.body;
  if (typeof body === "string") { try { body = JSON.parse(body); } catch { body = {}; } }
  const prompt = body && body.prompt;
  const size = (body && body.size) || "1024x1024";
  if (!prompt || typeof prompt !== "string") return res.status(400).json({ error: "Body must include a 'prompt' string." });

  const secrets = await loadSecrets();
  const getKey = (name) => process.env[name] || secrets[name] || "";

  // Resolve provider.
  let url, key, model, provider;
  if (getKey("IMAGE_API_URL") && getKey("IMAGE_API_KEY")) {
    url = getKey("IMAGE_API_URL"); key = getKey("IMAGE_API_KEY"); model = process.env.IMAGE_MODEL || "gpt-image-1"; provider = "custom";
  } else if (getKey("HIGGSFIELD_API_KEY")) {
    url = process.env.HIGGSFIELD_API_URL || "https://api.higgsfield.ai/v1/images/generations";
    key = getKey("HIGGSFIELD_API_KEY"); model = process.env.HIGGSFIELD_MODEL || "soul"; provider = "higgsfield";
  } else if (getKey("OPENAI_API_KEY")) {
    url = "https://api.openai.com/v1/images/generations"; key = getKey("OPENAI_API_KEY"); model = process.env.IMAGE_MODEL || "gpt-image-1"; provider = "openai";
  } else {
    return res.status(500).json({ error: "No image provider configured. Set IMAGE_API_URL/IMAGE_API_KEY, HIGGSFIELD_API_KEY, or OPENAI_API_KEY." });
  }

  try {
    const r = await fetch(url, {
      method: "POST",
      headers: { "content-type": "application/json", Authorization: "Bearer " + key },
      body: JSON.stringify({ model, prompt, n: 1, size }),
    });
    const data = await r.json();
    if (!r.ok) return res.status(r.status).json({ error: (data && data.error && (data.error.message || data.error)) || "Image API error" });
    const out = pickUrl(data);
    if (!out) return res.status(502).json({ error: "Image API returned no image." });
    return res.status(200).json({ url: out, provider });
  } catch (e) {
    return res.status(500).json({ error: e.message || "Request failed" });
  }
}
