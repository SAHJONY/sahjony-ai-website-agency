// GET /api/site?slug=...   (mapped to /s/:slug)  — PUBLIC.
// Serves a published website's HTML. Read-only; can ONLY read fda:site:<slug>
// (slug is sanitized), so it can't reach any other stored key.
//
// POST /api/site  — CLIENT PORTAL (business owner). A business that bought a
// site logs in with its slug + portal password (set by the owner in /ava.html →
// stored at fda:portal:<slug>). Authenticated by password on every call
// (stateless); can ONLY reach its own slug's records:
//   fda:portal:<slug>  (creds + change requests)   fda:ava:<slug> (receptionist)
//   fda:site:<slug>    (name/status, read-only)     fda:leads:<slug> (its leads)
// It can never read another business's data or any admin/secret key.
import { rateLimit, safeEqual, clientIp } from "../lib/guard.js";

function cleanSlug(s) { return String(s || "").toLowerCase().replace(/[^a-z0-9-]/g, "").slice(0, 60); }

function upstashBase() {
  const url = process.env.UPSTASH_REDIS_REST_URL;
  const token = process.env.UPSTASH_REDIS_REST_TOKEN;
  if (!url || !token) return null;
  return { base: url.replace(/\/$/, ""), auth: { Authorization: "Bearer " + token } };
}
async function kvGet(key) {
  const u = upstashBase();
  if (!u) return null;
  const r = await fetch(u.base + "/get/" + encodeURIComponent(key), { headers: u.auth });
  const j = await r.json().catch(() => null);
  if (j && j.result) { try { return JSON.parse(j.result); } catch { return j.result; } }
  return null;
}
async function kvSet(key, value) {
  const u = upstashBase();
  if (!u) throw new Error("Storage not configured");
  const r = await fetch(u.base + "/set/" + encodeURIComponent(key), {
    method: "POST", headers: { ...u.auth, "content-type": "text/plain" },
    body: JSON.stringify(value == null ? {} : value),
  });
  if (!r.ok) throw new Error("write failed");
}

// Fields a client may edit on their own receptionist (never phone/status/etc.).
const AVA_EDITABLE = ["greeting", "services", "hours", "address", "pricing", "calendarUrl", "instructions", "language", "notifyEmail"];

// ---- Client-editable live content (menu/prices + promotions/events) ---------
const MAX_CONTENT_BYTES = 3_500_000;   // whole content blob (keeps Redis happy)
const MAX_MENU = 120, MAX_PROMOS = 40;

