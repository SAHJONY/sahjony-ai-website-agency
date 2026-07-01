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

async function handlePortal(req, res) {
  let body = req.body;
  if (typeof body === "string") { try { body = JSON.parse(body); } catch { body = {}; } }
  body = body || {};
  const action = body.action;
  const slug = cleanSlug(body.slug);
  if (!slug) return res.status(400).json({ error: "Missing site." });

  const creds = await kvGet("fda:portal:" + slug);
  const pw = creds && typeof creds === "object" ? String(creds.password || "") : "";
  // No portal password set yet -> the owner hasn't enabled the client dashboard.
  if (!pw) return res.status(403).json({ error: "This site has no client dashboard yet. Ask your provider to enable it." });
  if (String(body.password || "") !== pw) return res.status(401).json({ error: "Wrong password." });

  const site = (await kvGet("fda:site:" + slug)) || {};
  const host = req.headers["x-forwarded-host"] || req.headers.host || "";
  const proto = (req.headers["x-forwarded-proto"] || "https").split(",")[0];
  const origin = process.env.APP_URL || (host ? `${proto}://${host}` : "");
  const siteInfo = {
    name: site.name || slug, status: site.status || "active",
    url: (site.domain ? "https://" + String(site.domain).replace(/^https?:\/\//, "") : origin + "/s/" + slug),
    ava: site.ava !== false,
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
    return res.status(200).json({ ok: true, site: siteInfo, ava: safeAva, leads, stats: { views: Number(views) || 0, leads: leads.length } });
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

    res.status(200);
    res.setHeader("content-type", "text/html; charset=utf-8");
    res.setHeader("cache-control", "public, max-age=60");
    res.end(html);
  } catch (e) {
    return notFound("Temporarily unavailable.");
  }
}
