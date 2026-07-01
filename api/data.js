// /api/data?key=...   GET -> read,  POST (json body) -> write
// Server-side proxy to Upstash Redis (REST). The Upstash token lives ONLY on the
// server, never in the browser. Stores one JSON blob per key.
//
// AUTH: this endpoint is owner-only. When ADMIN_PASSWORD is set, every request
// must send a matching `x-admin-token` header (the dashboard does this after
// login). Public visitors never touch this — the contact form writes through the
// separate, write-only /api/contact path instead.
import { tgNotifyOwner } from "../lib/telegram.js";
import { rateLimit, safeEqual } from "../lib/guard.js";

function sanitizeKey(k) {
  return String(k || "fda:default").replace(/[^a-zA-Z0-9:_-]/g, "_").slice(0, 120);
}

// Normalize an email into a stable key fragment. MUST match the dealer
// dashboard, which writes fda:custmap:<normEmail> -> customerId when it issues
// portal access. Kept identical on both sides so portal-login can find the id.
function normEmail(e) {
  return String(e || "").trim().toLowerCase().replace(/[^a-z0-9]+/g, "_").slice(0, 80);
}

// --- Direct Upstash helpers (server-side creds, used by the customer-portal
// actions below which run BEFORE the owner gate). Customers never get the admin
// token; they authenticate with email + access code and receive a scoped token
// that maps only to their own record. -------------------------------------- */
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
async function kvSet(key, value, exSeconds) {
  const u = upstashBase();
  if (!u) throw new Error("Storage not configured");
  let path = "/set/" + encodeURIComponent(key);
  if (exSeconds) path += "?EX=" + exSeconds;
  const r = await fetch(u.base + path, {
    method: "POST",
    headers: { ...u.auth, "content-type": "text/plain" },
    body: JSON.stringify(value == null ? {} : value),
  });
  if (!r.ok) throw new Error("Upstash write failed: " + (await r.text()));
}

// Strip fields a customer should never see/keep before returning their record.
function publicCustomer(c) {
  if (!c) return null;
  const { accessCode, accessCodeHash, token, ...safe } = c;
  return safe;
}

const PORTAL_TOKEN_TTL = 60 * 60 * 24 * 30; // 30 days

// ============================ SALES FORCE ==================================
// Commission-based sales reps. Owner creates reps (default 25%); each rep gets a
// referral code + access code. Owner records sales and pays commissions; reps
// log in to their own dashboard to see their pipeline and earnings.
const REP_INDEX = "fda:reps:index";
const REP_TOKEN_TTL = 60 * 60 * 24 * 30;
const DEFAULT_RATE = 0.25;

function genCode(n) {
  const a = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  let s = ""; for (let i = 0; i < (n || 6); i++) s += a[Math.floor(Math.random() * a.length)];
  return s;
}
function repTotals(rep) {
  const sales = Array.isArray(rep.sales) ? rep.sales : [];
  let revenue = 0, commission = 0, pending = 0, paid = 0;
  sales.forEach((s) => {
    revenue += Number(s.amount) || 0;
    const c = Number(s.commission) || 0; commission += c;
    if (s.status === "paid") paid += c; else pending += c;
  });
  return { salesCount: sales.length, revenue, commission, pending, paid };
}
function publicRep(rep) {
  if (!rep) return null;
  const { accessCode, ...safe } = rep;
  return { ...safe, totals: repTotals(rep) };
}
const REP_APPS = "fda:rep:apps"; // pending applications from /apply.html

