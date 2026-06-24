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

  // Resolve provider. Set IMAGE_PROVIDER (env or dashboard secret) to pin one,
  // e.g. IMAGE_PROVIDER=higgsfield, regardless of which other keys are present.
  // ?provider= on the request forces one for a single call (testing/diagnosis).
  const force = ((req.query && req.query.provider) || getKey("IMAGE_PROVIDER") || "").toLowerCase();
  let url, key, model, provider;
  if (force === "fal" && getKey("FAL_API_KEY")) {
    url = process.env.FAL_IMAGE_URL || "https://fal.run/fal-ai/flux-pro/v1.1";
    key = getKey("FAL_API_KEY"); model = ""; provider = "fal";
  } else if (force === "custom" && getKey("IMAGE_API_URL") && getKey("IMAGE_API_KEY")) {
    url = getKey("IMAGE_API_URL"); key = getKey("IMAGE_API_KEY"); model = process.env.IMAGE_MODEL || "gpt-image-1"; provider = "custom";
  } else if (force === "openai" && getKey("OPENAI_API_KEY")) {
    url = "https://api.openai.com/v1/images/generations"; key = getKey("OPENAI_API_KEY"); model = process.env.IMAGE_MODEL || "gpt-image-1"; provider = "openai";
  } else
  if (force === "higgsfield" && higgsfieldCred(getKey)) {
    url = process.env.HIGGSFIELD_API_URL || "https://platform.higgsfield.ai/flux-pro/kontext/max/text-to-image";
    key = higgsfieldCred(getKey); provider = "higgsfield";
  } else if (getKey("FAL_API_KEY")) {
    // Black Forest Labs FLUX 1.1 [pro] via fal.ai — top-tier photoreal quality.
    url = process.env.FAL_IMAGE_URL || "https://fal.run/fal-ai/flux-pro/v1.1";
    key = getKey("FAL_API_KEY"); model = ""; provider = "fal";
  } else if (getKey("IMAGE_API_URL") && getKey("IMAGE_API_KEY")) {
    url = getKey("IMAGE_API_URL"); key = getKey("IMAGE_API_KEY"); model = process.env.IMAGE_MODEL || "gpt-image-1"; provider = "custom";
  } else if (higgsfieldCred(getKey)) {
    // Higgsfield (platform.higgsfield.ai) is ASYNC: POST the model endpoint -> a
    // request_id + status_url, then poll until status=completed. See pollHiggsfield.
    url = process.env.HIGGSFIELD_API_URL || "https://platform.higgsfield.ai/flux-pro/kontext/max/text-to-image";
    key = higgsfieldCred(getKey); provider = "higgsfield";
  } else if (getKey("OPENAI_API_KEY")) {
    url = "https://api.openai.com/v1/images/generations"; key = getKey("OPENAI_API_KEY"); model = process.env.IMAGE_MODEL || "gpt-image-1"; provider = "openai";
  } else {
    return res.status(500).json({ error: "No image provider configured. Set FAL_API_KEY (recommended), IMAGE_API_URL/IMAGE_API_KEY, HIGGSFIELD_API_KEY (or HIGGSFIELD_KEY_ID + HIGGSFIELD_KEY_SECRET), or OPENAI_API_KEY." });
  }

  const [w, h] = String(size).toLowerCase().split("x").map(Number);

  // Build the request per provider (auth scheme + body shape differ).
  let headers, payload;
  if (provider === "fal") {
    const image_size = (w && h) ? (w > h ? "landscape_16_9" : h > w ? "portrait_16_9" : "square_hd") : "landscape_16_9";
    headers = { "content-type": "application/json", Authorization: "Key " + key };
    payload = { prompt, image_size, num_images: 1, output_format: "jpeg" };
  } else if (provider === "higgsfield") {
    // Higgsfield auth is "Key KEY_ID:KEY_SECRET" and the body is { input: {...} }.
    const aspect = (w && h) ? (w > h ? "16:9" : h > w ? "9:16" : "1:1") : "16:9";
    headers = { "content-type": "application/json", Authorization: "Key " + key };
    payload = { input: { prompt, aspect_ratio: aspect, safety_tolerance: 2 } };
  } else {
    headers = { "content-type": "application/json", Authorization: "Bearer " + key };
    payload = { model, prompt, n: 1, size };
  }

  try {
    const r = await fetch(url, { method: "POST", headers, body: JSON.stringify(payload) });
    const raw = await r.text();
    let data = {};
    try { data = raw ? JSON.parse(raw) : {}; } catch { data = {}; }
    if (!r.ok) {
      // Surface the provider's real message (e.g. invalid credentials vs no credits)
      // instead of a generic string, so misconfig is diagnosable.
      const detail = (data && data.error && (data.error.message || data.error)) || (data && (data.message || data.detail)) || (raw || "").slice(0, 300) || "Image API error";
      return res.status(r.status).json({ error: String(detail), provider, status: r.status });
    }

    // Higgsfield returns a request_id + status_url; poll until the image is ready.
    if (provider === "higgsfield") {
      let out = higgsUrl(data); // in case it's already done inline
      if (!out) {
        const id = data.request_id || data.id;
        // Prefer the absolute status_url the API hands back; else build it from the host.
        let statusUrl = data.status_url;
        if (!statusUrl && id) {
          try { statusUrl = new URL(url).origin + "/requests/" + encodeURIComponent(id) + "/status"; } catch (_) {}
        }
        if (!statusUrl) return res.status(502).json({ error: "Higgsfield did not return a request id or status_url." });
        out = await pollHiggsfield(statusUrl, key);
      }
      if (out === "__NSFW__") return res.status(422).json({ error: "Higgsfield flagged the prompt as unsafe; try a different description." });
      if (!out) return res.status(504).json({ error: "Higgsfield image failed or timed out before it finished rendering." });
      return res.status(200).json({ url: out, provider });
    }

    const out = pickUrl(data);
    if (!out) return res.status(502).json({ error: "Image API returned no image." });
    return res.status(200).json({ url: out, provider });
  } catch (e) {
    return res.status(500).json({ error: e.message || "Request failed" });
  }
}

