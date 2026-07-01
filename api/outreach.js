// POST /api/outreach — owner outreach + AVA VOICE (Bland.ai). Folded into one
// function to respect the 12-function cap.
//
//   Email/SMS (owner):   { channel:"email"|"sms", to, subject?, message }
//   Voice provision:     { voice:true, action:"provision", slug, areaCode? }  -> buys a Bland number, wires inbound Ava
//   Voice outbound call: { voice:true, action:"call", to, slug?, task? }      -> Ava calls someone
//   Voice status:        { voice:true, action:"status", slug }                -> the client's number/config
//   Inbound webhook:     POST /api/bland  (rewritten -> ?bland=1)             -> Bland posts call results here (public, secret-gated)
//
// Email: RESEND_API_KEY (+ OUTREACH_FROM).  SMS: TWILIO_*.  Voice: BLAND_API_KEY.

import { safeEqual } from "../lib/guard.js";

const BLAND = (process.env.BLAND_BASE_URL || "https://api.bland.ai").replace(/\/$/, "");

async function up(path, opts) {
  const url = process.env.UPSTASH_REDIS_REST_URL, token = process.env.UPSTASH_REDIS_REST_TOKEN;
  if (!url || !token) return null;
  return fetch(url.replace(/\/$/, "") + path, { ...opts, headers: { Authorization: "Bearer " + token, ...(opts && opts.headers) } });
}
async function getJSON(key, fb) { const r = await up("/get/" + encodeURIComponent(key), {}); if (!r) return fb; const j = await r.json(); if (j && j.result) { try { return JSON.parse(j.result); } catch { return fb; } } return fb; }
async function setJSON(key, obj) { await up("/set/" + encodeURIComponent(key), { method: "POST", headers: { "content-type": "text/plain" }, body: JSON.stringify(obj) }); }

async function bland(path, method, payload) {
  const key = process.env.BLAND_API_KEY;
  if (!key) return { ok: false, status: 500, j: { error: "BLAND_API_KEY not set" } };
  const r = await fetch(BLAND + path, {
    method, headers: { authorization: key, "content-type": "application/json" },
    body: payload ? JSON.stringify(payload) : undefined,
  });
  const j = await r.json().catch(() => ({}));
  return { ok: r.ok, status: r.status, j };
}

// Build Ava's voice task/prompt from a client's saved config.
function avaTask(cfg, business) {
  const c = cfg || {};
  const lines = [
    `You are Ava, the friendly, professional phone receptionist for ${business || c.business || "the business"}.`,
    `Speak naturally and warmly. Detect and speak the caller's language.`,
    c.services ? `Services: ${c.services}.` : "",
    c.hours ? `Hours: ${c.hours}.` : "",
    c.address ? `Location: ${c.address}.` : "",
    c.pricing ? `Pricing notes: ${c.pricing}.` : "",
    c.booking !== false ? `You can book appointments — collect the caller's name, phone, preferred day/time, and service, then confirm it back.` : "",
    c.calendarUrl ? `If they prefer, share this booking link: ${c.calendarUrl}.` : "",
    `Never invent facts you weren't given; offer to take a message and have the team follow up.`,
    c.instructions ? `Extra instructions: ${c.instructions}` : "",
  ].filter(Boolean);
  return lines.join(" ");
}

async function notifyOwner(subject, text) {
  try {
    const rk = process.env.RESEND_API_KEY, to = process.env.NOTIFY_EMAIL || process.env.SALES_EMAIL;
    if (rk && to) {
      await fetch("https://api.resend.com/emails", {
        method: "POST", headers: { Authorization: "Bearer " + rk, "content-type": "application/json" },
        body: JSON.stringify({ from: process.env.OUTREACH_FROM || "onboarding@resend.dev", to, subject, text }),
      });
    }
  } catch (_) {}
}

// Rotating marketing captions for the daily auto-post cron. A different one goes
// out each day (indexed by day-of-year) so socials stay active hands-free.
function autoCaptions(site) {
  return [
    "Your business deserves a stunning website — live this week, with a 24/7 AI receptionist that answers every customer. Free preview 👉 " + site + " #localbusiness #smallbusiness",
    "Never miss a call or message again. Ava, our AI receptionist, answers your customers 24/7, books appointments, and captures every lead 👉 " + site,
    "Still have an outdated website (or none)? We build modern, mobile sites that bring customers in — from $899. See yours free 👉 " + site,
    "💼 Earn 25% commission selling AI websites to local businesses. $0 to start, your own hours. Apply 👉 " + site + "/apply.html",
    "A website + AI receptionist that works while you sleep. Get found on Google, answer every customer, book more jobs 👉 " + site,
    "Local owners: your competitors are online. Get a premium site + 24/7 AI receptionist, live in days 👉 " + site,
    "One link. Every customer. Websites + AI phone/chat receptionist for local businesses 👉 " + site,
  ];
}