function esc(s) { return String(s == null ? "" : s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c])); }
// Only allow safe media sources: https/http URLs or data: images/av. Blocks
// javascript:, etc. Returns "" if unsafe.
function safeUrl(u) {
  const s = String(u || "").trim();
  if (/^https?:\/\//i.test(s)) return s;
  if (/^data:(image|video|audio)\//i.test(s)) return s;
  return "";
}
function mediaTag(m) {
  if (!m || typeof m !== "object") return "";
  const url = safeUrl(m.url);
  if (!url) return "";
  const box = "width:100%;border-radius:14px 14px 0 0;display:block;background:#04080f;max-height:280px;object-fit:cover";
  if (m.type === "video") return `<video src="${esc(url)}" controls playsinline preload="metadata" style="${box}"></video>`;
  if (m.type === "audio") return `<audio src="${esc(url)}" controls preload="none" style="width:100%;margin-bottom:-4px"></audio>`;
  return `<img src="${esc(url)}" alt="${esc(m.alt || "")}" loading="lazy" style="${box}">`;
}

// Build the injected "Menu & Prices" + "Promotions & Events" sections, styled to
// match the site's dark theme and per-business accent. Returns "" if empty.
function renderContent(content, acc, accText) {
  if (!content || typeof content !== "object") return "";
  const menu = Array.isArray(content.menu) ? content.menu.filter((i) => i && (i.name || i.price)) : [];
  const promos = Array.isArray(content.promos) ? content.promos.filter((p) => p && (p.title || p.body || (p.media && p.media.url))) : [];
  if (!menu.length && !promos.length) return "";
  const wrap = "max-width:1180px;margin:0 auto;padding:0 28px";
  const h2 = "font-family:'Fraunces',Georgia,serif;font-size:clamp(30px,4.4vw,50px);font-weight:700;letter-spacing:-.02em;margin:0 0 8px;color:#fff";
  const card = `background:rgba(13,26,45,.55);border:1px solid ${hexA(acc,.18)};border-radius:16px;backdrop-filter:blur(12px)`;

  let menuHtml = "";
  if (menu.length) {
    // Group by category (preserve first-seen order).
    const cats = []; const byCat = {};
    menu.slice(0, MAX_MENU).forEach((i) => { const c = String(i.category || "").trim() || "__"; if (!byCat[c]) { byCat[c] = []; cats.push(c); } byCat[c].push(i); });
    const groups = cats.map((c) => {
      const rows = byCat[c].map((i) => `
        <div style="display:flex;align-items:baseline;gap:12px;padding:13px 0;border-bottom:1px dashed ${hexA(acc,.16)}">
          <div style="flex:1;min-width:0"><div style="font-weight:700;font-size:17px;color:#eef3fb">${esc(i.name || "")}</div>${i.desc ? `<div style="font-size:14px;color:#9fb3c9;margin-top:3px;line-height:1.5">${esc(i.desc)}</div>` : ""}</div>
          ${i.price ? `<div style="font-weight:800;font-size:17px;color:${esc(acc)};white-space:nowrap">${esc(i.price)}</div>` : ""}
        </div>`).join("");
      return `<div style="${card};padding:22px 26px;margin-bottom:18px">${c !== "__" ? `<div style="font-family:'Fraunces',serif;font-size:20px;font-weight:700;color:#fff;margin-bottom:8px">${esc(c)}</div>` : ""}${rows}</div>`;
    }).join("");
    menuHtml = `<section id="g-menu" style="padding:90px 0;background:#04080f;border-top:1px solid ${hexA(acc, .12)}"><div style="${wrap}">
      <div style="font-size:12px;font-weight:700;letter-spacing:.28em;text-transform:uppercase;color:${esc(acc)};margin-bottom:14px">${esc(content.menuKicker || "Menu")}</div>
      <h2 style="${h2}">${esc(content.menuTitle || "Menu & Prices")}</h2>
      <div style="margin-top:30px;max-width:820px">${groups}</div>
    </div></section>`;
  }

  let promoHtml = "";
  if (promos.length) {
    const cards = promos.slice(0, MAX_PROMOS).map((p) => {
      const when = [p.starts, p.ends].filter(Boolean).map((d) => esc(d)).join(" – ");
      return `<div style="${card};overflow:hidden;display:flex;flex-direction:column">
        ${p.media ? mediaTag(p.media) : ""}
        <div style="padding:20px 22px">
          ${when ? `<div style="font-size:12px;font-weight:700;letter-spacing:.12em;text-transform:uppercase;color:${esc(acc)};margin-bottom:8px">${when}</div>` : ""}
          ${p.title ? `<div style="font-family:'Fraunces',serif;font-size:22px;font-weight:700;color:#fff;margin-bottom:6px">${esc(p.title)}</div>` : ""}
          ${p.body ? `<div style="font-size:15px;color:#c4d2e4;line-height:1.6">${esc(p.body)}</div>` : ""}
        </div>
      </div>`;
    }).join("");
    promoHtml = `<section id="g-promos" style="padding:90px 0;background:#0a1424;border-top:1px solid ${hexA(acc, .12)}"><div style="${wrap}">
      <div style="font-size:12px;font-weight:700;letter-spacing:.28em;text-transform:uppercase;color:${esc(acc)};margin-bottom:14px">${esc(content.promoKicker || "What's on")}</div>
      <h2 style="${h2}">${esc(content.promoTitle || "Promotions & Events")}</h2>
      <div style="margin-top:34px;display:grid;grid-template-columns:repeat(auto-fill,minmax(300px,1fr));gap:22px">${cards}</div>
    </div></section>`;
  }

  return promoHtml + menuHtml;
}
function hexA(hex, a) {
  let h = String(hex || "").replace("#", "");
  if (h.length === 3) h = h.split("").map((c) => c + c).join("");
  const n = parseInt(h, 16);
  if (h.length !== 6 || isNaN(n)) return `rgba(232,196,118,${a})`;
  return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${a})`;
}

async function handlePortal(req, res) {
  let body = req.body;
  if (typeof body === "string") { try { body = JSON.parse(body); } catch { body = {}; } }
  body = body || {};
  const action = body.action;
  const slug = cleanSlug(body.slug);
  if (!slug) return res.status(400).json({ error: "Missing site." });

  // Brute-force guard: cap password attempts per IP (and per IP+slug) so a
  // client's portal password can't be guessed by hammering this endpoint.
  const rl = await rateLimit(req, "portal", { limit: 20, windowSec: 600, key: clientIp(req) + ":" + slug });
  if (rl.limited) {
    res.setHeader("retry-after", String(rl.retryAfter));
    return res.status(429).json({ error: "Too many attempts — please wait a few minutes and try again." });
  }

  const creds = await kvGet("fda:portal:" + slug);
  const pw = creds && typeof creds === "object" ? String(creds.password || "") : "";
  // No portal password set yet -> the owner hasn't enabled the client dashboard.
  if (!pw) return res.status(403).json({ error: "This site has no client dashboard yet. Ask your provider to enable it." });
  if (!safeEqual(String(body.password || ""), pw)) return res.status(401).json({ error: "Wrong password." });

  const site = (await kvGet("fda:site:" + slug)) || {};
  const host = req.headers["x-forwarded-host"] || req.headers.host || "";
  const proto = (req.headers["x-forwarded-proto"] || "https").split(",")[0];
  const origin = process.env.APP_URL || (host ? `${proto}://${host}` : "");
  const siteInfo = {
    name: site.name || slug, status: site.status || "active",
    url: (site.domain ? "https://" + String(site.domain).replace(/^https?:\/\//, "") : origin + "/s/" + slug),
    ava: site.ava !== false,
    industry: site.bizType || "", city: site.bizCity || "",
  };

  if (action === "login") {
    return res.status(200).json({ ok: true, business: siteInfo.name, site: siteInfo });
  }

  if (action === "get") {
    const ava = (await kvGet("fda:ava:" + slug)) || {};
    const safeAva = {}; AVA_EDITABLE.forEach((f) => { if (ava[f] != null) safeAva[f] = ava[f]; });
    safeAva.booking = ava.booking !== false; safeAva.phone = ava.phone || "";
    const leadsRaw = (await kvGet("fda:leads:" + slug)) || [];
    const leads = Array.isArray(leadsRaw) ? leadsRaw.slice(-100).reverse() : [];
    const views = (await kvGet("fda:views:" + slug)) || 0;
    const content = (await kvGet("fda:content:" + slug)) || {};
    const socialRaw = (await kvGet("fda:social:" + slug)) || {};
    // Never expose the owner-set posting webhook to the client; just whether it's on.
    const social = {
      handles: socialRaw.handles || {}, needsSetup: !!socialRaw.needsSetup,
      setupStatus: socialRaw.setupStatus || "", kit: socialRaw.kit || null,
      autopilot: !!socialRaw.autopilot, connected: !!socialRaw.webhook,
    };
    return res.status(200).json({ ok: true, site: siteInfo, ava: safeAva, leads, content, social, stats: { views: Number(views) || 0, leads: leads.length } });
  }

  // Client saves their social handles / requests done-for-you setup / AI kit /
  // autopilot preference. The owner's per-client posting webhook is never touched
  // here (owner-only, via /api/data).
  if (action === "social-save") {
    const s = body.social || {};
    const rec = (await kvGet("fda:social:" + slug)) || {};
    const SOCIAL_KEYS = ["facebook", "instagram", "tiktok", "youtube", "x", "linkedin", "threads", "pinterest", "whatsapp", "telegram", "google", "yelp"];
    const handles = {};
    const inH = s.handles || {};
    SOCIAL_KEYS.forEach((k) => { if (typeof inH[k] === "string" && inH[k].trim()) handles[k] = inH[k].trim().slice(0, 200); });
    rec.handles = handles;
    if (typeof s.needsSetup === "boolean") rec.needsSetup = s.needsSetup;
    if (s.needsSetup && !rec.setupStatus) rec.setupStatus = "requested";
    if (typeof s.autopilot === "boolean") rec.autopilot = s.autopilot;
    if (s.kit && typeof s.kit === "object") {
      // Only persist hosted (http/https) image URLs — skip huge data: URLs.
      const httpUrl = (u) => (/^https?:\/\//i.test(String(u || "")) ? String(u).slice(0, 2000) : "");
      rec.kit = {
        bio: String(s.kit.bio || "").slice(0, 600),
        hashtags: String(s.kit.hashtags || "").slice(0, 600),
        posts: (Array.isArray(s.kit.posts) ? s.kit.posts : []).slice(0, 12).map((p) => String(p || "").slice(0, 600)),
        profileIdea: String(s.kit.profileIdea || "").slice(0, 600),
        profileImage: httpUrl(s.kit.profileImage),
        coverImage: httpUrl(s.kit.coverImage),
        at: new Date().toISOString(),
      };
    }
    rec.updatedAt = new Date().toISOString();
    await kvSet("fda:social:" + slug, rec);
    // If they asked for done-for-you setup, drop it in the owner's inbox.
    if (s.needsSetup) {
      try {
        const INBOX = "fda:contact:inbox";
        let list = (await kvGet(INBOX)) || []; if (!Array.isArray(list)) list = [];
        list.push({ id: Date.now(), name: siteInfo.name, type: "Social setup request", contact: "portal:" + slug, notes: "Client requested done-for-you social media setup.", at: new Date().toISOString() });
        if (list.length > 500) list = list.slice(-500);
        await kvSet(INBOX, list);
      } catch (_) {}
    }
    return res.status(200).json({ ok: true, social: { handles: rec.handles, needsSetup: !!rec.needsSetup, setupStatus: rec.setupStatus || "", kit: rec.kit || null, autopilot: !!rec.autopilot, connected: !!rec.webhook } });
  }

  // Save the client's live menu/prices + promotions/events. Sanitized + capped.
  if (action === "save-content") {
    const c = body.content || {};
    const menu = (Array.isArray(c.menu) ? c.menu : []).slice(0, MAX_MENU).map((i) => ({
      name: String(i && i.name || "").slice(0, 120),
      price: String(i && i.price || "").slice(0, 40),
      desc: String(i && i.desc || "").slice(0, 400),
      category: String(i && i.category || "").slice(0, 60),
    })).filter((i) => i.name || i.price);
    const promos = (Array.isArray(c.promos) ? c.promos : []).slice(0, MAX_PROMOS).map((p) => {
      const out = {
        title: String(p && p.title || "").slice(0, 140),
        body: String(p && p.body || "").slice(0, 1500),
        starts: String(p && p.starts || "").slice(0, 40),
        ends: String(p && p.ends || "").slice(0, 40),
      };
      if (p && p.media && safeUrl(p.media.url)) {
        const t = ["image", "video", "audio"].includes(p.media.type) ? p.media.type : "image";
        out.media = { type: t, url: safeUrl(p.media.url), alt: String(p.media.alt || "").slice(0, 140) };
      }
      return out;
    }).filter((p) => p.title || p.body || p.media);
    const record = {
      menu, promos,
      menuTitle: String(c.menuTitle || "").slice(0, 80),
      menuKicker: String(c.menuKicker || "").slice(0, 40),
      promoTitle: String(c.promoTitle || "").slice(0, 80),
      promoKicker: String(c.promoKicker || "").slice(0, 40),
      updatedAt: new Date().toISOString(),
    };
    const bytes = Buffer.byteLength(JSON.stringify(record), "utf8");
    if (bytes > MAX_CONTENT_BYTES) {
      return res.status(413).json({ error: "Too much media. Use shorter videos/audio or paste hosted links (YouTube, etc.) instead of uploading large files." });
    }
    await kvSet("fda:content:" + slug, record);
    return res.status(200).json({ ok: true });
  }

  if (action === "save") {
    const incoming = body.ava || {};
    const ava = (await kvGet("fda:ava:" + slug)) || {};
    AVA_EDITABLE.forEach((f) => { if (typeof incoming[f] === "string") ava[f] = incoming[f].slice(0, 2000); });
    if (typeof incoming.booking === "boolean") ava.booking = incoming.booking;
    ava.business = site.name || ava.business || slug;
    ava.updatedAt = new Date().toISOString();
    await kvSet("fda:ava:" + slug, ava);
    return res.status(200).json({ ok: true });
  }

  if (action === "request") {
    const reqObj = {
      id: "cr" + Date.now().toString(36),
      message: String(body.message || "").slice(0, 2000),
      at: new Date().toISOString(), status: "open",
    };
    if (!reqObj.message) return res.status(400).json({ error: "Message required." });
    creds.requests = Array.isArray(creds.requests) ? creds.requests : [];
    creds.requests.unshift(reqObj);
    creds.requests = creds.requests.slice(0, 100);
    await kvSet("fda:portal:" + slug, creds);
    // Also drop it in the owner's inbox so it surfaces in the dashboard.
    try {
      const INBOX = "fda:contact:inbox";
      let list = (await kvGet(INBOX)) || [];
      if (!Array.isArray(list)) list = [];
      list.push({ id: Date.now(), name: siteInfo.name, type: "Change request", contact: "portal:" + slug, notes: reqObj.message, at: reqObj.at });
      if (list.length > 500) list = list.slice(-500);
      await kvSet(INBOX, list);
    } catch (_) {}
    return res.status(200).json({ ok: true });
  }

  return res.status(400).json({ error: "Unknown action." });
}

export default async function handler(req, res) {
  if (req.method === "POST") {
    res.setHeader("cache-control", "no-store");
    try { return await handlePortal(req, res); }
    catch (e) { return res.status(500).json({ error: e.message || "Portal error" }); }
  }

  const slug = cleanSlug(req.query.slug);
  const notFound = (msg) => {
    res.status(404).setHeader("content-type", "text/html; charset=utf-8");
    res.end(`<!doctype html><meta charset="utf-8"><title>Not found</title><body style="font-family:system-ui;background:#0d0d12;color:#f0eef2;display:grid;place-items:center;height:100vh;margin:0;text-align:center"><div><h1 style="font-size:48px;margin:0">404</h1><p style="color:#aaa7b5">${msg || "This site isn't published."}</p><a href="/" style="color:#ff8366">← frontdeskagents.com</a></div></body>`);
  };

  if (!slug) return notFound("No site specified.");
  const url = process.env.UPSTASH_REDIS_REST_URL;
  const token = process.env.UPSTASH_REDIS_REST_TOKEN;
  if (!url || !token) return notFound("Storage not configured.");

  try {
    const r = await fetch(url.replace(/\/$/, "") + "/get/" + encodeURIComponent("fda:site:" + slug), {
      headers: { Authorization: "Bearer " + token },
    });
    const j = await r.json();
    if (!j || !j.result) return notFound();
    let rec;
    try { rec = JSON.parse(j.result); } catch { return notFound(); }
    if (!rec || !rec.html) return notFound();

    // Payment-gated hosting: a suspended site (missed payment / not yet paid the
    // down payment) is taken offline until payment is current. Set by the webhook.
    if (rec.status === "suspended" || rec.status === "pending") {
      res.status(402).setHeader("content-type", "text/html; charset=utf-8");
      res.setHeader("cache-control", "no-store");
      return res.end(`<!doctype html><meta charset="utf-8"><title>${rec.name || "Website"}</title><body style="font-family:system-ui;background:#0d0d12;color:#f0eef2;display:grid;place-items:center;height:100vh;margin:0;text-align:center"><div style="max-width:420px;padding:24px"><div style="font-size:40px">🔒</div><h1 style="font-size:24px;margin:10px 0">This site is paused</h1><p style="color:#aaa7b5;line-height:1.6">${rec.name ? rec.name + "'s" : "This"} website is temporarily offline pending payment. It goes live automatically once payment is complete.</p><a href="/" style="color:#ff8366">frontdeskagents.com</a></div></body>`);
    }

    // SECOND PRODUCT: every site we host ships with AVA, the AI receptionist —
    // injected at serve time so it's always present (opt-out with rec.ava===false).
    let html = rec.html;
    if (rec.ava !== false && !/\/ava\.js/.test(html)) {
      const host = req.headers["x-forwarded-host"] || req.headers.host || "";
      const proto = (req.headers["x-forwarded-proto"] || "https").split(",")[0];
      const origin = process.env.APP_URL || (host ? `${proto}://${host}` : "");
      const biz = String(rec.name || "this business").replace(/"/g, "&quot;");
      const tag = `<script defer src="${origin}/ava.js" data-business="${biz}" data-slug="${slug}" data-api="${origin}/api/generate"></script>`;
      html = /<\/body>/i.test(html) ? html.replace(/<\/body>/i, tag + "</body>") : html + tag;
    }

    // Client-editable LIVE content: menu/prices + promotions/events (with photos,
    // video or audio). Owners edit this from their dashboard; it renders here at
    // serve time so the site reflects changes instantly with no re-publish.
    try {
      const content = await kvGet("fda:content:" + slug);
      if (content) {
        const am = html.match(/data-acc="(#?[0-9a-fA-F]{3,8})"/);
        const acc = am ? (am[1].charAt(0) === "#" ? am[1] : "#" + am[1]) : "#e8c476";
        const atm = html.match(/data-acc-text="(#?[0-9a-fA-F]{3,8})"/);
        const accText = atm ? (atm[1].charAt(0) === "#" ? atm[1] : "#" + atm[1]) : "#0a0b0e";
        const block = renderContent(content, acc, accText);
        if (block) {
          // Prefer to slot it just before the contact section; else before footer.
          if (/<section id="g-contact"/i.test(html)) html = html.replace(/<section id="g-contact"/i, block + '<section id="g-contact"');
          else if (/<footer/i.test(html)) html = html.replace(/<footer/i, block + "<footer");
          else if (/<\/body>/i.test(html)) html = html.replace(/<\/body>/i, block + "</body>");
          else html += block;
        }
      }
    } catch (_) {}

    res.status(200);
    res.setHeader("content-type", "text/html; charset=utf-8");
    res.setHeader("cache-control", "public, max-age=60");
    res.end(html);
  } catch (e) {
    return notFound("Temporarily unavailable.");
  }
}
