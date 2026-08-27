import { safeEqual } from "../lib/guard.js";

const CONNECT_URL = String(process.env.SAHJONY_CONNECT_URL || "https://sahjony-connect.vercel.app").replace(/\/$/, "");

function authorized(req) {
  const expected = String(process.env.ADMIN_PASSWORD || "");
  const supplied = String(req.headers["x-admin-token"] || "");
  return Boolean(expected && supplied && safeEqual(expected, supplied));
}

export default async function handler(req, res) {
  res.setHeader("Cache-Control", "no-store");
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });
  if (!authorized(req)) return res.status(401).json({ error: "Owner authorization required" });

  const integrationKey = String(process.env.SAHJONY_CONNECT_INTEGRATION_KEY || "").trim();
  if (!integrationKey) return res.status(503).json({ error: "SAHJONY Connect integration is not configured" });

  const input = req.body && typeof req.body === "object" ? req.body : {};
  const mode = input.mode === "voice" || input.mode === "video" ? input.mode : "text";
  const contextId = String(input.contextId || "agency-command-center").trim().slice(0, 240) || "agency-command-center";
  const contactName = String(input.contactName || "").trim().slice(0, 180) || undefined;
  const language = String(input.language || "auto").trim().slice(0, 35) || "auto";

  try {
    const upstream = await fetch(`${CONNECT_URL}/api/connect/internal/website-agency/session`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-connect-integration-key": integrationKey,
      },
      body: JSON.stringify({
        external_context_id: contextId,
        context_type: contextId === "agency-command-center" ? "website_agency_operations" : "website_project",
        display_name: contactName,
        language,
        mode,
        ai_assistance: false,
      }),
      signal: AbortSignal.timeout(20000),
    });
    const text = await upstream.text();
    res.status(upstream.status);
    res.setHeader("content-type", upstream.headers.get("content-type") || "application/json");
    return res.send(text || "{}");
  } catch {
    return res.status(502).json({ error: "SAHJONY Connect is temporarily unavailable" });
  }
}