// Create a rep record + code/access-code + index + maps. Returns {rep} or {error}.
async function makeRep({ name, email, phone, rate }) {
  const nm = String(name || "").trim().slice(0, 120);
  const em = normEmail(email);
  if (!nm || !em) return { error: "Name and email are required." };
  const dupe = await kvGet("fda:repmap:" + em);
  const dupeId = dupe && typeof dupe === "object" ? dupe.id : dupe;
  if (dupeId) return { error: "A rep with that email already exists." };
  let index = (await kvGet(REP_INDEX)) || [];
  if (!Array.isArray(index)) index = [];
  const id = "rp" + Date.now().toString(36) + genCode(3).toLowerCase();
  let code = genCode(6);
  while (await kvGet("fda:repcode:" + code)) code = genCode(6);
  const r = rate != null && !isNaN(rate) ? Math.max(0, Math.min(1, Number(rate))) : DEFAULT_RATE;
  const rep = {
    id, name: nm, email: String(email || "").trim().slice(0, 160), phone: String(phone || "").slice(0, 40),
    code, accessCode: genCode(8), rate: r, active: true, sales: [], createdAt: new Date().toISOString(),
  };
  await kvSet("fda:rep:" + id, rep);
  await kvSet("fda:repcode:" + code, id);
  await kvSet("fda:repmap:" + em, { id });
  index.unshift({ id, name: nm, code });
  await kvSet(REP_INDEX, index);
  return { rep };
}

// Owner-gated rep management (runs after the admin gate).
async function handleRepOwner(req, res, action) {
  let body = req.body;
  if (typeof body === "string") { try { body = JSON.parse(body); } catch { body = {}; } }
  body = body || {};

  if (action === "rep-list") {
    let index = (await kvGet(REP_INDEX)) || [];
    if (!Array.isArray(index)) index = [];
    const reps = [];
    for (const entry of index) {
      const rep = await kvGet("fda:rep:" + sanitizeKey(entry.id));
      if (rep) reps.push(publicRep(rep));
    }
    return res.status(200).json({ ok: true, reps });
  }

  if (action === "rep-create") {
    const r = await makeRep({ name: body.name, email: body.email, phone: body.phone, rate: body.rate });
    if (r.error) return res.status(r.error.includes("exists") ? 409 : 400).json({ error: r.error });
    return res.status(200).json({ ok: true, rep: publicRep(r.rep) });
  }

  // Pending rep applications (from the public /apply.html page).
  if (action === "rep-apps") {
    let apps = (await kvGet(REP_APPS)) || [];
    if (!Array.isArray(apps)) apps = [];
    return res.status(200).json({ ok: true, apps });
  }
  if (action === "rep-approve") {
    let apps = (await kvGet(REP_APPS)) || [];
    if (!Array.isArray(apps)) apps = [];
    const app = apps.find((a) => a.id === body.appId);
    if (!app) return res.status(404).json({ error: "Application not found." });
    const rate = body.rate != null && !isNaN(body.rate) ? Number(body.rate) : DEFAULT_RATE;
    const r = await makeRep({ name: app.name, email: app.email, phone: app.phone, rate });
    if (r.error) return res.status(r.error.includes("exists") ? 409 : 400).json({ error: r.error });
    await kvSet(REP_APPS, apps.filter((a) => a.id !== body.appId));
    return res.status(200).json({ ok: true, rep: publicRep(r.rep) });
  }
  if (action === "rep-reject") {
    let apps = (await kvGet(REP_APPS)) || [];
    if (!Array.isArray(apps)) apps = [];
    await kvSet(REP_APPS, apps.filter((a) => a.id !== body.appId));
    return res.status(200).json({ ok: true });
  }

  // All actions below act on one rep.
  const rid = sanitizeKey(body.repId || "");
  const rep = rid ? await kvGet("fda:rep:" + rid) : null;
  if (!rep) return res.status(404).json({ error: "Rep not found." });

  if (action === "rep-update") {
    if (typeof body.name === "string") rep.name = body.name.slice(0, 120);
    if (typeof body.phone === "string") rep.phone = body.phone.slice(0, 40);
    if (typeof body.active === "boolean") rep.active = body.active;
    if (body.rate != null && !isNaN(body.rate)) rep.rate = Math.max(0, Math.min(1, Number(body.rate)));
    await kvSet("fda:rep:" + rid, rep);
    // keep index name in sync
    let index = (await kvGet(REP_INDEX)) || [];
    const e = index.find((x) => x.id === rep.id); if (e) { e.name = rep.name; await kvSet(REP_INDEX, index); }
    return res.status(200).json({ ok: true, rep: publicRep(rep) });
  }

  if (action === "rep-record") {
    const amount = Number(body.amount) || 0;
    if (amount <= 0) return res.status(400).json({ error: "Enter the sale amount." });
    const rate = body.rate != null && !isNaN(body.rate) ? Number(body.rate) : rep.rate;
    const sale = {
      id: "s" + Date.now().toString(36),
      biz: String(body.biz || "").slice(0, 160), slug: String(body.slug || "").slice(0, 80),
      amount, commission: Math.round(amount * rate * 100) / 100,
      status: "pending", note: String(body.note || "").slice(0, 400), at: new Date().toISOString(),
    };
    rep.sales = Array.isArray(rep.sales) ? rep.sales : [];
    rep.sales.unshift(sale);
    await kvSet("fda:rep:" + rid, rep);
    return res.status(200).json({ ok: true, sale, rep: publicRep(rep) });
  }

  if (action === "rep-pay") {
    rep.sales = Array.isArray(rep.sales) ? rep.sales : [];
    if (body.all) rep.sales.forEach((s) => { s.status = "paid"; s.paidAt = new Date().toISOString(); });
    else {
      const s = rep.sales.find((x) => x.id === body.saleId);
      if (!s) return res.status(404).json({ error: "Sale not found." });
      s.status = "paid"; s.paidAt = new Date().toISOString();
    }
    await kvSet("fda:rep:" + rid, rep);
    return res.status(200).json({ ok: true, rep: publicRep(rep) });
  }

  if (action === "rep-delete") {
    await kvSet("fda:repcode:" + rep.code, "");
    await kvSet("fda:repmap:" + normEmail(rep.email), {});
    let index = (await kvGet(REP_INDEX)) || [];
    index = index.filter((x) => x.id !== rep.id);
    await kvSet(REP_INDEX, index);
    await kvSet("fda:rep:" + rid, { deleted: true });
    return res.status(200).json({ ok: true, deleted: rep.id });
  }

  return null;
}

