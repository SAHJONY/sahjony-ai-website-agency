// GET /api/health — quick check that env vars are wired up (does not leak secrets)
export default function handler(req, res) {
  res.status(200).json({
    ok: true,
    service: "frontdeskagents website factory",
    time: new Date().toISOString(),
    config: {
      claude: !!process.env.ANTHROPIC_API_KEY,
      nvidia: !!process.env.NVIDIA_API_KEY,
      gemini: !!process.env.GEMINI_API_KEY,
      upstash: !!(process.env.UPSTASH_REDIS_REST_URL && process.env.UPSTASH_REDIS_REST_TOKEN),
      model: process.env.CLAUDE_MODEL || "claude-3-5-sonnet-20241022",
      geminiModel: process.env.GEMINI_MODEL || "gemini-2.5-flash",
    },
    engineRotation: ["claude (primary)", "nvidia nim (rotating fallback)", "gemini (fallback)"],
  });
}
