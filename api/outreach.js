// POST /api/outreach  { channel:"email"|"sms", to, subject?, message }  — owner-only.
// Sends outreach via Resend (email) or Twilio (SMS). Keys stay server-side.
//   Email: RESEND_API_KEY (+ optional OUTREACH_FROM, default onboarding@resend.dev)
//   SMS:   TWILIO_ACCOUNT_SID + TWILIO_AUTH_TOKEN + TWILIO_FROM

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, x-admin-token");
  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST") return res.status(405).json({ error: "Use POST" });

  const admin = process.env.ADMIN_PASSWORD;
  if (admin && req.headers["x-admin-token"] !== admin) return res.status(401).json({ error: "Unauthorized." });

  let body = req.body;
  if (typeof body === "string") { try { body = JSON.parse(body); } catch { body = {}; } }
  body = body || {};
  const channel = body.channel === "sms" ? "sms" : "email";
  const to = String(body.to || "").trim();
  const message = String(body.message || "").trim();
  const subject = String(body.subject || "A quick website idea for your business").slice(0, 160);
  if (!to || !message) return res.status(400).json({ error: "'to' and 'message' are required." });

  try {
    if (channel === "email") {
      const rk = process.env.RESEND_API_KEY;
      if (!rk) return res.status(500).json({ error: "Set RESEND_API_KEY to send emails." });
      const from = process.env.OUTREACH_FROM || "onboarding@resend.dev";
      const r = await fetch("https://api.resend.com/emails", {
        method: "POST",
        headers: { Authorization: "Bearer " + rk, "content-type": "application/json" },
        body: JSON.stringify({ from, to, subject, text: message }),
      });
      const j = await r.json();
      if (!r.ok) return res.status(r.status).json({ error: (j && (j.message || j.error)) || "Email failed" });
      return res.status(200).json({ ok: true, id: j.id });
    }

    // SMS via Twilio
    const sid = process.env.TWILIO_ACCOUNT_SID, tok = process.env.TWILIO_AUTH_TOKEN, from = process.env.TWILIO_FROM;
    if (!sid || !tok || !from) return res.status(500).json({ error: "Set TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN and TWILIO_FROM to send SMS." });
    const form = new URLSearchParams({ To: to, From: from, Body: message });
    const r = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${sid}/Messages.json`, {
      method: "POST",
      headers: { Authorization: "Basic " + Buffer.from(sid + ":" + tok).toString("base64"), "content-type": "application/x-www-form-urlencoded" },
      body: form.toString(),
    });
    const j = await r.json();
    if (!r.ok) return res.status(r.status).json({ error: (j && j.message) || "SMS failed" });
    return res.status(200).json({ ok: true, sid: j.sid });
  } catch (e) {
    return res.status(500).json({ error: e.message || "Request failed" });
  }
}
