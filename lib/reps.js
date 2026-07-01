// Shared sales-rep crediting — used by the Stripe webhook to auto-record a
// commission when a referred customer pays, and reusable elsewhere. Talks to
// Upstash Redis (REST) with the same JSON-per-key convention as api/data.js.

function base() {
  const url = process.env.UPSTASH_REDIS_REST_URL;
  const token = process.env.UPSTASH_REDIS_REST_TOKEN;
  if (!url || !token) return null;
  return { b: url.replace(/\/$/, ""), h: { Authorization: "Bearer " + token } };
}
async function kvGet(key) {
  const u = base(); if (!u) return null;
  const r = await fetch(u.b + "/get/" + encodeURIComponent(key), { headers: u.h });
  const j = await r.json().catch(() => null);
  if (j && j.result) { try { return JSON.parse(j.result); } catch { return j.result; } }
  return null;
}
async function kvSet(key, value) {
  const u = base(); if (!u) return false;
  const r = await fetch(u.b + "/set/" + encodeURIComponent(key), {
    method: "POST", headers: { ...u.h, "content-type": "text/plain" },
    body: JSON.stringify(value == null ? {} : value),
  });
  return r.ok;
}
function sanitizeKey(k) { return String(k || "").replace(/[^a-zA-Z0-9:_-]/g, "_").slice(0, 120); }

// Credit a rep for a paid sale, identified by their referral code. Idempotent:
// a given paymentId is only ever recorded once. Returns the created sale or null.
export async function creditRepByCode(code, { biz, amount, slug, paymentId, note } = {}) {
  const c = String(code || "").replace(/[^A-Za-z0-9]/g, "").slice(0, 12);
  if (!c) return null;
  const id = await kvGet("fda:repcode:" + c);
  const repId = id && typeof id === "object" ? id.id : id;
  if (!repId) return null;
  const rep = await kvGet("fda:rep:" + sanitizeKey(String(repId)));
  if (!rep || rep.deleted) return null;

  rep.sales = Array.isArray(rep.sales) ? rep.sales : [];
  if (paymentId && rep.sales.some((s) => s.paymentId === paymentId)) return null; // already recorded

  const amt = Math.max(0, Number(amount) || 0);
  const rate = typeof rep.rate === "number" ? rep.rate : 0.25;
  const sale = {
    id: "s" + Date.now().toString(36),
    biz: String(biz || "").slice(0, 160),
    slug: String(slug || "").slice(0, 80),
    amount: amt,
    commission: Math.round(amt * rate * 100) / 100,
    status: "pending",
    note: String(note || "Auto: Stripe payment").slice(0, 400),
    paymentId: paymentId || undefined,
    at: new Date().toISOString(),
  };
  rep.sales.unshift(sale);
  await kvSet("fda:rep:" + sanitizeKey(String(repId)), rep);
  return sale;
}
