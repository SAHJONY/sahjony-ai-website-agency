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

const money = (n) => "$" + (Math.round(Number(n) * 100) / 100).toLocaleString("en-US");

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

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, x-admin-token");
  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST") return res.status(405).json({ error: "Use POST" });

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
  if (!build && !monthly) return res.status(400).json({ error: "Provide a build price and/or a monthly amount." });

  // Manual peer-to-peer options. Zelle and Cash App $cashtag have no payment API,
  // so we hand the client the owner's handle to pay directly (installments by
  // agreement). Configure via env: ZELLE_HANDLE, CASHAPP_CASHTAG.
  const zelle = process.env.ZELLE_HANDLE || "";
  const cashapp = process.env.CASHAPP_CASHTAG || "";
  const manual = { zelle, cashapp };

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
  const manualLines = [];
  if (zelle) manualLines.push(`  – Zelle: ${zelle}`);
  if (cashapp) manualLines.push(`  – Cash App: ${cashapp}`);
  const manualBlock = manualLines.length
    ? `\n\nPrefer to pay directly? (no card needed — installments welcome, just ask)\n${manualLines.join("\n")}`
    : "";

  // Square hosted link (one-time): the down payment for a plan, else the build/monthly.
  const squareUrl = await squareLink(name, buildIsPlan && downPayment > 0 ? downPayment : (build > 0 ? build : monthly));

  const buildMessage = (stripeUrl) => {
    let m = `Hi ${name}! Here are your payment options:\n\n${opts.join("\n")}`;
    if (stripeUrl) m += `\n\nPay securely by card, Cash App, or installments:\n${stripeUrl}`;
    if (squareUrl) m += `\n\nOr pay via Square (card / Afterpay):\n${squareUrl}`;
    m += manualBlock;
    return m;
  };

  const sk = process.env.STRIPE_SECRET_KEY;

  // No Stripe? Still useful — return Square and/or manual (Zelle/Cash App) options.
  if (!sk) {
    if (squareUrl || manualLines.length) {
      return res.status(200).json({ stripe: false, square: squareUrl || undefined, manual, installments, message: buildMessage("") });
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
      installments,
      isPlan: buildIsPlan,
      message: buildMessage(data.url),
    });
  } catch (e) {
    return res.status(500).json({ error: e.message || "Request failed" });
  }
}
