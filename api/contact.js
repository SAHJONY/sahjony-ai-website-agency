// POST /api/contact — PUBLIC, write-only intake for the contact form.
//
// This is the only unauthenticated way to write data. It can ONLY append a
// lead to the fixed "fda:contact:inbox" list — it cannot read anything back and
// cannot touch any other key. The owner reads the inbox via the authenticated
// /api/data endpoint from the dashboard.
import { tgHandleUpdate, tgNotifyOwner } from "../lib/telegram.js";

const INBOX_KEY = "fda:contact:inbox";
const MAX_ENTRIES = 500;        // keep the list bounded
const MAX_LEN = 2000;           // per-field cap

function clean(v) { return String(v == null ? "" : v).slice(0, MAX_LEN); }
function cleanSlug(s) { return String(s || "").toLowerCase().replace(/[^a-z0-9-]/g, "").slice(0, 60); }

async function upstash(path, opts) {
  const url = process.env.UPSTASH_REDIS_REST_URL;
  const token = process.env.UPSTASH_REDIS_REST_TOKEN;
  if (!url || !token) return null;
  return fetch(url.replace(/\/$/, "") + path, {
    ...opts,
    headers: { Authorization: "Bearer " + token, ...(opts && opts.headers) },
  });
}

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST") return res.status(405).json({ error: "Use POST" });

  // Telegram webhook (rewritten here as /api/telegram?tg=1). Two-way client chat —
  // handled before the contact-form logic. See lib/telegram.js.
  if (req.query && req.query.tg) {
    const secret = process.env.TELEGRAM_WEBHOOK_SECRET;
    if (secret && req.headers["x-telegram-bot-api-secret-token"] !== secret) {
      return res.status(401).json({ ok: false });
    }
    let upd = req.body;
    if (typeof upd === "string") { try { upd = JSON.parse(upd); } catch { upd = {}; } }
    const host = req.headers["x-forwarded-host"] || req.headers.host || "";
    const proto = (req.headers["x-forwarded-proto"] || "https").split(",")[0];
    const baseUrl = process.env.APP_URL || (host ? `${proto}://${host}` : "");
    try { await tgHandleUpdate(upd || {}, baseUrl); } catch (_) {}
    return res.status(200).json({ ok: true }); // always 200 so Telegram doesn't retry-storm
  }

  if (!process.env.UPSTASH_REDIS_REST_URL || !process.env.UPSTASH_REDIS_REST_TOKEN) {
    return res.status(500).json({ error: "Inbox is not configured (Upstash env vars missing)." });
  }

  let body = req.body;
  if (typeof body === "string") { try { body = JSON.parse(body); } catch { body = {}; } }
  body = body || {};

  // Leads from a generated client site carry a bizSlug (and use `message` for the
  // note, with no lead type). Everything else is the frontdeskagents.com intake.
  const bizSlug = cleanSlug(body.bizSlug);
  const type = clean(body.type).trim() || (bizSlug ? "Website lead" : "");
  const notes = clean(body.notes).trim() || clean(body.message).trim();

  if (!clean(body.name).trim() || !type || !clean(body.contact).trim()) {
    return res.status(400).json({ error: "name, type and contact are required." });
  }

  const ref = String(body.ref || "").replace(/[^A-Za-z0-9]/g, "").slice(0, 12);
  const entry = {
    id: Date.now(),
    name: clean(body.name), type, contact: clean(body.contact),
    city: clean(body.city), url: clean(body.url), notes,
    bizSlug: bizSlug || undefined,
    ref: ref || undefined,
    at: new Date().toISOString(),
  };

  try {
    // Read current inbox (server-side only), append, write back.
    let list = [];
    const r = await upstash("/get/" + encodeURIComponent(INBOX_KEY), {});
    if (r) {
      const j = await r.json();
      if (j && j.result) { try { const v = JSON.parse(j.result); if (Array.isArray(v)) list = v; } catch {} }
    }
    list.push(entry);
    if (list.length > MAX_ENTRIES) list = list.slice(-MAX_ENTRIES);

    const w = await upstash("/set/" + encodeURIComponent(INBOX_KEY), {
      method: "POST", headers: { "content-type": "text/plain" }, body: JSON.stringify(list),
    });
    if (!w || !w.ok) throw new Error("write failed");

    // If this lead came from a hosted client site, also file it under that site's
    // own list so the business owner sees it in their client dashboard.
    if (bizSlug) {
      try {
        const LKEY = "fda:leads:" + bizSlug;
        let leads = [];
        const lr = await upstash("/get/" + encodeURIComponent(LKEY), {});
        if (lr) { const lj = await lr.json(); if (lj && lj.result) { try { const v = JSON.parse(lj.result); if (Array.isArray(v)) leads = v; } catch {} } }
        leads.push(entry);
        if (leads.length > MAX_ENTRIES) leads = leads.slice(-MAX_ENTRIES);
        await upstash("/set/" + encodeURIComponent(LKEY), {
          method: "POST", headers: { "content-type": "text/plain" }, body: JSON.stringify(leads),
        });
      } catch (_) {}
    }

    // Ping the owner on Telegram so new leads are seen instantly (best-effort).
    tgNotifyOwner(
      `📥 <b>New website request</b>\n<b>${entry.name}</b> — ${entry.type}\n📞 ${entry.contact}` +
      (entry.city ? `\n📍 ${entry.city}` : "") + (entry.notes ? `\n📝 ${entry.notes}` : "")
    ).catch(() => {});

    return res.status(200).json({ ok: true });
  } catch (e) {
    return res.status(502).json({ error: "Could not save your message. Please try again." });
  }
}
