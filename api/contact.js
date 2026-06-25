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
    try { await tgHandleUpdate(upd || {}); } catch (_) {}
    return res.status(200).json({ ok: true }); // always 200 so Telegram doesn't retry-storm
  }

  if (!process.env.UPSTASH_REDIS_REST_URL || !process.env.UPSTASH_REDIS_REST_TOKEN) {
    return res.status(500).json({ error: "Inbox is not configured (Upstash env vars missing)." });
  }

  let body = req.body;
  if (typeof body === "string") { try { body = JSON.parse(body); } catch { body = {}; } }
  body = body || {};

  if (!clean(body.name).trim() || !clean(body.type).trim() || !clean(body.contact).trim()) {
    return res.status(400).json({ error: "name, type and contact are required." });
  }

  const entry = {
    id: Date.now(),
    name: clean(body.name), type: clean(body.type), contact: clean(body.contact),
    city: clean(body.city), url: clean(body.url), notes: clean(body.notes),
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
