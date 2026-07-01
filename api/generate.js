// POST /api/generate  { prompt: string, maxTokens?: number }
//
// Multi-engine "brain" with autonomous fallback rotation. Keys are resolved from
// process.env first, then from secrets stored in Upstash (managed in the
// dashboard Settings panel). Keys never reach the browser. Engines are tried in
// order; the first one that returns text wins:
//
//   1. PRIMARY  — Claude (Anthropic)        ANTHROPIC_API_KEY
//   2. FALLBACK — NVIDIA NIM free models     NVIDIA_API_KEY   (rotated)
//   3. FALLBACK — OpenAI                     OPENAI_API_KEY
//   4. FALLBACK — Grok (xAI)                 XAI_API_KEY
//   5. FALLBACK — Google Gemini free tier    GEMINI_API_KEY
//
// A configured engine that errors or is rate-limited auto-rolls to the next.

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

// Load AI provider keys stored in Upstash (set via /api/secrets). Upstash creds
// themselves must stay in env (they bootstrap this lookup).
async function loadSecrets() {
  const url = process.env.UPSTASH_REDIS_REST_URL;
  const token = process.env.UPSTASH_REDIS_REST_TOKEN;
  if (!url || !token) return {};
  try {
    const r = await fetch(url.replace(/\/$/, "") + "/get/" + encodeURIComponent("fda:secrets"), {
      headers: { Authorization: "Bearer " + token },
    });
    const j = await r.json();
    if (j && j.result) {
      try { return JSON.parse(j.result) || {}; } catch { return {}; }
    }
  } catch (_) { /* DB offline -> env-only */ }
  return {};
}

// Per-engine wall-clock budget. Without this, ONE slow free model can consume the
// whole function timeout (-> 504) and the fast fallbacks below it never get a turn.
const ENGINE_TIMEOUT_MS = Number(process.env.ENGINE_TIMEOUT_MS || 18000);
// Total budget across ALL engine attempts — must stay under the function's
// maxDuration (60s in vercel.json) so we always return a JSON answer, never a 504.
const REQUEST_BUDGET_MS = Number(process.env.GEN_BUDGET_MS || 52000);
let requestDeadline = 0; // epoch ms; set per request in the handler.

// --- Public rate limit -------------------------------------------------------
// /api/generate is public (the free builder + the Ava widget both call it and
// spend YOUR AI credits). This caps requests per IP so the public preview can't
// burn your budget. Tune with GEN_RATE_LIMIT (per window) + GEN_RATE_WINDOW
// (seconds). Set GEN_RATE_LIMIT=0 to disable. Owner calls (valid x-admin-token)
// and setups without Upstash are never limited (fails open).
const GEN_RATE_LIMIT = Number(process.env.GEN_RATE_LIMIT || 60);
const GEN_RATE_WINDOW = Number(process.env.GEN_RATE_WINDOW || 600);
async function rateLimited(req) {
  const url = process.env.UPSTASH_REDIS_REST_URL, token = process.env.UPSTASH_REDIS_REST_TOKEN;
  if (!url || !token || GEN_RATE_LIMIT <= 0) return false;
  if (process.env.ADMIN_PASSWORD && req.headers["x-admin-token"] === process.env.ADMIN_PASSWORD) return false;
  const xff = String(req.headers["x-forwarded-for"] || "").split(",")[0].trim() || "anon";
  const ip = xff.replace(/[^a-zA-Z0-9:._-]/g, "_").slice(0, 60);
  const bucket = Math.floor(Date.now() / 1000 / GEN_RATE_WINDOW);
  const key = `fda:rl:gen:${ip}:${bucket}`;
  const base = url.replace(/\/$/, "");
  try {
    const r = await fetch(base + "/incr/" + encodeURIComponent(key), { headers: { Authorization: "Bearer " + token } });
    const j = await r.json();
    const n = Number(j && j.result) || 0;
    if (n === 1) { // first hit -> expire the counter at the end of the window
      fetch(base + "/expire/" + encodeURIComponent(key) + "/" + GEN_RATE_WINDOW, { headers: { Authorization: "Bearer " + token } }).catch(() => {});
    }
    return n > GEN_RATE_LIMIT;
  } catch (_) { return false; } // DB hiccup -> don't block real users
}

// fetch() that aborts after `ms`, so a hung/slow engine rolls to the next one.
// Each attempt is capped at the SMALLER of the per-engine timeout and whatever
// remains of the overall request budget, so the engine chain can't overrun.
async function fetchT(url, opts, ms) {
  const cap = ms || ENGINE_TIMEOUT_MS;
  const remaining = requestDeadline ? requestDeadline - Date.now() : cap;
  const wait = Math.max(1500, Math.min(cap, remaining)); // never below 1.5s
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), wait);
  try {
    return await fetch(url, { ...opts, signal: ctrl.signal });
  } finally {
    clearTimeout(t);
  }
}

