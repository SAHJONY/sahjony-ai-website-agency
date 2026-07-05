// POST /api/generate  { prompt: string, maxTokens?: number }
import { tgNotifyOwner } from "../lib/telegram.js";
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

// ---- Engine: Claude (Anthropic) — the primary, highest-quality brain ----
async function tryClaude(prompt, maxTokens, getKey) {
  const key = getKey("ANTHROPIC_API_KEY");
  if (!key) return null;
  // Default to Claude Opus 4.8 — the current flagship. The old default
  // (claude-3-5-sonnet-20241022) was RETIRED 2025-10-28 and now 404s, which
  // silently knocked the primary engine offline and forced every generation
  // onto a fallback. Opus 4.8 uses adaptive-thinking-only params (no
  // temperature/top_p/budget_tokens — those 400), so the request stays minimal;
  // effort=medium balances design quality against the serverless time budget.
  const model = process.env.CLAUDE_MODEL || "claude-opus-4-8";
  // Give the primary engine real headroom — a full bespoke site is a large,
  // single-shot generation and the 18s per-engine cap would abort it. Bounded
  // by the overall request deadline inside fetchT.
  const timeout = Number(process.env.CLAUDE_TIMEOUT_MS || 50000);
  const r = await fetchT("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: { "content-type": "application/json", "x-api-key": key, "anthropic-version": "2023-06-01" },
    body: JSON.stringify({
      model,
      max_tokens: maxTokens,
      output_config: { effort: process.env.CLAUDE_EFFORT || "medium" },
      messages: [{ role: "user", content: prompt }],
    }),
  }, timeout);
  const data = await r.json();
  if (!r.ok) throw new Error((data && data.error && data.error.message) || "Claude API error");
  // A safety refusal is HTTP 200 with stop_reason "refusal" and empty content —
  // check before reading content so it degrades to the next engine cleanly.
  if (data && data.stop_reason === "refusal") throw new Error("Claude declined the request (refusal)");
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
  const model = process.env.XAI_MODEL || "grok-4";
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
    // --- Lead capture: when the visitor shares a phone/email with Ava, persist
    // it — to the client's own leads (fda:leads:<slug>), the owner inbox, and a
    // Telegram ping. Without this, booking details vanished when the chat closed.
    async function kv(path, opts) {
      const u = process.env.UPSTASH_REDIS_REST_URL, t = process.env.UPSTASH_REDIS_REST_TOKEN;
      if (!u || !t) return null;
      return fetch(u.replace(/\/$/, "") + path, { ...opts, headers: { Authorization: "Bearer " + t, ...(opts && opts.headers) } });
    }
    async function kvGetJson(key, fb) {
      const r = await kv("/get/" + encodeURIComponent(key), {});
      if (!r) return fb;
      const j = await r.json().catch(() => null);
      if (j && j.result) { try { return JSON.parse(j.result); } catch { return fb; } }
      return fb;
    }
    async function kvSetJson(key, v) {
      await kv("/set/" + encodeURIComponent(key), { method: "POST", headers: { "content-type": "text/plain" }, body: JSON.stringify(v) });
    }
    async function captureAvaLead(slugArg, bizArg, msgsArg, cfgArg) {
      try {
        const userTexts = msgsArg.filter((m) => m && m.role !== "assistant").map((m) => String(m.content || "")).slice(-6);
        const blob = userTexts.join("\n");
        const email = (blob.match(/[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/) || [])[0] || "";
        const phoneRaw = (blob.match(/\+?\d[\d\s().-]{6,}\d/) || [])[0] || "";
        const phone = phoneRaw && phoneRaw.replace(/\D/g, "").length >= 8 ? phoneRaw.trim() : "";
        const contact = email || phone;
        if (!contact) return;
        const nameM = blob.match(/(?:my name is|i am|i'm|soy|me llamo)\s+([A-Za-zÀ-ÿ' -]{2,40})/i);
        const name = nameM ? nameM[1].trim().replace(/\s+/g, " ") : "Ava chat visitor";
        const norm = (s) => String(s).toLowerCase().replace(/[^a-z0-9@]/g, "");
        const dayAgo = Date.now() - 86400000;
        const entry = {
          id: Date.now(), name, type: "Ava booking/lead", contact,
          notes: userTexts.slice(-3).join(" · ").slice(0, 800),
          bizSlug: slugArg || undefined, at: new Date().toISOString(),
        };
        // Client's own leads list (only when this Ava belongs to a hosted site).
        if (slugArg) {
          let leads = (await kvGetJson("fda:leads:" + slugArg, [])) || [];
          if (!Array.isArray(leads)) leads = [];
          if (leads.some((l) => norm(l.contact || "") === norm(contact) && Number(l.id) > dayAgo)) return; // same visitor, same day
          leads.push(entry);
          if (leads.length > 500) leads = leads.slice(-500);
          await kvSetJson("fda:leads:" + slugArg, leads);
        }
        // Owner inbox (dedupe there too when no slug).
        let inbox = (await kvGetJson("fda:contact:inbox", [])) || [];
        if (!Array.isArray(inbox)) inbox = [];
        if (!inbox.some((l) => norm(l.contact || "") === norm(contact) && Number(l.id) > dayAgo && (l.bizSlug || "") === (slugArg || ""))) {
          inbox.push({ ...entry, city: slugArg || "" });
          if (inbox.length > 500) inbox = inbox.slice(-500);
          await kvSetJson("fda:contact:inbox", inbox);
          tgNotifyOwner(`💬 <b>Ava captured a lead</b>${slugArg ? " (" + slugArg + ")" : ""}\n<b>${name}</b>\n📞 ${contact}\n📝 ${entry.notes.slice(0, 300)}`).catch(() => {});
          // Also email the CLIENT if their Ava config has a notify email.
          const to = cfgArg && cfgArg.notifyEmail, rk = process.env.RESEND_API_KEY;
          if (to && rk) {
            fetch("https://api.resend.com/emails", {
              method: "POST", headers: { Authorization: "Bearer " + rk, "content-type": "application/json" },
              body: JSON.stringify({ from: process.env.OUTREACH_FROM || "onboarding@resend.dev", to, subject: `💬 New lead from Ava — ${bizArg}`, text: `Ava just captured a lead on your website:\n\nName: ${name}\nContact: ${contact}\n\nWhat they said:\n${entry.notes}\n\nReply to them soon!` }),
            }).catch(() => {});
          }
        }
      } catch (_) { /* lead capture must never break the chat */ }
    }
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
    // Persist any contact info the visitor shared BEFORE replying (serverless may
    // kill un-awaited work after the response; a lead is worth ~100ms).
    await captureAvaLead(slug, biz, msgs, cfg);
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
