// POST /api/checkout  { name, build?, monthly? }  — owner-only.
// Creates a Stripe Checkout Session (build one-time + $/mo subscription) and
// returns a payment link to send the client. Uses Stripe's REST API directly
// (no SDK). STRIPE_SECRET_KEY lives only on the server.
//
// Auth: when ADMIN_PASSWORD is set, requires a matching x-admin-token header.

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

  const sk = process.env.STRIPE_SECRET_KEY;
  if (!sk) return res.status(500).json({ error: "Stripe is not configured. Set STRIPE_SECRET_KEY." });

  let body = req.body;
  if (typeof body === "string") { try { body = JSON.parse(body); } catch { body = {}; } }
  body = body || {};
  const name = String(body.name || "Client").slice(0, 120);
  const build = Math.max(0, Number(body.build) || 0);
  const monthly = Math.max(0, Number(body.monthly) || 0);
  if (!build && !monthly) return res.status(400).json({ error: "Provide a build price and/or a monthly amount." });

  const host = req.headers["x-forwarded-host"] || req.headers.host || "";
  const proto = (req.headers["x-forwarded-proto"] || "https").split(",")[0];
  const base = process.env.APP_URL || (host ? `${proto}://${host}` : "");

  const mode = monthly > 0 ? "subscription" : "payment";
  const p = new URLSearchParams();
  p.append("mode", mode);
  p.append("success_url", base + "/dashboard.html?paid=1");
  p.append("cancel_url", base + "/dashboard.html?canceled=1");
  p.append("client_reference_id", name);
  p.append("metadata[client]", name);
  p.append("metadata[monthly]", String(monthly));
  p.append("metadata[build]", String(build));
  p.append("allow_promotion_codes", "true");

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
    p.append(`line_items[${i}][price_data][currency]`, "usd");
    p.append(`line_items[${i}][price_data][product_data][name]`, `${name} — Website build`);
    p.append(`line_items[${i}][price_data][unit_amount]`, String(Math.round(build * 100)));
    p.append(`line_items[${i}][quantity]`, "1");
    i++;
  }
  if (mode === "subscription") p.append("subscription_data[metadata][client]", name);

  try {
    const r = await fetch("https://api.stripe.com/v1/checkout/sessions", {
      method: "POST",
      headers: { Authorization: "Bearer " + sk, "content-type": "application/x-www-form-urlencoded" },
      body: p.toString(),
    });
    const data = await r.json();
    if (!r.ok) return res.status(r.status).json({ error: (data && data.error && data.error.message) || "Stripe error" });
    return res.status(200).json({ url: data.url, id: data.id });
  } catch (e) {
    return res.status(500).json({ error: e.message || "Request failed" });
  }
}
