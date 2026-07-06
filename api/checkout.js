// POST /api/checkout  { name, build?, monthly?, installments? }  — owner-only.
//
// Creates payment options to send a client:
//   • Stripe Checkout link (card, Cash App Pay, and BNPL installments — Affirm/
//     Klarna/Afterpay — auto-offered when enabled in your Stripe Dashboard).
//   • Installment PLAN: pass installments>=2 to split the build fee into N monthly
//     payments (a subscription) instead of one upfront charge.
//   • Manual Zelle + Cash App $cashtag instructions (no API exists for those, so
//     the client pays your handle directly — works even without Stripe).
//
// Uses Stripe's REST API directly (no SDK). STRIPE_SECRET_KEY stays server-side.
// Auth: when ADMIN_PASSWORD is set, requires a matching x-admin-token header.
//
// STOREFRONT (public, no admin token): mode:"storefront" / "storefront-confirm"
// let a client's OWN customers buy products. These never touch the platform key —
// they use the client's own Stripe key from fda:shopsecret:<slug> and recompute
// every price server-side from the stored catalog. See handleStorefront below.

import { rateLimit, clientIp } from "../lib/guard.js";

const money = (n) => "$" + (Math.round(Number(n) * 100) / 100).toLocaleString("en-US");

// Minimal Upstash REST helpers (mirrors api/site.js) — used by the storefront path.
async function kvGet(key) {
  const url = process.env.UPSTASH_REDIS_REST_URL, token = process.env.UPSTASH_REDIS_REST_TOKEN;
  if (!url || !token) return null;
  const r = await fetch(url.replace(/\/$/, "") + "/get/" + encodeURIComponent(key), { headers: { Authorization: "Bearer " + token } });
  const j = await r.json().catch(() => null);
  if (j && j.result) { try { return JSON.parse(j.result); } catch { return j.result; } }
  return null;
}
async function kvSet(key, value) {
  const url = process.env.UPSTASH_REDIS_REST_URL, token = process.env.UPSTASH_REDIS_REST_TOKEN;
  if (!url || !token) throw new Error("Storage not configured");
  const r = await fetch(url.replace(/\/$/, "") + "/set/" + encodeURIComponent(key), {
    method: "POST", headers: { Authorization: "Bearer " + token, "content-type": "text/plain" },
    body: JSON.stringify(value == null ? {} : value),
  });
  if (!r.ok) throw new Error("write failed");
}

// Create a Square hosted payment link (one-time) for `amount` dollars. Needs
// SQUARE_ACCESS_TOKEN + SQUARE_LOCATION_ID. Returns "" if unconfigured/failed.
async function squareLink(name, amount) {
  const token = process.env.SQUARE_ACCESS_TOKEN, loc = process.env.SQUARE_LOCATION_ID;
  if (!token || !loc || !(amount > 0)) return "";
  const base = process.env.SQUARE_BASE_URL ||
    (process.env.SQUARE_ENV === "sandbox" ? "https://connect.squareupsandbox.com" : "https://connect.squareup.com");
  try {
    const r = await fetch(base + "/v2/online-checkout/payment-links", {
      method: "POST",
      headers: {
        Authorization: "Bearer " + token,
        "Square-Version": process.env.SQUARE_VERSION || "2025-01-23",
        "content-type": "application/json",
      },
      body: JSON.stringify({
        idempotency_key: `${Date.now()}-${Math.random().toString(36).slice(2, 12)}`,
        quick_pay: {
          name: `${name} — Website`,
          price_money: { amount: Math.round(amount * 100), currency: "USD" },
          location_id: loc,
        },
      }),
    });
    const j = await r.json();
    if (!r.ok) return "";
    return (j.payment_link && j.payment_link.url) || "";
  } catch (_) { return ""; }
}

