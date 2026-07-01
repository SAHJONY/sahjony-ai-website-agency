// /api/sites — owner-only: save / list / delete published websites.
//   GET                          -> { sites: [ {name, slug, at} ] }
//   POST { name, html, slug? }   -> save/update -> { slug, url }
//   POST { delete:true, slug }   -> delete
//
// Auth: requires x-admin-token === ADMIN_PASSWORD when that is set.
// Storage: index at fda:sites:index, each site at fda:site:<slug> in Upstash.
// The published HTML is served publicly by /api/site (mapped to /s/<slug>).

const INDEX_KEY = "fda:sites:index";

function slugify(s) {
  return String(s || "site").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 40) || "site";
}
function rand4() { return Math.random().toString(36).slice(2, 6); }

async function upstash(path, opts) {
  const url = process.env.UPSTASH_REDIS_REST_URL;
  const token = process.env.UPSTASH_REDIS_REST_TOKEN;
  if (!url || !token) return null;
  return fetch(url.replace(/\/$/, "") + path, { ...opts, headers: { Authorization: "Bearer " + token, ...(opts && opts.headers) } });
}
async function readJSON(key, fallback) {
  const r = await upstash("/get/" + encodeURIComponent(key), {});
  if (!r) return fallback;
  const j = await r.json();
  if (j && j.result) { try { return JSON.parse(j.result); } catch { return fallback; } }
  return fallback;
}
async function writeRaw(key, value) {
  const r = await upstash("/set/" + encodeURIComponent(key), { method: "POST", headers: { "content-type": "text/plain" }, body: value });
  if (!r || !r.ok) throw new Error("Upstash write failed");
}
async function del(key) { await upstash("/del/" + encodeURIComponent(key), { method: "POST" }); }

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, x-admin-token");
  if (req.method === "OPTIONS") return res.status(200).end();

  const admin = process.env.ADMIN_PASSWORD;
  if (admin && req.headers["x-admin-token"] !== admin) {
    return res.status(401).json({ error: "Unauthorized. Log in to the dashboard." });
  }
  if (!process.env.UPSTASH_REDIS_REST_URL || !process.env.UPSTASH_REDIS_REST_TOKEN) {
    return res.status(500).json({ error: "Upstash is not configured; cannot save sites." });
  }

  try {
    if (req.method === "GET") {
      let index = await readJSON(INDEX_KEY, []);
      if (!Array.isArray(index)) index = [];
      // Attach live view counts.
      await Promise.all(index.map(async (s) => {
        try {
          const r = await upstash("/get/" + encodeURIComponent("fda:views:" + s.slug), {});
          const j = r ? await r.json() : null;
          s.views = j && j.result ? Number(j.result) || 0 : 0;
        } catch { s.views = 0; }
      }));
      return res.status(200).json({ sites: index });
    }

    if (req.method === "POST") {
      let body = req.body;
      if (typeof body === "string") { try { body = JSON.parse(body); } catch { body = {}; } }
      body = body || {};
      let index = await readJSON(INDEX_KEY, []);
      if (!Array.isArray(index)) index = [];

      if (body.delete) {
        const slug = slugify(body.slug);
        await del("fda:site:" + slug);
        index = index.filter((s) => s.slug !== slug);
        await writeRaw(INDEX_KEY, JSON.stringify(index));
        return res.status(200).json({ ok: true, deleted: slug });
      }

      // Manually take a site live / offline (for Zelle/Cash App — no webhook).
      if (body.action === "status") {
        const slug = slugify(body.slug);
        const st = body.status === "active" ? "active" : "suspended";
        const rec = await readJSON("fda:site:" + slug, null);
        if (!rec) return res.status(404).json({ error: "Site not found." });
        rec.status = st;
        await writeRaw("fda:site:" + slug, JSON.stringify(rec));
        const e = index.find((s) => s.slug === slug);
        if (e) { e.status = st; await writeRaw(INDEX_KEY, JSON.stringify(index)); }
        return res.status(200).json({ ok: true, slug, status: st });
      }

      const name = String(body.name || "Website").slice(0, 120);
      let html = body.html;
      if (!html || typeof html !== "string") return res.status(400).json({ error: "Missing site html." });
      if (html.length > 4_000_000) return res.status(413).json({ error: "Site is too large to publish (try fewer/smaller uploaded photos)." });

      const slug = body.slug ? slugify(body.slug) : (slugify(name) + "-" + rand4());
      // Bind the slug into the built HTML: the contact form tags each lead with
      // bizSlug (so it files under fda:leads:<slug>) and the footer "Owner login"
      // link points at /business.html?slug=<slug>. Both use the __SITE_SLUG__
      // placeholder, which is only resolvable here once the slug is known.
      html = html.split("__SITE_SLUG__").join(slug);
      const now = new Date().toISOString();
      // status: "active" (live) | "pending" (built, awaiting down payment) |
      // "suspended" (offline for non-payment). Default active; the Stripe webhook
      // flips it on payment events. Preserve existing status on re-save.
      let status = body.status === "pending" || body.status === "suspended" || body.status === "active" ? body.status : "";
      const prev = await readJSON("fda:site:" + slug, null);
      if (!status) status = (prev && prev.status) || "active";
      // Industry + city drive the industry-specific client dashboard and contract.
      const bizType = String(body.bizType || (prev && prev.bizType) || "").slice(0, 80);
      const bizCity = String(body.bizCity || (prev && prev.bizCity) || "").slice(0, 80);
      await writeRaw("fda:site:" + slug, JSON.stringify({ name, slug, html, at: now, status, bizType, bizCity }));

      const existing = index.find((s) => s.slug === slug);
      if (existing) { existing.name = name; existing.at = now; existing.status = status; existing.bizType = bizType; }
      else index.unshift({ name, slug, at: now, status, bizType });
      await writeRaw(INDEX_KEY, JSON.stringify(index));

      return res.status(200).json({ ok: true, slug, url: "/s/" + slug });
    }

    return res.status(405).json({ error: "Use GET or POST" });
  } catch (e) {
    return res.status(500).json({ error: e.message || "Request failed" });
  }
}