// Generic OpenAI-compatible chat call (NVIDIA, OpenAI, Grok all speak this).
async function chatCompletions(url, key, model, prompt, maxTokens) {
  const r = await fetchT(url, {
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
  if (!r.ok) throw new Error((data && data.error && (data.error.message || data.error)) || "API error");
  const text = (data.choices && data.choices[0] && data.choices[0].message && data.choices[0].message.content) || "";
  if (!text) throw new Error("Empty response");
  return text;
}

// ---- Engine: Claude (Anthropic) ----
async function tryClaude(prompt, maxTokens, getKey) {
  const key = getKey("ANTHROPIC_API_KEY");
  if (!key) return null;
  const model = process.env.CLAUDE_MODEL || "claude-3-5-sonnet-20241022";
  const r = await fetchT("https://api.anthropic.com/v1/messages", {
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

// ---- Engine: NVIDIA NIM, rotated across free models ----
async function tryNvidia(prompt, maxTokens, getKey) {
  const key = getKey("NVIDIA_API_KEY");
  if (!key) return null;
  const models = nvidiaModels();
  // Try at most 2 free models per request — each can be slow, and trying all 6
  // would blow the function's wall-clock budget before fast engines get a turn.
  const attempts = Math.min(models.length, Number(process.env.NVIDIA_MAX_ATTEMPTS || 2));
  let lastErr;
  for (let i = 0; i < attempts; i++) {
    const model = models[(rotationCursor + i) % models.length];
    try {
      const text = await chatCompletions("https://integrate.api.nvidia.com/v1/chat/completions", key, model, prompt, maxTokens);
      rotationCursor = (rotationCursor + i + 1) % models.length; // advance for next request
      return { text, engine: "nvidia:" + model };
    } catch (e) {
      lastErr = e; // model busy/throttled -> roll to next model
    }
  }
  throw lastErr || new Error("All NVIDIA models failed");
}

// ---- Engine: OpenAI ----
async function tryOpenAI(prompt, maxTokens, getKey) {
  const key = getKey("OPENAI_API_KEY");
  if (!key) return null;
  const model = process.env.OPENAI_MODEL || "gpt-4o-mini";
  const text = await chatCompletions("https://api.openai.com/v1/chat/completions", key, model, prompt, maxTokens);
  return { text, engine: "openai:" + model };
}

// ---- Engine: Grok (xAI) ----
async function tryGrok(prompt, maxTokens, getKey) {
  const key = getKey("XAI_API_KEY");
  if (!key) return null;
  const model = process.env.XAI_MODEL || "grok-2-latest";
  const text = await chatCompletions("https://api.x.ai/v1/chat/completions", key, model, prompt, maxTokens);
  return { text, engine: "grok:" + model };
}

// ---- Engine: GLM (Z.ai / Zhipu, OpenAI-compatible) ----
async function tryGLM(prompt, maxTokens, getKey) {
  const key = getKey("ZAI_API_KEY");
  if (!key) return null;
  const model = process.env.ZAI_MODEL || "glm-4.6";
  const base = (process.env.ZAI_BASE_URL || "https://api.z.ai/api/paas/v4").replace(/\/$/, "");
  const text = await chatCompletions(base + "/chat/completions", key, model, prompt, maxTokens);
  return { text, engine: "glm:" + model };
}

// ---- Engine: Google Gemini (free tier) ----
async function tryGemini(prompt, maxTokens, getKey) {
  const key = getKey("GEMINI_API_KEY");
  if (!key) return null;
  const model = process.env.GEMINI_MODEL || "gemini-2.5-flash";
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent?key=${encodeURIComponent(key)}`;
  const r = await fetchT(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ contents: [{ parts: [{ text: prompt }] }], generationConfig: { maxOutputTokens: maxTokens } }),
  });
  const data = await r.json();
  if (!r.ok) throw new Error((data && data.error && data.error.message) || "Gemini API error");
  const parts = data.candidates && data.candidates[0] && data.candidates[0].content && data.candidates[0].content.parts;
  const text = (parts && parts.map((p) => p.text || "").join("")) || "";
  if (!text) throw new Error("Gemini returned empty text");
  return { text, engine: "gemini:" + model };
}

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, x-admin-token");
  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST") return res.status(405).json({ error: "Use POST" });

  if (await rateLimited(req)) {
    res.setHeader("retry-after", String(GEN_RATE_WINDOW));
    return res.status(429).json({ error: "You've made a lot of requests — please wait a minute and try again." });
  }

  let body = req.body;
  if (typeof body === "string") {
    try { body = JSON.parse(body); } catch { body = {}; }
  }

  // ===== AVA — AI receptionist (chat) =====
  // POST { ava:true, business?, messages:[{role,content}], lang? } -> { reply, engine }
  // Reuses the same engine rotation; multilingual; concise; captures intent.
  if (body && body.ava) {
    requestDeadline = Date.now() + REQUEST_BUDGET_MS;
    const secrets = await loadSecrets();
    const getKey = (name) => process.env[name] || secrets[name] || "";
    // Per-client customization: load this site's Ava config (fda:ava:<slug>).
    let cfg = {};
    const slug = String(body.slug || "").toLowerCase().replace(/[^a-z0-9-]/g, "").slice(0, 60);
    if (slug) {
      try {
        const u = process.env.UPSTASH_REDIS_REST_URL, t = process.env.UPSTASH_REDIS_REST_TOKEN;
        if (u && t) {
          const cr = await fetch(u.replace(/\/$/, "") + "/get/" + encodeURIComponent("fda:ava:" + slug), { headers: { Authorization: "Bearer " + t } });
          const cj = await cr.json();
          if (cj && cj.result) { try { cfg = JSON.parse(cj.result) || {}; } catch {} }
        }
      } catch (_) {}
    }
    const biz = String(body.business || cfg.business || "this business").slice(0, 120);
    const msgs = Array.isArray(body.messages) ? body.messages.slice(-12) : [];
    const convo = msgs.map((m) => (m && m.role === "assistant" ? "Ava" : "Customer") + ": " + String((m && m.content) || "").slice(0, 800)).join("\n");
    const facts = [
      cfg.services ? `Services: ${cfg.services}.` : "",
      cfg.hours ? `Hours: ${cfg.hours}.` : "",
      cfg.address ? `Location: ${cfg.address}.` : "",
      cfg.pricing ? `Pricing: ${cfg.pricing}.` : "",
      cfg.calendarUrl ? `To book, you may share this link: ${cfg.calendarUrl}.` : "",
      cfg.instructions ? `Owner instructions: ${cfg.instructions}` : "",
    ].filter(Boolean).join(" ");
    const sys =
      `You are Ava, the warm, professional AI receptionist for ${biz}. ` +
      `Reply in the SAME language the customer writes in — you speak 100+ languages. ` +
      `Keep replies to 1–3 short sentences. Be friendly and genuinely helpful. ` +
      (cfg.booking === false ? `Take messages and answer questions. ` : `Answer questions and offer to book an appointment or take a message; when booking, collect the customer's name and a phone or email and confirm it back. `) +
      (facts ? `\nBusiness facts (use ONLY these, don't invent): ${facts}` : ` Answer questions about services, hours, pricing and location.`) +
      ` Never invent specific facts you weren't given — offer to have the team follow up. Greet warmly on the first message.`;
    const avaPrompt = sys + "\n\nConversation so far:\n" + (convo || "Customer: (started the chat)") + "\nAva:";
    for (const engine of [tryClaude, tryOpenAI, tryGemini, tryGrok, tryGLM, tryNvidia]) {
      try {
        const r = await engine(avaPrompt, 400, getKey);
        if (!r) continue;
        return res.status(200).json({ reply: String(r.text || "").trim().replace(/^Ava:\s*/i, ""), engine: r.engine });
      } catch (_) { /* roll to next engine */ }
    }
    return res.status(200).json({ reply: "I'm sorry — I'm having a little trouble right now. Please leave your name and number and the team will get right back to you!", engine: "fallback" });
  }

  const prompt = body && body.prompt;
  const maxTokens = (body && body.maxTokens) || 2000;
  if (!prompt || typeof prompt !== "string") {
    return res.status(400).json({ error: "Body must include a 'prompt' string." });
  }

  // Cap the whole engine chain so we always return JSON before the function
  // times out (which would surface to the browser as a 504 -> generic fallback).
  requestDeadline = Date.now() + REQUEST_BUDGET_MS;

  // Resolve keys: env first, then secrets stored in the DB.
  const secrets = await loadSecrets();
  const getKey = (name) => process.env[name] || secrets[name] || "";

  // Ordered rotation: FAST, reliable brains first so a working engine answers in
  // seconds. Slow free models (NVIDIA NIM) are a backstop, tried only after the
  // fast hosted engines are unavailable — otherwise they eat the timeout budget.
  const engines = [tryClaude, tryOpenAI, tryGemini, tryGrok, tryGLM, tryNvidia];
  const errors = [];
  let configured = 0;

  for (const engine of engines) {
    try {
      const result = await engine(prompt, maxTokens, getKey);
      if (!result) continue; // engine not configured -> skip silently
      configured++;
      return res.status(200).json(result); // { text, engine }
    } catch (e) {
      configured++;
      errors.push((e && e.message) || "engine failed");
    }
  }

  if (configured === 0) {
    return res.status(500).json({
      error: "No AI engine is configured. Add a key (ANTHROPIC / NVIDIA / OPENAI / XAI / GEMINI / ZAI) in env or the dashboard Settings panel.",
    });
  }
  return res.status(502).json({ error: "All AI engines failed", detail: errors });
}
