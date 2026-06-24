// POST /api/login  { password }  — owner login for the dashboard.
//
// Validates against ADMIN_PASSWORD (server env var). If ADMIN_PASSWORD is not
// set, responds { ok:true, noPassword:true } so the dashboard still opens, but
// the UI will warn that a password should be set to protect it.
export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST") return res.status(405).json({ error: "Use POST" });

  const admin = process.env.ADMIN_PASSWORD;
  if (!admin) return res.status(200).json({ ok: true, noPassword: true });

  let body = req.body;
  if (typeof body === "string") { try { body = JSON.parse(body); } catch { body = {}; } }
  const password = body && body.password;

  if (password && password === admin) return res.status(200).json({ ok: true });
  return res.status(401).json({ ok: false, error: "Wrong password" });
}