// Public rep dashboard (self-authed by email+code or rep token; before the gate).
async function handleRepPublic(req, res, action) {
  let body = req.body;
  if (typeof body === "string") { try { body = JSON.parse(body); } catch { body = {}; } }
  body = body || {};
  async function currentRepId() {
    const tok = req.headers["x-rep-token"] || body.token || req.query.token;
    if (!tok) return null;
    const id = await kvGet("fda:reptoken:" + sanitizeKey(String(tok)));
    return id ? String(id) : null;
  }

  if (action === "rep-login") {
    if (req.method !== "POST") return res.status(405).json({ error: "Use POST" });
    const lrl = await rateLimit(req, "replogin", { limit: 15, windowSec: 600 });
    if (lrl.limited) return res.status(429).json({ error: "Too many attempts — wait a few minutes." });
    const email = normEmail(body.email);
    const code = String(body.code || "").trim().toUpperCase();
    if (!email || !code) return res.status(400).json({ error: "Email and access code required." });
    const mapped = await kvGet("fda:repmap:" + email);
    const id = mapped && typeof mapped === "object" ? mapped.id : mapped;
    if (!id) return res.status(401).json({ error: "No rep account for that email." });
    const rep = await kvGet("fda:rep:" + sanitizeKey(String(id)));
    if (!rep || !safeEqual(String(rep.accessCode || "").toUpperCase(), code)) return res.status(401).json({ error: "Incorrect access code." });
    if (rep.active === false) return res.status(403).json({ error: "This account is inactive. Contact your manager." });
    const token = genCode(24);
    await kvSet("fda:reptoken:" + token, String(id), REP_TOKEN_TTL);
    return res.status(200).json({ ok: true, token, rep: publicRep(rep) });
  }

  if (action === "rep-me") {
    const id = await currentRepId();
    if (!id) return res.status(401).json({ error: "Not signed in." });
    const rep = await kvGet("fda:rep:" + sanitizeKey(id));
    if (!rep) return res.status(404).json({ error: "Account not found." });
    return res.status(200).json({ ok: true, rep: publicRep(rep) });
  }

  // Public application from /apply.html — write-only into the pending queue.
  if (action === "rep-apply") {
    if (req.method !== "POST") return res.status(405).json({ error: "Use POST" });
    const arl = await rateLimit(req, "repapply", { limit: 5, windowSec: 3600 });
    if (arl.limited) return res.status(429).json({ error: "Too many applications from this connection — try again later." });
    const name = String(body.name || "").trim().slice(0, 120);
    const email = String(body.email || "").trim().slice(0, 160);
    if (!name || !email) return res.status(400).json({ error: "Name and email are required." });
    let apps = (await kvGet(REP_APPS)) || [];
    if (!Array.isArray(apps)) apps = [];
    if (apps.length > 300) apps = apps.slice(-300);
    apps.unshift({
      id: "app" + Date.now().toString(36) + genCode(3).toLowerCase(),
      name, email, phone: String(body.phone || "").slice(0, 40),
      city: String(body.city || "").slice(0, 80),
      experience: String(body.experience || "").slice(0, 1200),
      at: new Date().toISOString(),
    });
    await kvSet(REP_APPS, apps);
    // Alert the owner so recruiting is hands-off (best-effort).
    tgNotifyOwner(`🧑‍💼 <b>New rep application</b>\n<b>${name}</b>\n📧 ${email}` + (body.city ? `\n📍 ${String(body.city).slice(0, 80)}` : "") + `\n\nApprove in Sales Team → applications.`).catch(() => {});
    return res.status(200).json({ ok: true });
  }

  return null;
}

