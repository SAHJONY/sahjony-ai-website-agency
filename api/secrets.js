// /api/secrets — manage AI provider keys at runtime (stored in Upstash).
//
//   GET                       -> list managed secrets (status + masked value only)
//   POST { name, value }      -> add/update a secret
//   POST { name, delete:true} -> delete a stored secret
//
// SECURITY:
//   - Requires an admin token. Set ADMIN_PASSWORD in env; send it as the
//     `x-admin-token` header. Without ADMIN_PASSWORD the endpoint is locked.
//   - Raw values are NEVER returned — only a masked preview (…last4).
//   - process.env always overrides a stored value (env wins).
//   - The Upstash creds themselves cannot be managed here (they bootstrap this).
//   - /api/data refuses the "fda:secrets" key so values can't leak via that route.

const STORE_KEY = "fda:secrets";

// Provider keys the AI engine actually reads. Only these can be managed.
const MANAGED = [
  { name: "ANTHROPIC_API_KEY", label: "Claude (Anthropic)" },
  { name: "NVIDIA_API_KEY", label: "NVIDIA NIM (free)" },
  { name: "OPENAI_API_KEY", label: "OpenAI" },
  { name: "XAI_API_KEY", label: "Grok (xAI)" },
  { name: "GEMINI_API_KEY", label: "Google Gemini (free)" },
];
const MANAGED_NAMES = MANAGED.map((m) => m.name);

function mask(v) {
  if (!v) return "";
  const s = String(v);
  if (s.length <= 6) return "••••";
  return s.slice(0, 3) + "…" + s.slice(-4);
}

async function upstash(path, opts) {
  const url = process.env.UPSTASH_REDIS_REST_URL;
  const token = process.env.UPSTASH_REDIS_REST_TOKEN;
  if (!url || !token) return null;
  const r = await fetch(url.replace(/\/$/, "") + path, {
    ...opts,
    headers: { Authorization: "Bearer " + token, ...(opts && opts.headers) },
  });
  return r;
}

async function readStore() {
  const r = await upstash("/get/" + encodeURIComponent(STORE_KEY), {});
  if (!r) return {};
  const j = await r.json();
  if (j && j.result) {
    try { return JSON.parse(j.result) || {}; } catch { return {}; }
  }
  return {};
}

async function writeStore(obj) {
  const r = await upstash("/set/" + encodeURIComponent(STORE_KEY), {
    method: "POST",
    headers: { "content-type": "text/plain" },
    body: JSON.stringify(obj),
  });
  if (!r || !r.ok) throw new Error("Failed to write to Upstash");
}

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, x-admin-token");
  if (req.method === "OPTIONS") return res.status(200).end();

  // --- Auth gate ---
  const admin = process.env.ADMIN_PASSWORD;
  if (!admin) {
    return res.status(403).json({ locked: true, reason: "Set ADMIN_PASSWORD in your environment to enable the secrets manager." });
  }
  const token = req.headers["x-admin-token"];
  if (!token || token !== admin) {
    return res.status(401).json({ error: "Invalid admin token." });
  }

  if (!process.env.UPSTASH_REDIS_REST_URL || !process.env.UPSTASH_REDIS_REST_TOKEN) {
    return res.status(500).json({ error: "Upstash is not configured; cannot store secrets." });
  }

  try {
    if (req.method === "GET") {
      const stored = await readStore();
      const items = MANAGED.map((m) => {
        const envVal = process.env[m.name];
        const dbVal = stored[m.name];
        const source = envVal ? "env" : dbVal ? "db" : "none";
        const val = envVal || dbVal || "";
        return {
          name: m.name,
          label: m.label,
          configured: !!val,
          source,                       // env | db | none
          editable: !envVal,            // env-set keys can't be edited here (env wins)
          masked: mask(val),
        };
      });
      return res.status(200).json({ items });
    }

    if (req.method === "POST") {
      let body = req.body;
      if (typeof body === "string") { try { body = JSON.parse(body); } catch { body = {}; } }
      const name = body && body.name;
      if (!name || !MANAGED_NAMES.includes(name)) {
        return res.status(400).json({ error: "Unknown secret. Allowed: " + MANAGED_NAMES.join(", ") });
      }
      if (process.env[name]) {
        return res.status(409).json({ error: name + " is set in the environment (env wins). Change it in Vercel, not here." });
      }
      const stored = await readStore();

      if (body.delete) {
        delete stored[name];
        await writeStore(stored);
        return res.status(200).json({ ok: true, deleted: name });
      }

      const value = body.value;
      if (!value || typeof value !== "string" || value.trim().length < 8) {
        return res.status(400).json({ error: "Provide a valid key value (min 8 chars)." });
      }
      stored[name] = value.trim();
      await writeStore(stored);
      return res.status(200).json({ ok: true, saved: name, masked: mask(value.trim()) });
    }

    return res.status(405).json({ error: "Use GET or POST" });
  } catch (e) {
    return res.status(500).json({ error: e.message || "Request failed" });
  }
}