// Build a PayPal.me link for `amount` from PAYPAL_HANDLE. Accepts a bare username
// ("YourBiz"), a full paypal.me URL, or an email. PayPal.me pre-fills the amount
// from the URL (…/paypal.me/YourBiz/149USD); emails are shown as-is (no API).
function paypalLink(handle, amount) {
  const h = String(handle || "").trim();
  if (!h) return "";
  if (h.includes("@")) return h; // email — PayPal.me can't encode it, show directly
  let url = /^https?:\/\//i.test(h)
    ? h.replace(/\/+$/, "")
    : "https://paypal.me/" + h.replace(/^@/, "").replace(/^paypal\.me\//i, "");
  if (amount > 0) url += "/" + (Math.round(amount * 100) / 100) + "USD";
  return url;
}

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, x-admin-token");
  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST") return res.status(405).json({ error: "Use POST" });

  // Public storefront path runs BEFORE the agency-admin gate (buyers aren't
  // logged in). It only ever uses the per-client Stripe key + server-side prices.
  {
    let sb = req.body;
    if (typeof sb === "string") { try { sb = JSON.parse(sb); } catch { sb = {}; } }
    if (sb && (sb.mode === "storefront" || sb.mode === "storefront-confirm")) {
      try { return await handleStorefront(req, res, sb); }
      catch (e) { return res.status(500).json({ error: e.message || "Storefront request failed" }); }
    }
  }

  const admin = process.env.ADMIN_PASSWORD;
  if (admin && req.headers["x-admin-token"] !== admin) {
    return res.status(401).json({ error: "Unauthorized. Log in to the dashboard." });
  }

  let body = req.body;
  if (typeof body === "string") { try { body = JSON.parse(body); } catch { body = {}; } }
  body = body || {};
  const name = String(body.name || "Client").slice(0, 120);
  const build = Math.max(0, Number(body.build) || 0);
  const monthly = Math.max(0, Number(body.monthly) || 0);
  const installments = Math.max(1, Math.min(36, Math.round(Number(body.installments) || 1)));
  const slug = String(body.slug || "").toLowerCase().replace(/[^a-z0-9-]/g, "").slice(0, 60); // links payment -> site for auto publish/suspend
  const ref = String(body.ref || "").replace(/[^A-Za-z0-9]/g, "").slice(0, 12); // sales-rep referral code -> auto commission
  if (!build && !monthly) return res.status(400).json({ error: "Provide a build price and/or a monthly amount." });

  // Manual peer-to-peer options. Zelle and Cash App $cashtag have no payment API,
  // so we hand the client the owner's handle to pay directly (installments by
  // agreement). Configure via env: ZELLE_HANDLE, CASHAPP_CASHTAG.
  const zelle = process.env.ZELLE_HANDLE || "";
  const cashapp = process.env.CASHAPP_CASHTAG || "";
  const paypalHandle = process.env.PAYPAL_HANDLE || "";
  const manual = { zelle, cashapp, paypal: paypalHandle };

  // Installment plan + MINIMUM DOWN PAYMENT policy.
  //   MIN_DOWN_PCT (default 25) — min down as % of build.  MIN_DOWN_USD — min in $.
  // The down payment is charged today; the remainder is split into `installments`
  // monthly payments. A per-link downPayment can raise (never lower) the minimum.
  const minDownPct = Math.max(0, Math.min(100, Number(process.env.MIN_DOWN_PCT || 25)));
  const minDownUsd = Math.max(0, Number(process.env.MIN_DOWN_USD || 0));
  let downPayment = 0, remainder = 0, perInstall = 0, buildIsPlan = false;
  if (installments >= 2 && build > 0) {
    const minDown = Math.max(minDownUsd, Math.round((build * minDownPct) / 100));
    downPayment = Math.min(build, Math.max(Number(body.downPayment) || 0, minDown));
    remainder = Math.max(0, build - downPayment);
    if (remainder > 0) { buildIsPlan = true; perInstall = Math.ceil(remainder / installments); }
  }

  // A friendly, copy-paste message describing every way the client can pay.
  const opts = [];
  if (build > 0) {
    opts.push(buildIsPlan
      ? `• Website build: ${money(build)} — ${money(downPayment)} down today, then ${installments} monthly payments of ~${money(perInstall)}`
      : `• Website build: ${money(build)} (ask about an installment plan if needed)`);
  }
  if (monthly > 0) opts.push(`• Care plan: ${money(monthly)}/month`);
  // Amount the client pays now (plan down payment, else the build or the monthly).
  const payNow = buildIsPlan && downPayment > 0 ? downPayment : (build > 0 ? build : monthly);
  const paypalUrl = paypalLink(paypalHandle, payNow);
  manual.paypal = paypalUrl || paypalHandle; // return the amount-filled link to the dashboard
  const manualLines = [];
  if (zelle) manualLines.push(`  – Zelle: ${zelle}`);
  if (cashapp) manualLines.push(`  – Cash App: ${cashapp}`);
  if (paypalUrl) manualLines.push(`  – PayPal: ${paypalUrl}`);

  // PAYMENTS_PRIMARY controls which method leads. Default "manual" (Zelle + Cash
  // App) — zero processor fees, ideal while the business is getting going. Set it
  // to "stripe" later (when volume/profits justify card fees) to lead with cards.
  const primaryPref = String(process.env.PAYMENTS_PRIMARY || "manual").toLowerCase();
  const manualPrimary = primaryPref !== "stripe" && manualLines.length > 0;

  // Square hosted link (one-time): the down payment for a plan, else the build/monthly.
  const squareUrl = await squareLink(name, buildIsPlan && downPayment > 0 ? downPayment : (build > 0 ? build : monthly));

  const buildMessage = (stripeUrl) => {
    let m = `Hi ${name}! Here are your payment options:\n\n${opts.join("\n")}`;
    if (manualPrimary) {
      // Lead with the no-fee direct methods.
      m += `\n\n✅ Easiest way to pay — no fees (installments welcome, just ask):\n${manualLines.join("\n")}`;
      const cardLines = [];
      if (stripeUrl) cardLines.push(`  – Card / Cash App Pay / installments: ${stripeUrl}`);
      if (squareUrl) cardLines.push(`  – Square (card / Afterpay): ${squareUrl}`);
      if (cardLines.length) m += `\n\nPrefer a card? You can also pay online:\n${cardLines.join("\n")}`;
    } else {
      if (stripeUrl) m += `\n\nPay securely by card, Cash App, or installments:\n${stripeUrl}`;
      if (squareUrl) m += `\n\nOr pay via Square (card / Afterpay):\n${squareUrl}`;
      if (manualLines.length) m += `\n\nPrefer to pay directly? (no card needed — installments welcome, just ask)\n${manualLines.join("\n")}`;
    }
    return m;
  };

  const sk = process.env.STRIPE_SECRET_KEY;

  // No Stripe? Still useful — return Square and/or manual (Zelle/Cash App) options.
  if (!sk) {
    if (squareUrl || manualLines.length) {
      return res.status(200).json({ stripe: false, square: squareUrl || undefined, manual, primary: manualPrimary ? "manual" : "square", installments, message: buildMessage("") });
    }
    return res.status(500).json({
      error: "No payment method configured. Set STRIPE_SECRET_KEY (cards, Cash App Pay, installments), SQUARE_ACCESS_TOKEN + SQUARE_LOCATION_ID (Square), and/or ZELLE_HANDLE + CASHAPP_CASHTAG (manual).",
    });
  }

  const host = req.headers["x-forwarded-host"] || req.headers.host || "";
  const proto = (req.headers["x-forwarded-proto"] || "https").split(",")[0];
  const base = process.env.APP_URL || (host ? `${proto}://${host}` : "");

  // A split-build plan or a care plan both require subscription mode.
  const mode = (monthly > 0 || buildIsPlan) ? "subscription" : "payment";
  const p = new URLSearchParams();
  p.append("mode", mode);
  p.append("success_url", base + "/dashboard.html?paid=1");
  p.append("cancel_url", base + "/dashboard.html?canceled=1");
  p.append("client_reference_id", name);
  p.append("metadata[client]", name);
  p.append("metadata[monthly]", String(monthly));
  p.append("metadata[build]", String(build));
  p.append("metadata[installments]", String(installments));
  p.append("metadata[downPayment]", String(downPayment));
  if (slug) p.append("metadata[slug]", slug);
  if (ref) p.append("metadata[ref]", ref);
  p.append("allow_promotion_codes", "true");
  // NOTE: we intentionally do NOT set payment_method_types — Checkout then offers
  // every method enabled in your Stripe Dashboard (card, Cash App Pay, and the
  // BNPL installment methods Affirm/Klarna/Afterpay on one-time payments).
  // Also enable per-card installment plans where the card/region supports them:
  p.append("payment_method_options[card][installments][enabled]", "true");

  let i = 0;
  if (monthly > 0) {
    p.append(`line_items[${i}][price_data][currency]`, "usd");
    p.append(`line_items[${i}][price_data][product_data][name]`, `${name} — Care plan`);
    p.append(`line_items[${i}][price_data][unit_amount]`, String(Math.round(monthly * 100)));
    p.append(`line_items[${i}][price_data][recurring][interval]`, "month");
    p.append(`line_items[${i}][quantity]`, "1");
    i++;
  }
  if (build > 0) {
    if (buildIsPlan) {
      // Down payment today — one-time line item (billed on the first invoice).
      if (downPayment > 0) {
        p.append(`line_items[${i}][price_data][currency]`, "usd");
        p.append(`line_items[${i}][price_data][product_data][name]`, `${name} — Website build (down payment)`);
        p.append(`line_items[${i}][price_data][unit_amount]`, String(Math.round(downPayment * 100)));
        p.append(`line_items[${i}][quantity]`, "1");
        i++;
      }
      // Remaining balance split into `installments` monthly payments (subscription).
      p.append(`line_items[${i}][price_data][currency]`, "usd");
      p.append(`line_items[${i}][price_data][product_data][name]`, `${name} — Build balance (${installments} monthly payments)`);
      p.append(`line_items[${i}][price_data][unit_amount]`, String(Math.round(perInstall * 100)));
      p.append(`line_items[${i}][price_data][recurring][interval]`, "month");
      p.append(`line_items[${i}][quantity]`, "1");
      i++;
    } else {
      p.append(`line_items[${i}][price_data][currency]`, "usd");
      p.append(`line_items[${i}][price_data][product_data][name]`, `${name} — Website build`);
      p.append(`line_items[${i}][price_data][unit_amount]`, String(Math.round(build * 100)));
      p.append(`line_items[${i}][quantity]`, "1");
      i++;
    }
  }
  if (mode === "subscription") {
    p.append("subscription_data[metadata][client]", name);
    if (slug) p.append("subscription_data[metadata][slug]", slug); // so invoice/sub events can find the site
    if (ref) p.append("subscription_data[metadata][ref]", ref);
  }

  try {
    const r = await fetch("https://api.stripe.com/v1/checkout/sessions", {
      method: "POST",
      headers: { Authorization: "Bearer " + sk, "content-type": "application/x-www-form-urlencoded" },
      body: p.toString(),
    });
    const data = await r.json();
    if (!r.ok) return res.status(r.status).json({ error: (data && data.error && data.error.message) || "Stripe error" });
    return res.status(200).json({
      url: data.url,
      id: data.id,
      stripe: true,
      square: squareUrl || undefined,
      manual,
      primary: manualPrimary ? "manual" : "stripe",
      installments,
      isPlan: buildIsPlan,
      message: buildMessage(data.url),
    });
  } catch (e) {
    return res.status(500).json({ error: e.message || "Request failed" });
  }
}