export default async function handler(req, res) {
  // ---- Daily AUTO-POST cron (Vercel Cron -> /api/outreach?autopost=1) ----
  // Cron-gated by CRON_SECRET (Vercel attaches it as a Bearer token). Posts one
  // rotating caption to MARKETING_WEBHOOK_URL so socials update hands-free.
  if (req.query && req.query.autopost) {
    const secret = process.env.CRON_SECRET;
    const auth = req.headers.authorization || "";
    const ok = !secret || safeEqual(auth, "Bearer " + secret) || safeEqual(String(req.query.token || ""), secret);
    if (!ok) return res.status(401).json({ error: "Unauthorized" });
    const hook = process.env.MARKETING_WEBHOOK_URL;
    if (!hook) return res.status(200).json({ skipped: "MARKETING_WEBHOOK_URL not set" });
    const site = (process.env.APP_URL || "https://www.frontdeskagents.com").replace(/\/$/, "");
    const caps = autoCaptions(site);
    const day = Math.floor((Date.now() - Date.UTC(new Date().getUTCFullYear(), 0, 0)) / 86400000);
    const today = new Date().toISOString().slice(0, 10);

    const mk = (await getJSON("fda:marketing", {})) || {};
    const schedule = Array.isArray(mk.schedule) ? mk.schedule : [];
    // Any scheduled posts due today (or overdue) that haven't gone out yet.
    const due = schedule.filter((s) => s && !s.sent && String(s.date || "") <= today && s.text);
    const toSend = due.map((s) => ({ text: String(s.text).slice(0, 3000), via: "scheduled", ref: s })).concat([{ text: caps[day % caps.length], via: "auto" }]);

    let log = Array.isArray(mk.log) ? mk.log : [];
    let posted = 0;
    for (const item of toSend) {
      try {
        const r = await fetch(hook, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ text: item.text, link: site, source: "frontdeskagents-cron", at: new Date().toISOString() }) });
        const ok = r.ok; if (ok) posted++;
        if (item.ref) item.ref.sent = ok;
        log.unshift({ text: item.text, via: item.via, ok, at: new Date().toISOString() });
      } catch (_) { log.unshift({ text: item.text, via: item.via, ok: false, at: new Date().toISOString() }); }
    }
    mk.log = log.slice(0, 100);
    mk.schedule = schedule.filter((s) => !(s.sent && String(s.date || "") < today)); // drop old sent
    try { await setJSON("fda:marketing", mk); } catch (_) {}

    // ---- Per-client autopilot: post each opted-in client's latest promotion to
    // their own connected scheduler (best-effort, bounded). ----
    let clientPosted = 0;
    try {
      const appUrl = (process.env.APP_URL || site).replace(/\/$/, "");
      let index = (await getJSON("fda:sites:index", [])) || [];
      if (Array.isArray(index)) {
        for (const s of index.slice(0, 60)) {
          const slug = s && s.slug; if (!slug) continue;
          const soc = await getJSON("fda:social:" + slug, null);
          if (!soc || !soc.autopilot || !soc.webhook) continue;
          const content = (await getJSON("fda:content:" + slug, {})) || {};
          const promos = Array.isArray(content.promos) ? content.promos : [];
          const p = promos[0];
          if (!p) continue; // nothing new to say — don't post filler
          const link = appUrl + "/s/" + slug;
          const text = [p.title, p.body].filter(Boolean).join(" — ") + " " + link;
          if (!text.trim()) continue;
          // Only post when the promo actually changed — otherwise the daily cron
          // would repost the identical promo forever and spam the client's feed.
          if (soc.lastPosted === text) continue;
          try {
            const rr = await fetch(soc.webhook, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ text, link, source: "frontdeskagents-client", slug, at: new Date().toISOString() }) });
            if (rr.ok) {
              clientPosted++;
              soc.lastPosted = text; soc.lastPostedAt = new Date().toISOString();
              await setJSON("fda:social:" + slug, soc);
            }
          } catch (_) {}
        }
      }
    } catch (_) {}

    return res.status(200).json({ ok: true, posted, clientPosted });
  }

  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, x-admin-token");
  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST") return res.status(405).json({ error: "Use POST" });

  let body = req.body;
  if (typeof body === "string") { try { body = JSON.parse(body); } catch { body = {}; } }
  body = body || {};

  // ---- Bland INBOUND webhook (public; gated by secret) — /api/bland ----
  if (req.query && req.query.bland) {
    const secret = process.env.BLAND_WEBHOOK_SECRET;
    if (secret && !safeEqual(String(req.query.token || ""), secret)) return res.status(401).json({ ok: false });
    try {
      const summary = body.summary || body.concatenated_transcript || body.transcript || "(call completed)";
      const from = body.from || body.caller || body.phone_number || "";
      const slug = req.query.slug || (body.metadata && body.metadata.slug) || "";
      // Append to the owner's contact inbox so calls show up alongside leads.
      let inbox = await getJSON("fda:contact:inbox", []); if (!Array.isArray(inbox)) inbox = [];
      inbox.push({ id: Date.now(), name: "📞 Call — " + (from || "unknown"), type: "Ava voice", contact: from, city: slug, notes: String(summary).slice(0, 1500), at: new Date().toISOString() });
      if (inbox.length > 500) inbox = inbox.slice(-500);
      await setJSON("fda:contact:inbox", inbox);
      await notifyOwner("📞 New call handled by Ava" + (slug ? " (" + slug + ")" : ""), (from ? "From: " + from + "\n\n" : "") + String(summary).slice(0, 3000));
    } catch (_) {}
    return res.status(200).json({ received: true });
  }

  // ---- Everything below is owner-only ----
  const admin = process.env.ADMIN_PASSWORD;
  if (admin && req.headers["x-admin-token"] !== admin) return res.status(401).json({ error: "Unauthorized." });

  // ---- Autonomous social posting ----
  // Push a caption to your scheduler/auto-poster (Zapier / Make / Buffer / n8n)
  // which fans it out to your connected networks. Set MARKETING_WEBHOOK_URL to a
  // catch webhook there. Keeps social API/OAuth complexity out of this app.
  if (body.post) {
    const hook = process.env.MARKETING_WEBHOOK_URL;
    if (!hook) return res.status(400).json({ error: "Set MARKETING_WEBHOOK_URL (a Zapier/Make/Buffer webhook) to enable auto-posting." });
    const text = String(body.text || "").slice(0, 3000).trim();
    if (!text) return res.status(400).json({ error: "Nothing to post." });
    const payload = {
      text,
      link: String(body.link || "").slice(0, 400),
      platforms: Array.isArray(body.platforms) ? body.platforms.slice(0, 20) : undefined,
      source: "frontdeskagents",
      at: new Date().toISOString(),
    };
    try {
      const r = await fetch(hook, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(payload) });
      if (!r.ok) return res.status(502).json({ error: "Scheduler webhook returned " + r.status });
      try {
        const mk = (await getJSON("fda:marketing", {})) || {};
        mk.log = ([{ text, via: "manual", ok: true, at: new Date().toISOString() }].concat(Array.isArray(mk.log) ? mk.log : [])).slice(0, 100);
        await setJSON("fda:marketing", mk);
      } catch (_) {}
      return res.status(200).json({ ok: true });
    } catch (e) {
      return res.status(502).json({ error: "Could not reach the scheduler webhook." });
    }
  }

  // ---- AVA VOICE (Bland) ----
  if (body.voice) {
    if (!process.env.BLAND_API_KEY) return res.status(500).json({ error: "Set BLAND_API_KEY to enable Ava voice." });
    const slug = String(body.slug || "").toLowerCase().replace(/[^a-z0-9-]/g, "").slice(0, 60);
    const cfg = slug ? await getJSON("fda:ava:" + slug, {}) : {};
    const business = body.business || cfg.business || slug || "the business";
    const host = req.headers["x-forwarded-host"] || req.headers.host || "";
    const proto = (req.headers["x-forwarded-proto"] || "https").split(",")[0];
    const appUrl = process.env.APP_URL || (host ? `${proto}://${host}` : "");
    const inboundWebhook = appUrl + "/api/bland?token=" + encodeURIComponent(process.env.BLAND_WEBHOOK_SECRET || "") + (slug ? "&slug=" + slug : "");

    if (body.action === "status") {
      return res.status(200).json({ ok: true, slug, phone: cfg.phone || "", voice: cfg.voice || process.env.BLAND_AGENT_NAME || "Ava", configured: !!cfg.phone });
    }

    if (body.action === "provision") {
      // Buy a phone number and wire it to Ava (inbound).
      const buy = await bland("/v1/inbound/purchase", "POST", body.areaCode ? { area_code: String(body.areaCode) } : {});
      if (!buy.ok) return res.status(buy.status || 502).json({ error: "Bland purchase failed", detail: buy.j });
      const phone = buy.j.phone_number || buy.j.number || (buy.j.data && buy.j.data.phone_number) || "";
      if (!phone) return res.status(502).json({ error: "Bland did not return a number", detail: buy.j });
      // Configure the inbound number with Ava's task + our webhook.
      await bland("/v1/inbound/" + encodeURIComponent(phone), "POST", {
        prompt: avaTask(cfg, business),
        first_sentence: cfg.greeting || `Thank you for calling ${business}, this is Ava — how can I help?`,
        voice: cfg.voice || process.env.BLAND_AGENT_NAME || "Ava",
        language: cfg.language || process.env.BLAND_DEFAULT_LANGUAGE || "babel",
        webhook: inboundWebhook,
        record: true,
      });
      const next = Object.assign({}, cfg, { business, phone, provisionedAt: new Date().toISOString() });
      if (slug) await setJSON("fda:ava:" + slug, next);
      await notifyOwner("📞 Ava got a phone number" + (slug ? " for " + slug : ""), "New Ava voice line: " + phone);
      return res.status(200).json({ ok: true, phone, slug });
    }

    if (body.action === "call") {
      const to = String(body.to || "").trim();
      if (!to) return res.status(400).json({ error: "'to' phone number is required." });
      const call = await bland("/v1/calls", "POST", {
        phone_number: to,
        from: cfg.phone || process.env.BLAND_OUTBOUND_NUMBER || undefined,
        task: body.task || avaTask(cfg, business),
        voice: cfg.voice || process.env.BLAND_AGENT_NAME || "Ava",
        language: cfg.language || process.env.BLAND_DEFAULT_LANGUAGE || "babel",
        first_sentence: body.firstSentence || undefined,
        webhook: inboundWebhook,
        record: true,
      });
      if (!call.ok) return res.status(call.status || 502).json({ error: "Bland call failed", detail: call.j });
      return res.status(200).json({ ok: true, call_id: call.j.call_id || call.j.id || "", to });
    }

    return res.status(400).json({ error: "Unknown voice action. Use provision | call | status." });
  }

  // ---- Email / SMS outreach (existing behavior) ----
  const channel = body.channel === "sms" ? "sms" : "email";
  const to = String(body.to || "").trim();
  const message = String(body.message || "").trim();
  const subject = String(body.subject || "A quick website idea for your business").slice(0, 160);
  if (!to || !message) return res.status(400).json({ error: "'to' and 'message' are required." });

  try {
    if (channel === "email") {
      const rk = process.env.RESEND_API_KEY;
      if (!rk) return res.status(500).json({ error: "Set RESEND_API_KEY to send emails." });
      const from = process.env.OUTREACH_FROM || "onboarding@resend.dev";
      const r = await fetch("https://api.resend.com/emails", {
        method: "POST",
        headers: { Authorization: "Bearer " + rk, "content-type": "application/json" },
        body: JSON.stringify({ from, to, subject, text: message }),
      });
      const j = await r.json();
      if (!r.ok) return res.status(r.status).json({ error: (j && (j.message || j.error)) || "Email failed" });
      return res.status(200).json({ ok: true, id: j.id });
    }

    const sid = process.env.TWILIO_ACCOUNT_SID, tok = process.env.TWILIO_AUTH_TOKEN, from = process.env.TWILIO_FROM;
    if (!sid || !tok || !from) return res.status(500).json({ error: "Set TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN and TWILIO_FROM to send SMS." });
    const form = new URLSearchParams({ To: to, From: from, Body: message });
    const r = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${sid}/Messages.json`, {
      method: "POST",
      headers: { Authorization: "Basic " + Buffer.from(sid + ":" + tok).toString("base64"), "content-type": "application/x-www-form-urlencoded" },
      body: form.toString(),
    });
    const j = await r.json();
    if (!r.ok) return res.status(r.status).json({ error: (j && j.message) || "SMS failed" });
    return res.status(200).json({ ok: true, sid: j.sid });
  } catch (e) {
    return res.status(500).json({ error: e.message || "Request failed" });
  }
}
