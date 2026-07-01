// Shared request guards: per-IP rate limiting (Upstash) + timing-safe string
// comparison. Used by the public/auth endpoints so client-portal passwords,
// rep access codes, and the owner login can't be brute-forced, and the public
// contact form can't be flooded (the inbox is capped at 500 — spam would evict
// real leads).
import { timingSafeEqual } from "node:crypto";

// Constant-time string comparison. Hashes both sides to equal length first so
// length differences don't leak timing either.
import { createHash } from "node:crypto";
export function safeEqual(a, b) {
  const ha = createHash("sha256").update(String(a ?? "")).digest();
  const hb = createHash("sha256").update(String(b ?? "")).digest();
  return timingSafeEqual(ha, hb);
}

function upstash() {
  const url = process.env.UPSTASH_REDIS_REST_URL;
  const token = process.env.UPSTASH_REDIS_REST_TOKEN;
  if (!url || !token) return null;
  return { base: url.replace(/\/$/, ""), auth: { Authorization: "Bearer " + token } };
}

export function clientIp(req) {
  const xff = String(req.headers["x-forwarded-for"] || "").split(",")[0].trim() || "anon";
  return xff.replace(/[^a-zA-Z0-9:._-]/g, "_").slice(0, 60);
}

// Sliding-bucket limiter: allows `limit` hits per `windowSec` per (name, key).
// Fails OPEN on any storage problem so a Redis hiccup never locks out real
// users; the protected secrets themselves are still required to get in.
export async function rateLimit(req, name, { limit = 15, windowSec = 600, key } = {}) {
  const u = upstash();
  if (!u || limit <= 0) return { limited: false };
  const id = (key || clientIp(req)).slice(0, 80);
  const bucket = Math.floor(Date.now() / 1000 / windowSec);
  const k = `fda:rl:${name}:${id}:${bucket}`;
  try {
    const r = await fetch(u.base + "/incr/" + encodeURIComponent(k), { headers: u.auth });
    const j = await r.json();
    const n = Number(j && j.result) || 0;
    if (n === 1) {
      fetch(u.base + "/expire/" + encodeURIComponent(k) + "/" + windowSec, { headers: u.auth }).catch(() => {});
    }
    return { limited: n > limit, retryAfter: windowSec };
  } catch {
    return { limited: false };
  }
}