// Recompute cart line items from the STORED catalog. Client-sent prices are
// never trusted — price, availability, and stock come only from `products`.
// Coalesces duplicate ids, clamps quantity to stock (when tracked), and drops
// missing / inactive / free / zero-qty items. Pure + exported for unit tests.
export function buildStorefrontLines(products, items) {
  const catalog = Array.isArray(products) ? products : [];
  const qtyById = {};
  for (const it of (Array.isArray(items) ? items : []).slice(0, 100)) {
    const id = String((it && it.id) || "");
    const qty = Math.max(0, Math.min(99, Math.floor(Number(it && it.qty) || 0)));
    if (id && qty) qtyById[id] = (qtyById[id] || 0) + qty;
  }
  const lines = [], metaItems = [];
  for (const id of Object.keys(qtyById)) {
    const prod = catalog.find((p) => p && p.id === id && p.active !== false);
    if (!prod) continue;
    let qty = qtyById[id];
    if (prod.trackStock) qty = Math.min(qty, Math.max(0, Number(prod.stock) || 0));
    const cents = Math.round((Number(prod.price) || 0) * 100);
    if (qty <= 0 || cents <= 0) continue;
    lines.push({ name: prod.name, cents, qty, image: /^https?:\/\//i.test(prod.image || "") ? prod.image : "" });
    metaItems.push({ id, name: prod.name, qty, price: cents / 100 });
  }
  return { lines, metaItems };
}

// ---- STOREFRONT: a client's own customers buy the client's products ---------
// Two modes:
//   "storefront"          → build a Stripe Checkout Session from a cart. Prices
//                           are recomputed server-side from fda:shop:<slug> — the
//                           client-sent amounts are never trusted. The cart is
//                           stashed at fda:shoppending:<slug>:<sessionId> so the
//                           order can be recorded reliably (Stripe metadata caps
//                           at 500 chars, too small for a big cart).
//   "storefront-confirm"  → after redirect, verify the session was PAID (using
//                           the client's key), then record the order once
//                           (idempotent by session id) and decrement stock.
// Uses the CLIENT's key from fda:shopsecret:<slug>, never the platform key.
async function handleStorefront(req, res, body) {
  const slug = String(body.slug || "").toLowerCase().replace(/[^a-z0-9-]/g, "").slice(0, 60);
  if (!slug) return res.status(400).json({ error: "Missing store." });

  const rl = await rateLimit(req, "storefront", { limit: 40, windowSec: 600, key: clientIp(req) + ":" + slug });
  if (rl.limited) return res.status(429).json({ error: "Too many attempts — wait a moment and try again." });

  const sk = String((await kvGet("fda:shopsecret:" + slug)) || "");
  if (!/^sk_(test|live)_/.test(sk)) {
    return res.status(400).json({ error: "This store isn't set up to take payments yet." });
  }
  const host = req.headers["x-forwarded-host"] || req.headers.host || "";
  const proto = (req.headers["x-forwarded-proto"] || "https").split(",")[0];
  const base = process.env.APP_URL || (host ? `${proto}://${host}` : "");
  const stripeAuth = { Authorization: "Bearer " + sk };

  // ---- Confirm + record ----
  if (body.mode === "storefront-confirm") {
    const sid = String(body.session_id || "").replace(/[^A-Za-z0-9_]/g, "").slice(0, 200);
    if (!sid) return res.status(400).json({ error: "Missing session." });
    const r = await fetch("https://api.stripe.com/v1/checkout/sessions/" + encodeURIComponent(sid), { headers: stripeAuth });
    const sess = await r.json();
    if (!r.ok) return res.status(r.status).json({ error: (sess && sess.error && sess.error.message) || "Stripe error" });
    if (String(sess.metadata && sess.metadata.slug) !== slug) return res.status(400).json({ error: "Session/store mismatch." });
    if (sess.payment_status !== "paid") return res.status(200).json({ ok: true, paid: false });

    const orders = (await kvGet("fda:shoporders:" + slug)) || [];
    const list = Array.isArray(orders) ? orders : [];
    let order = list.find((o) => o && o.session === sid);
    if (!order) {
      let items = [];
      const pend = await kvGet("fda:shoppending:" + slug + ":" + sid);
      if (pend && Array.isArray(pend.items)) items = pend.items;
      else { try { items = JSON.parse((sess.metadata && sess.metadata.items) || "[]"); } catch {} }
      order = {
        id: "o" + Date.now().toString(36),
        at: new Date().toISOString(),
        email: (sess.customer_details && sess.customer_details.email) || sess.customer_email || "",
        name: (sess.customer_details && sess.customer_details.name) || "",
        phone: (sess.customer_details && sess.customer_details.phone) || "",
        items: Array.isArray(items) ? items : [],
        total: (Number(sess.amount_total) || 0) / 100,
        currency: sess.currency || "usd",
        status: "Paid",
        session: sid,
      };
      list.unshift(order);
      if (list.length > 500) list.length = 500;
      await kvSet("fda:shoporders:" + slug, list);

      // Decrement stock for tracked products (best-effort).
      try {
        const shop = (await kvGet("fda:shop:" + slug)) || {};
        if (Array.isArray(shop.products) && order.items.length) {
          let changed = false;
          for (const it of order.items) {
            const prod = shop.products.find((p) => p && p.id === it.id);
            if (prod && prod.trackStock) { prod.stock = Math.max(0, (Number(prod.stock) || 0) - (Number(it.qty) || 0)); changed = true; }
          }
          if (changed) await kvSet("fda:shop:" + slug, shop);
        }
      } catch (_) {}
    }
    return res.status(200).json({ ok: true, paid: true, order: { id: order.id, items: order.items, total: order.total, currency: order.currency, email: order.email } });
  }

  // ---- Create Checkout Session from a cart ----
  const shop = (await kvGet("fda:shop:" + slug)) || {};
  if (!shop.enabled) return res.status(400).json({ error: "This store is not open." });
  const products = Array.isArray(shop.products) ? shop.products : [];
  const currency = String(shop.currency || "usd").toLowerCase().replace(/[^a-z]/g, "").slice(0, 3) || "usd";

  const { lines, metaItems } = buildStorefrontLines(products, body.items);
  if (!lines.length) return res.status(400).json({ error: "Your cart is empty or those items are unavailable." });

  const p = new URLSearchParams();
  p.append("mode", "payment");
  p.append("success_url", base + "/order.html?slug=" + encodeURIComponent(slug) + "&session_id={CHECKOUT_SESSION_ID}");
  p.append("cancel_url", base + "/shop.html?slug=" + encodeURIComponent(slug));
  p.append("metadata[slug]", slug);
  p.append("metadata[kind]", "storefront");
  p.append("metadata[items]", JSON.stringify(metaItems).slice(0, 490));
  p.append("phone_number_collection[enabled]", "true");
  p.append("shipping_address_collection[allowed_countries][0]", "US");
  lines.forEach((ln, idx) => {
    p.append(`line_items[${idx}][price_data][currency]`, currency);
    p.append(`line_items[${idx}][price_data][product_data][name]`, ln.name);
    if (ln.image) p.append(`line_items[${idx}][price_data][product_data][images][0]`, ln.image);
    p.append(`line_items[${idx}][price_data][unit_amount]`, String(ln.cents));
    p.append(`line_items[${idx}][quantity]`, String(ln.qty));
  });

  const r = await fetch("https://api.stripe.com/v1/checkout/sessions", {
    method: "POST", headers: { ...stripeAuth, "content-type": "application/x-www-form-urlencoded" }, body: p.toString(),
  });
  const data = await r.json();
  if (!r.ok) return res.status(r.status).json({ error: (data && data.error && data.error.message) || "Payment setup failed." });
  // Stash the full cart so confirm can record it even if metadata was truncated.
  try { if (data.id) await kvSet("fda:shoppending:" + slug + ":" + data.id, { items: metaItems, at: new Date().toISOString() }); } catch (_) {}
  return res.status(200).json({ ok: true, url: data.url, id: data.id });
}
