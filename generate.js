// POST /api/generate  { prompt: string, maxTokens?: number }
// Securely proxies to the Anthropic (Claude) API. The API key lives ONLY on the
// server (Vercel env var), never in the browser.

export default async function handler(req, res) {
  // Basic CORS for same-origin + preflight
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  if (req.method === "OPTIONS") return res.status(200).end();

  if (req.method !== "POST") {
    return res.status(405).json({ error: "Use POST" });
  }

  const key = process.env.ANTHROPIC_API_KEY;
  if (!key) {
    return res.status(500).json({ error: "ANTHROPIC_API_KEY is not configured on the server." });
  }

  // Vercel parses JSON bodies automatically, but guard for string bodies too.
  let body = req.body;
  if (typeof body === "string") {
    try { body = JSON.parse(body); } catch { body = {}; }
  }
  const prompt = body && body.prompt;
  const maxTokens = (body && body.maxTokens) || 2000;
  if (!prompt || typeof prompt !== "string") {
    return res.status(400).json({ error: "Body must include a 'prompt' string." });
  }

  try {
    const r = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-api-key": key,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: process.env.CLAUDE_MODEL || "claude-3-5-sonnet-20241022",
        max_tokens: maxTokens,
        messages: [{ role: "user", content: prompt }],
      }),
    });

    const data = await r.json();
    if (!r.ok) {
      return res.status(r.status).json({ error: (data && data.error && data.error.message) || "Claude API error" });
    }
    const text = (data.content && data.content[0] && data.content[0].text) || "";
    return res.status(200).json({ text });
  } catch (e) {
    return res.status(500).json({ error: e.message || "Request failed" });
  }
}
