// GET /api/health — quick check that engines/env are wired up (does not leak secrets)

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
  const secrets = await loadSecrets();
  const has = (name) => !!(process.env[name] || secrets[name]);

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
      image: !!(has("IMAGE_API_KEY") || has("HIGGSFIELD_API_KEY") || has("OPENAI_API_KEY")),
      upstash: !!(process.env.UPSTASH_REDIS_REST_URL && process.env.UPSTASH_REDIS_REST_TOKEN),
      stripe: !!process.env.STRIPE_SECRET_KEY,
      secretsManager: !!process.env.ADMIN_PASSWORD,
      model: process.env.CLAUDE_MODEL || "claude-3-5-sonnet-20241022",
    },
    engineRotation: ["claude (primary)", "nvidia nim (rotating)", "openai", "grok", "gemini", "glm (z.ai)"],
  });
}