async function handlePortal(req, res) {
  const action = req.query.action;
  let body = req.body;
  if (typeof body === "string") { try { body = JSON.parse(body); } catch { body = {}; } }
  body = body || {};

  // Resolve the calling customer from a portal token (header or body).
  async function currentCustomerId() {
    const tok = req.headers["x-portal-token"] || body.token || req.query.token;
    if (!tok) return null;
    const id = await kvGet("fda:custtoken:" + sanitizeKey(String(tok)));
    return id ? String(id) : null;
  }

  // POST { email, code } -> { ok, token, customer }
  if (action === "portal-login") {
    if (req.method !== "POST") return res.status(405).json({ error: "Use POST" });
    const prl = await rateLimit(req, "custlogin", { limit: 15, windowSec: 600 });
    if (prl.limited) return res.status(429).json({ ok: false, error: "Too many attempts — wait a few minutes." });
    const email = normEmail(body.email);
    const code = String(body.code || "").trim();
    if (!email || !code) return res.status(400).json({ ok: false, error: "Email and access code required." });
    // The dashboard stores the map as { id } (the generic /api/data writer
    // mangles bare-string values), so unwrap it; tolerate a legacy raw string.
    const mapped = await kvGet("fda:custmap:" + email);
    const id = mapped && typeof mapped === "object" ? mapped.id : mapped;
    if (!id) return res.status(401).json({ ok: false, error: "No account found for that email." });
    const cust = await kvGet("fda:cust:" + sanitizeKey(String(id)));
    if (!cust || !safeEqual(String(cust.accessCode || ""), code)) {
      return res.status(401).json({ ok: false, error: "Incorrect access code." });
    }
    // Mint an opaque scoped token mapped only to this customer id.
    const token = (globalThis.crypto && globalThis.crypto.randomUUID
      ? globalThis.crypto.randomUUID() : (Date.now() + "-" + Math.random().toString(36).slice(2))).replace(/-/g, "");
    await kvSet("fda:custtoken:" + token, String(id), PORTAL_TOKEN_TTL);
    return res.status(200).json({ ok: true, token, customer: publicCustomer(cust) });
  }

  // GET -> own record
  if (action === "portal-get") {
    const id = await currentCustomerId();
    if (!id) return res.status(401).json({ error: "Not signed in." });
    const cust = await kvGet("fda:cust:" + sanitizeKey(id));
    if (!cust) return res.status(404).json({ error: "Account not found." });
    return res.status(200).json({ ok: true, customer: publicCustomer(cust) });
  }

  // POST -> customer updates a small, whitelisted set of own fields.
  if (action === "portal-save") {
    if (req.method !== "POST") return res.status(405).json({ error: "Use POST" });
    const id = await currentCustomerId();
    if (!id) return res.status(401).json({ error: "Not signed in." });
    const cust = await kvGet("fda:cust:" + sanitizeKey(id));
    if (!cust) return res.status(404).json({ error: "Account not found." });
    const u = body.updates || {};
    // Whitelist: customers may edit contact info + their own financial profile,
    // never their balance, contract terms, payment ledger, or access code.
    if (typeof u.phone === "string") cust.phone = u.phone.slice(0, 40);
    if (typeof u.address === "string") cust.address = u.address.slice(0, 200);
    if (u.financial && typeof u.financial === "object") {
      cust.financial = Object.assign({}, cust.financial, {
        income: u.financial.income, employer: u.financial.employer,
        employmentYears: u.financial.employmentYears, notes: u.financial.notes,
      });
    }
    cust.updatedAt = new Date().toISOString();
    await kvSet("fda:cust:" + sanitizeKey(id), cust);
    return res.status(200).json({ ok: true, customer: publicCustomer(cust) });
  }

  // POST { type:'payment'|'refinance'|'message', ... } -> append a request the
  // dealer reviews in the back-office. Money is NOT moved here.
  if (action === "portal-request") {
    if (req.method !== "POST") return res.status(405).json({ error: "Use POST" });
    const id = await currentCustomerId();
    if (!id) return res.status(401).json({ error: "Not signed in." });
    const cust = await kvGet("fda:cust:" + sanitizeKey(id));
    if (!cust) return res.status(404).json({ error: "Account not found." });
    const reqObj = {
      id: "r" + Date.now().toString(36),
      type: ["payment", "refinance", "message"].includes(body.type) ? body.type : "message",
      amount: Number(body.amount) || null,
      message: String(body.message || "").slice(0, 1000),
      method: String(body.method || "").slice(0, 40),
      status: "open",
      at: new Date().toISOString(),
    };
    cust.requests = Array.isArray(cust.requests) ? cust.requests : [];
    cust.requests.unshift(reqObj);
    cust.requests = cust.requests.slice(0, 100);
    await kvSet("fda:cust:" + sanitizeKey(id), cust);
    return res.status(200).json({ ok: true, request: reqObj });
  }

  return null; // not a portal action
}

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, x-admin-token, x-portal-token, x-rep-token");
  if (req.method === "OPTIONS") return res.status(200).end();

  // Customer-portal actions run BEFORE the owner gate (customers have no admin
  // token). Each authenticates by email+code or a scoped portal token and can
  // only ever reach its own fda:cust:<id> record.
  if (req.query && typeof req.query.action === "string" && req.query.action.indexOf("portal-") === 0) {
    try {
      const handled = await handlePortal(req, res);
      if (handled !== null) return handled;
    } catch (e) {
      return res.status(500).json({ error: e.message || "Portal request failed" });
    }
  }

  // Sales-rep self-service (login / own dashboard) runs BEFORE the owner gate —
  // reps authenticate with email+access code or a scoped rep token.
  if (req.query && (req.query.action === "rep-login" || req.query.action === "rep-me" || req.query.action === "rep-apply")) {
    try {
      const handled = await handleRepPublic(req, res, req.query.action);
      if (handled !== null) return handled;
    } catch (e) {
      return res.status(500).json({ error: e.message || "Rep request failed" });
    }
  }

  // Owner login (formerly /api/login, rewritten here as ?action=login in
  // vercel.json — merged to stay under the Hobby 12-function limit). Handled
  // BEFORE the owner-gate below, since this is how the dashboard gets its token.
  if (req.query && req.query.action === "login") {
    if (req.method !== "POST") return res.status(405).json({ error: "Use POST" });
    const orl = await rateLimit(req, "ownerlogin", { limit: 10, windowSec: 600 });
    if (orl.limited) return res.status(429).json({ ok: false, error: "Too many attempts — wait a few minutes." });
    const adminPw = process.env.ADMIN_PASSWORD;
    if (!adminPw) return res.status(200).json({ ok: true, noPassword: true });
    let b = req.body;
    if (typeof b === "string") { try { b = JSON.parse(b); } catch { b = {}; } }
    if (b && safeEqual(String(b.password || ""), adminPw)) return res.status(200).json({ ok: true });
    return res.status(401).json({ ok: false, error: "Wrong password" });
  }

  // Owner-only gate. If no password is configured, stay open (app still works).
  const admin = process.env.ADMIN_PASSWORD;
  if (admin && !safeEqual(String(req.headers["x-admin-token"] || ""), admin)) {
    return res.status(401).json({ error: "Unauthorized. Log in to the dashboard." });
  }

  // Owner-only sales-force management (create reps, record sales, pay, etc.).
  if (req.query && typeof req.query.action === "string" && req.query.action.indexOf("rep-") === 0) {
    if (!process.env.UPSTASH_REDIS_REST_URL || !process.env.UPSTASH_REDIS_REST_TOKEN) {
      return res.status(500).json({ error: "Upstash is not configured; cannot manage the sales force." });
    }
    try {
      const handled = await handleRepOwner(req, res, req.query.action);
      if (handled !== null) return handled;
      return res.status(400).json({ error: "Unknown rep action." });
    } catch (e) {
      return res.status(500).json({ error: e.message || "Rep request failed" });
    }
  }

  const url = process.env.UPSTASH_REDIS_REST_URL;
  const token = process.env.UPSTASH_REDIS_REST_TOKEN;
  if (!url || !token) {
    return res.status(500).json({ error: "Upstash env vars (UPSTASH_REDIS_REST_URL / UPSTASH_REDIS_REST_TOKEN) are not configured." });
  }
  const auth = { Authorization: "Bearer " + token };
  const base = url.replace(/\/$/, "");
  const key = sanitizeKey(req.query.key);

  // Never expose API keys through this endpoint — secrets live behind /api/secrets.
  if (/secret/i.test(key)) {
    return res.status(403).json({ error: "Forbidden key. Manage secrets via /api/secrets." });
  }

  try {
    if (req.method === "GET") {
      const r = await fetch(`${base}/get/${encodeURIComponent(key)}`, { headers: auth });
      const j = await r.json();
      let value = null;
      if (j && j.result) {
        try { value = JSON.parse(j.result); } catch { value = j.result; }
      }
      return res.status(200).json({ key, value });
    }

    if (req.method === "POST") {
      let body = req.body;
      if (typeof body === "string") {
        try { body = JSON.parse(body); } catch { body = {}; }
      }
      const payload = JSON.stringify(body == null ? {} : body);
      const r = await fetch(`${base}/set/${encodeURIComponent(key)}`, {
        method: "POST",
        headers: { ...auth, "content-type": "text/plain" },
        body: payload,
      });
      if (!r.ok) {
        const t = await r.text();
        return res.status(502).json({ error: "Upstash write failed: " + t });
      }
      return res.status(200).json({ ok: true, key });
    }

    return res.status(405).json({ error: "Use GET or POST" });
  } catch (e) {
    return res.status(500).json({ error: e.message || "Request failed" });
  }
}
