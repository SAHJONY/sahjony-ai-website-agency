// POST /api/stripe-webhook?token=...   — Stripe -> auto-records paid clients.
//
// Security: instead of raw-body signature verification, every event is
// re-fetched from Stripe with the secret key, so forged events fail (the object
// won't exist or won't be "paid"). Optionally also gate with WEBHOOK_TOKEN in
// the URL (?token=...) when configuring the endpoint in Stripe.
//
// On checkout.session.completed (paid), it appends a client + an active
// subscription to the owner panel (fda:panel:owner) in Upstash.

const PANEL_KEY = "fda:panel:owner";

async function upstash(path, opts) {
  const url = process.env.UPSTASH_REDIS_REST_URL;
  const token = process.env.UPSTASH_REDIS_REST_TOKEN;
  if (!url || !token) return null;
  return fetch(url.replace(/\/$/, "") + path, {
    ...opts,
    headers: { Authorization: "Bearer " + token, ...(opts && opts.headers) },
  });
}
async function readPanel() {
  const r = await upstash("/get/" + encodeURIComponent(PANEL_KEY), {});
  if (!r) return { leads: [], clients: [], subs: [] };
  const j = await r.json();
  if (j && j.result) { try { return JSON.parse(j.result) || {}; } catch {} }
  return { leads: [], clients: [], subs: [] };
}
async function writePanel(obj) {
  await upstash("/set/" + encodeURIComponent(PANEL_KEY), {
    method: "POST", headers: { "content-type": "text/plain" }, body: JSON.stringify(obj),
  });
}

// Payment-gated hosting: flip a published site live ("active") or offline
// ("suspended") based on payment events. The site slug travels in metadata.
async function setSiteStatus(slug, status) {
  const s = String(slug || "").toLowerCase().replace(/[^a-z0-9-]/g, "").slice(0, 60);
  if (!s) return false;
  const r = await upstash("/get/" + encodeURIComponent("fda:site:" + s), {});
  if (!r) return false;
  const j = await r.json();
  if (!j || !j.result) return false;
  let rec; try { rec = JSON.parse(j.result); } catch { return false; }
  rec.status = status;
  await upstash("/set/" + encodeURIComponent("fda:site:" + s), {
    method: "POST", headers: { "content-type": "text/plain" }, body: JSON.stringify(rec),
  });
  return true;
}
// Resolve the site slug from a subscription's metadata (invoice events carry the sub id).
async function subSlug(sk, subId) {
  if (!subId) return "";
  try {
    const r = await fetch("https://api.stripe.com/v1/subscriptions/" + encodeURIComponent(subId), { headers: { Authorization: "Bearer " + sk } });
    const s = await r.json();
    return (r.ok && s.metadata && s.metadata.slug) || "";
  } catch { return ""; }
}

export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ error: "Use POST" });

  const gate = process.env.WEBHOOK_TOKEN;
  if (gate && req.query.token !== gate) return res.status(401).json({ error: "Unauthorized" });

  const sk = process.env.STRIPE_SECRET_KEY;
  if (!sk) return res.status(200).json({ received: true, note: "Stripe not configured" });

  let event = req.body;
  if (typeof event === "string") { try { event = JSON.parse(event); } catch { event = {}; } }

  try {
    if (event && event.type === "checkout.session.completed") {
      const id = event.data && event.data.object && event.data.object.id;
      if (id) {
        // Re-fetch from Stripe to confirm authenticity + payment.
        const r = await fetch("https://api.stripe.com/v1/checkout/sessions/" + encodeURIComponent(id), {
          headers: { Authorization: "Bearer " + sk },
        });
        const s = await r.json();
        const paid = r.ok && (s.payment_status === "paid" || s.status === "complete");
        if (paid) {
          const md = s.metadata || {};
          // Down payment / first payment cleared -> take the site LIVE.
          if (md.slug) await setSiteStatus(md.slug, "active");
          const name = md.client || s.customer_details?.name || s.customer_email || "New client";
          const monthly = Number(md.monthly) || 0;
          const panel = Object.assign({ leads: [], clients: [], subs: [] }, await readPanel());
          panel.clients = panel.clients || [];
          panel.subs = panel.subs || [];
          // Avoid duplicate records for the same session.
          if (!panel.subs.some((x) => x.sessionId === id)) {
            panel.clients.push({ id: Date.now(), name, type: "", city: s.customer_details?.email || "", value: monthly ? `Live · $${monthly}/mo` : "Paid" });
            if (monthly > 0) {
              panel.subs.push({ id: Date.now() + 1, sessionId: id, name, plan: "Care plan", price: monthly, status: "active", since: new Date().toISOString().slice(0, 10) });
            }
            await writePanel(panel);
          }
        }
      }
    }

    // Recurring installment succeeded -> keep/return the site live.
    else if (event && (event.type === "invoice.paid" || event.type === "invoice.payment_succeeded")) {
      const inv = event.data && event.data.object || {};
      const slug = (inv.subscription_details && inv.subscription_details.metadata && inv.subscription_details.metadata.slug) || await subSlug(sk, inv.subscription);
      if (slug) await setSiteStatus(slug, "active");
    }
    // Installment failed -> take the site offline until they're current.
    else if (event && event.type === "invoice.payment_failed") {
      const inv = event.data && event.data.object || {};
      const slug = (inv.subscription_details && inv.subscription_details.metadata && inv.subscription_details.metadata.slug) || await subSlug(sk, inv.subscription);
      if (slug) await setSiteStatus(slug, "suspended");
    }
    // Subscription canceled -> take the site offline.
    else if (event && event.type === "customer.subscription.deleted") {
      const sub = event.data && event.data.object || {};
      const slug = sub.metadata && sub.metadata.slug;
      if (slug) await setSiteStatus(slug, "suspended");
    }

    return res.status(200).json({ received: true });
  } catch (e) {
    // Always 200 so Stripe doesn't retry forever on our errors.
    return res.status(200).json({ received: true, error: e.message });
  }
}
