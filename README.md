# frontdeskagents.com — Website Factory (full-stack)

A real, deployable full-stack app for selling AI-generated websites to local
businesses. Frontend + serverless backend + cloud database. Built to run on
**Vercel** with **Upstash Redis** and the **Claude (Anthropic)** API.

```
.
├── api/
│   ├── generate.js   → POST: AI proxy with autonomous engine rotation
│   │                    (Claude → NVIDIA NIM → Gemini fallback)
│   ├── data.js       → GET/POST: Upstash read/write (leads & clients)
│   └── health.js     → GET: checks which engines/env are wired up
├── public/
│   ├── index.html    → marketing landing page
│   ├── pricing.html  → pricing tiers ($899 / $1,299 / $89-mo care)
│   ├── playbook.html → the Operator's Playbook (sell A→Z)
│   ├── contact.html  → free-mockup request form (saves to Upstash)
│   ├── builder.html  → the AI website builder (calls /api/generate)
│   └── dashboard.html→ leads/clients board (calls /api/data)
├── package.json
├── vercel.json
├── .env.example
└── .gitignore
```

## AI engines — autonomous fallback rotation

`/api/generate` tries engines in order and auto-rolls to the next one if an
engine is unset, errors, or is rate-limited. All keys stay server-side.

1. **Claude (Anthropic)** — primary brain · `ANTHROPIC_API_KEY`
2. **NVIDIA NIM (free)** — rotating pool of free models (Llama, Nemotron,
   Mixtral, Gemma, DeepSeek) · `NVIDIA_API_KEY` (free key at build.nvidia.com)
3. **OpenAI** — `OPENAI_API_KEY` (model via `OPENAI_MODEL`, default `gpt-4o-mini`)
4. **Grok (xAI)** — `XAI_API_KEY` (model via `XAI_MODEL`, default `grok-2-latest`)
5. **Google Gemini (free tier)** — `GEMINI_API_KEY` (key at aistudio.google.com)

Configure none and the builder still works — it falls back to built-in copy.
Configure any one and you get live AI generation. `/api/health` reports which
engines are active.

### Manage keys at runtime (dashboard → Settings)

Keys are resolved as `process.env` **first**, then from secrets stored in your
Upstash DB. The dashboard **Settings** tab lets you add/update/delete the AI
provider keys without redeploying:

- Set `ADMIN_PASSWORD` in env to unlock the panel (it stays locked otherwise).
- `/api/secrets` is admin-gated, never returns raw values (masked only), and
  refuses to manage keys that are already set in the environment (env wins).
- `/api/data` blocks the secrets key, so keys can't leak through the open data
  route. Upstash creds must stay in env (they bootstrap the lookup).

### Build from pasted business info

The builder has a **📋 Paste any business info** box: drop in an About blurb,
services & prices, hours, a menu, reviews, or the text from an old site, and the
AI uses it as the source of truth — you can leave the other fields blank.

## Why this is "full-stack" (and safe)

Your **Claude API key** and **Upstash token** live ONLY on the server as Vercel
environment variables. The browser never sees them — it just calls your own
`/api/*` endpoints. This fixes the security problem of putting secrets in
client-side code.

---

## Deploy in 10 minutes

### 1. Get your two services
- **Claude API key** — https://console.anthropic.com → API Keys → create key (`sk-ant-…`)
- **Upstash database** — https://console.upstash.com → Create Database (Redis) →
  open the **REST API** tab → copy the **UPSTASH_REDIS_REST_URL** and
  **UPSTASH_REDIS_REST_TOKEN**.

### 2. Put this repo on GitHub
```bash
git init
git add .
git commit -m "frontdeskagents website factory"
git branch -M main
git remote add origin https://github.com/SAHJONY/sahjony-ai-website-agency.git
git push -u origin main
```

### 3. Import into Vercel
- Go to https://vercel.com/new and import the GitHub repo.
- Framework preset: **Other** (it's static + serverless, no build step).
- Before deploying, add **Environment Variables** (Settings → Environment Variables):

| Name | Value |
|---|---|
| `ANTHROPIC_API_KEY` | your `sk-ant-…` key |
| `UPSTASH_REDIS_REST_URL` | your `https://…upstash.io` |
| `UPSTASH_REDIS_REST_TOKEN` | your Upstash REST token |
| `CLAUDE_MODEL` | *(optional)* e.g. `claude-3-5-sonnet-20241022` |

- Click **Deploy**.

### 4. Connect your domain
In Vercel → Project → **Settings → Domains**, add `frontdeskagents.com` and
follow the DNS instructions. Done — your platform is live and permanent.

---

## Test it

- `https://your-app.vercel.app/api/health` → should show `claude: true, upstash: true`.
- `/builder.html` → fill the form → **Build my website** → a full site renders, and
  **Download .html** exports a standalone copy for any host.
- `/dashboard.html` → add a lead → reload → it persists (proves the database works).

## Run locally
```bash
npm i -g vercel
cp .env.example .env.local   # fill in your real keys
vercel dev                   # http://localhost:3000
```

---

## Notes & next steps
- The builder **falls back** to built-in copy if the AI call fails, so it never
  shows an empty page.
- Gallery/hero images use free placeholder services; swap in the customer's real
  photos before launch (the builder's download gives you the editable HTML).
- The dashboard here is a lean, working starter. The richer dashboard (revenue,
  GPS lead finder, sales team, env manager) from the design files can be ported
  on top of these same `/api` endpoints when you're ready.
- **Security:** rotate any API key or token that has ever been pasted into a chat
  or shared. Never commit `.env.local`.

🤠 Build once. Bill monthly. Repeat.
