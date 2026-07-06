// Bland.ai helper (NOT an API route — lives in /lib so it isn't counted as a
// Serverless Function, keeping us under Vercel's 12-function Hobby cap).
// Places outbound AI voice calls for owner-launched marketing campaigns.
//
// Key: BLAND_API_KEY — from env, or stored in Upstash (fda:secrets) via the
// dashboard Settings panel, same as every other provider key. Never reaches the
// browser: business.html calls /api/site (owner-gated) which calls this.

async function blandKey() {
  if (process.env.BLAND_API_KEY) return process.env.BLAND_API_KEY;
  const url = process.env.UPSTASH_REDIS_REST_URL, token = process.env.UPSTASH_REDIS_REST_TOKEN;
  if (!url || !token) return "";
  try {
    const r = await fetch(url.replace(/\/$/, "") + "/get/" + encodeURIComponent("fda:secrets"), { headers: { Authorization: "Bearer " + token } });
    const j = await r.json();
    if (j && j.result) { try { return (JSON.parse(j.result) || {}).BLAND_API_KEY || ""; } catch { return ""; } }
  } catch (_) {}
  return "";
}

export async function blandConfigured() { return !!(await blandKey()); }

// Normalize a loosely-typed phone into E.164-ish (+digits); assume US when 10 digits.
export function normalizePhone(p) {
  let d = String(p || "").replace(/[^\d+]/g, "");
  if (!d) return "";
  if (d[0] !== "+") d = d.length === 10 ? "+1" + d : "+" + d;
  return d;
}

// Place one AI voice call. Returns { ok, callId?, error?, phone }.
export async function blandCall({ phone, task, voice, firstSentence }) {
  const key = await blandKey();
  if (!key) return { ok: false, error: "Bland.ai not configured (set BLAND_API_KEY).", phone: "" };
  const to = normalizePhone(phone);
  if (!to) return { ok: false, error: "Invalid phone number.", phone: String(phone || "") };
  try {
    const body = {
      phone_number: to,
      task: String(task || "").slice(0, 4000),
      wait_for_greeting: true,
      record: false,
    };
    if (voice) body.voice = voice;
    if (firstSentence) body.first_sentence = String(firstSentence).slice(0, 300);
    const r = await fetch("https://api.bland.ai/v1/calls", {
      method: "POST",
      headers: { "content-type": "application/json", authorization: key },
      body: JSON.stringify(body),
    });
    const j = await r.json().catch(() => ({}));
    if (!r.ok || (j && j.status === "error")) {
      const detail = (j && (j.message || j.error || (Array.isArray(j.errors) ? j.errors.join("; ") : j.errors))) || ("Bland HTTP " + r.status);
      return { ok: false, error: String(detail).slice(0, 300), phone: to };
    }
    return { ok: true, callId: j.call_id || j.callId || "", phone: to };
  } catch (e) { return { ok: false, error: e.message || "Bland request failed", phone: to }; }
}