// Higgsfield credential is "KEY_ID:KEY_SECRET". Accept it either as a single
// HIGGSFIELD_API_KEY already in that form, or as separate ID + SECRET vars.
function higgsfieldCred(getKey) {
  const id = getKey("HIGGSFIELD_KEY_ID");
  const secret = getKey("HIGGSFIELD_KEY_SECRET");
  if (id && secret) return id + ":" + secret;
  return getKey("HIGGSFIELD_API_KEY") || "";
}

// Pull the finished image URL out of a Higgsfield status/response payload.
function higgsUrl(j) {
  if (!j) return "";
  if (Array.isArray(j.images) && j.images[0]) return typeof j.images[0] === "string" ? j.images[0] : (j.images[0].url || "");
  if (j.video && j.video.url) return j.video.url;
  if (j.result && j.result.raw && j.result.raw.url) return j.result.raw.url;
  return j.output_url || j.url || "";
}

// Poll Higgsfield's status_url until the job completes (or we run out of budget —
// must stay under the function's maxDuration of 60s).
async function pollHiggsfield(statusUrl, key) {
  const deadline = Date.now() + Number(process.env.HIGGSFIELD_POLL_MS || 48000);
  while (Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, 2500));
    let j;
    try {
      const r = await fetch(statusUrl, { headers: { Authorization: "Key " + key } });
      j = await r.json();
      if (!r.ok) continue;
    } catch (_) { continue; }
    const status = (j.status || j.state || "").toLowerCase();
    if (status === "completed" || status === "succeeded" || status === "done") return higgsUrl(j) || "";
    if (status === "nsfw") return "__NSFW__";
    if (status === "failed" || status === "error" || status === "canceled") return "";
    // queued / in_progress -> keep polling
  }
  return "";
}
