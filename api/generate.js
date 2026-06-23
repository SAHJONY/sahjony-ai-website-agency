// POST /api/generate  { prompt: string, maxTokens?: number }
//
// Multi-engine "brain" with autonomous fallback rotation. All API keys live ONLY
// on the server (Vercel env vars), never in the browser. Engines are tried in
// order; the first one that returns text wins:
//
//   1. PRIMARY  — Claude (Anthropic)            ANTHROPIC_API_KEY
//   2. FALLBACK — NVIDIA NIM free models         NVIDIA_API_KEY   (rotated)
//   3. FALLBACK — Google Gemini free tier        GEMINI_API_KEY
//
// If a configured engine errors or is rate-limited, we automatically roll to the
// next one. NVIDIA models are rotated request-to-request so load spreads across
// the free model pool and a throttled model auto-rolls to the next.

// --- NVIDIA NIM free models (OpenAI-compatible). Override with NVIDIA_MODELS (CSV). ---
const DEFAULT_NVIDIA_MODELS = [
  "meta/llama-3.3-70b-instruct",
  "nvidia/llama-3.1-nemotron-70b-instruct",
  "meta/llama-3.1-405b-instruct",
  "mistralai/mixtral-8x22b-instruct-v0.1",
  "google/gemma-2-27b-it",
  "deepseek-ai/deepseek-r1",
];

// Module-level counter — persists while the serverless instance stays warm, so
// successive requests start the NVIDIA rotation at a different model.
let rotationCursor = 0;

function nvidiaModels() {
  const csv = process.env.NVIDIA_MODELS;
  if (csv && csv.trim()) return csv.split(",").map((s) => s.trim()).filter(Boolean);
  return DEFAULT_NVIDIA_MODELS;
}

// ---- Engine: Claude (Anthropic) ----
async function tryClaude(prompt, maxTokens) {
  const key = process.env.ANTHROPIC_API_KEY;
  if (!key) return null; // not configured -> skip
  const model = process.env.CLAUDE_MODEL || "claude-3-5-sonnet-20241022";
  const r = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: { "content-type": "application/json", "x-api-key": key, "anthropic-version": "2023-06-01" },
    body: JSON.stringify({ model, max_tokens: maxTokens, messages: [{ role: "user", content: prompt }] }),
  });
  const data = await r.json();
  if (!r.ok) throw new Error((data && data.error && data.error.message) || "Claude API error");
  const text = (data.content && data.content[0] && data.content[0].text) || "";
  if (!text) throw new Error("Claude returned empty text");
  return { text, engine: "claude:" + model };
}

// ---- Engine: NVIDIA NIM (OpenAI-compatible), rotated across free models ----
async function tryNvidia(prompt, maxTokens) {
  const key = process.env.NVIDIA_API_KEY;
  if (!key) return null; // not configured -> skip
  const models = nvidiaModels();
  let lastErr;
  // Start at the rotating cursor, then walk the whole pool until one answers.
  for (let i = 0; i < models.length; i++) {
    const model = models[(rotationCursor + i) % models.length];
    try {
      const r = await fetch("https://integrate.api.nvidia.com/v1/chat/completions", {
        method: "POST",
        headers: { "content-type": "application/json", Authorization: "Bearer " + key },
        body: JSON.stringify({
          model,
          max_tokens: maxTokens,
          temperature: 0.6,
          messages: [{ role: "user", content: prompt }],
        }),
      });
      const data = await r.json();
      if (!r.ok) throw new Error((data && data.error && (data.error.message || data.error)) || ("NVIDIA error (" + model + ")"));
      const text = (data.choices && data.choices[0] && data.choices[0].message && data.choices[0].message.content) || "";
      if (!text) throw new Error("NVIDIA returned empty text (" + model + ")");
      rotationCursor = (rotationCursor + i + 1) % models.length; // advance for next request
      return { text, engine: "nvidia:" + model };
    } catch (e) {
      lastErr = e; // model busy/throttled -> roll to next model
    }
  }
  throw lastErr || new Error("All NVIDIA models failed");
}

// ---- Engine: Google Gemini (free tier) ----
async function tryGemini(prompt, maxTokens) {
  const key = process.env.GEMINI_API_KEY;
  if (!key) return null; // not configured -> skip
  const model = process.env.GEMINI_MODEL || "gemini-2.5-flash";
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent?key=${encodeURIComponent(key)}`;
  const r = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      contents: [{ parts: [{ text: prompt }] }],
      generationConfig: { maxOutputTokens: maxTokens },
    }),
  });
  const data = await r.json();
  if (!r.ok) throw new Error((data && data.error && data.error.message) || "Gemini API error");
  const parts = data.candidates && data.candidates[0] && data.candidates[0].content && data.candidates[0].content.parts;
  const text = (parts && parts.map((p) => p.text || "").join("")) || "";
  if (!text) throw new Error("Gemini returned empty text");
  return { text, engine: "gemini:" + model };
}

export default async function handler(req, res) {
  // Basic CORS for same-origin + preflight
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  if (req.method === "OPTIONS") return res.status(200).end();

  if (req.method !== "POST") {
    return res.status(405).json({ error: "Use POST" });
  }

  // Vercel parses JSON bodies automatically, but guard for string bodies too.
  let body = req.body;
  if (typeof body === "string") {
    try { body = JSON.parse(body); } catch { body = {}; }
  }
  const prompt = body && body.prompt;
  const maxTokens = (body && body.maxTokens) || 2000;
  if (!prompt || typeof prompt !== "string") {
    return res.status(400).json({ error: "Body must include a 'prompt' string." });
  }

  // Ordered rotation: primary brain first, then fallback brains.
  const engines = [tryClaude, tryNvidia, tryGemini];
  const errors = [];
  let configured = 0;

  for (const engine of engines) {
    try {
      const result = await engine(prompt, maxTokens);
      if (!result) continue; // engine not configured -> skip silently
      configured++;
      return res.status(200).json(result); // { text, engine }
    } catch (e) {
      configured++;
      errors.push((e && e.message) || "engine failed");
      // fall through to the next engine
    }
  }

  if (configured === 0) {
    return res.status(500).json({
      error: "No AI engine is configured. Set ANTHROPIC_API_KEY, NVIDIA_API_KEY, or GEMINI_API_KEY on the server.",
    });
  }
  return res.status(502).json({ error: "All AI engines failed", detail: errors });
}
