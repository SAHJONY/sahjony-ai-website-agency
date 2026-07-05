# SYSTEM SPECIFICATION: CINEMATIC WEB PLATFORM & BACK-OFFICE ORCHESTRATOR

> Governing spec for the SAHJONY Website Factory (`frontdeskagents-website-factory`).
> The verbatim vision is in §1–§6. **Before acting, read §7 — STACK RECONCILIATION** —
> it maps this vision onto the repo as it actually exists today. Where §1–§6 name a
> technology this repo does not use, §7 wins.

## 1. VISION & CORE OBJECTIVE
You are an elite AI Systems Architect and Senior Full-Stack Engineer. Your mandate is to build ultra-premium, cinematic, production-grade web applications that seamlessly combine an elite consumer-facing interface with a deeply tailored back-office owner dashboard.

Every website must be a high-converting masterpiece designed with Hollywood-level cinematic realism and a Tesla-style product aesthetic. Simultaneously, it must function as the central operating system for the business owner, packed with industry-specific operational tools.

**THE NON-NEGOTIABLE RULE:** A single generic dashboard CANNOT serve every business. Every business gets its OWN back-office, tailored to its industry and how that industry actually operates. The consumer site and the owner dashboard are generated side-by-side, per vertical.

---

## 2. THE DESIGN SYSTEM: "OBSIDIAN-VACUUM"
Never build generic, flat, or cartoonish UIs. Every component must look like a multi-million dollar digital product.
*   **Visual Language:** High-fidelity 8k photo-realism, ultra-premium cinematic depth, fluid physical interactions, and razor-sharp borders.
*   **Color Palette:** Dominated by an "obsidian-vacuum" contrast architecture—deep pitch blacks, dark charcoal grays (`#0A0A0A`, `#121212`), muted translucent glass surfaces, and hyper-precise luminescent accent lighting (e.g., sharp cyan, electric silver, or muted gold).
*   **UI Assets:** Every background, looping video hero, and product display must leverage the Higgsfield MCP video/image generation network to display real, hyper-realistic interfaces.

---

## 3. ENGINE FRAMEWORK (ASPIRATIONAL — see §7 for what this repo really runs)
*   **Frontend:** Next.js 15+ (App Router), React 19, strict TypeScript mode, and Tailwind CSS.
*   **Database & Sync:** Convex for real-time reactive streaming of state, updates, and metrics.
*   **Execution Isolation:** Daytona sandboxing for testing custom business logic, runtime tasks, and handling client micro-services.

---

## 4. MULTI-INDUSTRY BACK-OFFICE OPERATIONS ENGINE
When a business website is provisioned, the application must dynamically generate an industry-specific **Owner Dashboard** containing exact operational modules. Implement the following business-logic engines based on the target vertical:

| Industry Vertical | Premium Consumer Frontend Feature | Back-Office Owner Dashboard Module | Operational Requirements |
| :--- | :--- | :--- | :--- |
| **Medical / Clinical Practice** | Cinematic medical tech reveal, HIPAA-secure scheduling, high-fidelity staff profiles. | **Patient EHR & Clinical Flow Engine** | Real-time intake queue, treatment chart updater, live practitioner scheduling, billing tracker. |
| **Real Estate Brokerage** | 8K interactive walkthroughs, ultra-premium dynamic map overlays, property filter systems. | **Property Portfolio & Deal Pipeline** | Live escrow milestone tracking, contract generation state machine, agent commission splitting. |
| **Legal / Law Firm** | High-status executive presence, secure case intake, multi-tier consultation pricing matrices. | **Case Ledger & Billable Hour Tracker** | Retainer fund depletion models, court calendar sync, automated document drafting queues. |
| **Logistics / Fleet Ops** | Enterprise-grade dynamic freight quotes, global tracking animations, premium client portal. | **Dispatch Control & Route Telemetry** | Live driver assignment blocks, dynamic fuel margin calculators, shipping manifest manager. |

This table is a STARTER SET, not the whole world. The factory sells to any local business
(restaurants, salons, roofers, gyms, dentists, auto shops…). Each vertical needs its own
module map. Treat the four rows above as reference implementations to clone from.

---

## 5. HIGGSFIELD MCP ASSET INTEGRATION
Cinematic imagery/video comes from the Higgsfield Model Context Protocol network.

### Five-Field Prompt Asset Rule
Every image/video prompt must be composed from this strict five-field block:
1.  **MODEL:** Target specialized pipeline (e.g., `Soul V2` for human models; `Seedance 2.0` for smooth loops).
2.  **COMPOSITION:** Explicit cinematic framing (e.g., `"Cinematic ultra-wide product hero, balanced dark-room framing"`).
3.  **SUBJECT:** Technical component detail (e.g., `"Sleek futuristic medical analytical tracking module showing fluid line charts"`).
4.  **LIGHTING:** High-fidelity premium ambiance (e.g., `"Obsidian-vacuum deep contrast, sharp cyber-cyan rim lighting"`).
5.  **AESTHETIC:** Ultra-realistic production standard (e.g., `"Tesla-style high-end luxury digital asset, 8k resolution"`).

---

## 6. WORKFLOW & AUTONOMOUS RECURSION
1.  **Read and Scan:** Review existing layout blocks, matching state providers, and active mutations.
2.  **Generate & Refine:** Build the consumer marketing page AND the multi-industry operational back office side-by-side. Keep backend state in sync.
3.  **Validate:** Check types/params, test edge-case loading frames for dashboard panels, output robust, flawless, self-documenting code.

---

## 7. STACK RECONCILIATION — HOW THIS REPO ACTUALLY WORKS

The vision in §1–§6 was written against a Next.js 15 + Convex + Daytona stack. **This repo
is not that.** Do NOT `npm install convex`, add an App Router, or wire Daytona. Map the
concepts onto what exists:

| Vision concept (§3/§5)         | Reality in THIS repo                                                                 |
| :----------------------------- | :----------------------------------------------------------------------------------- |
| Next.js 15 App Router / React 19 | Static HTML pages in `public/*.html` (`builder.html`, `dashboard.html`, …), no framework. |
| Convex real-time DB             | **Upstash Redis** via `api/data.js` + `api/secrets.js` (REST). This is our state store. |
| Daytona sandboxing              | **Vercel serverless functions** in `api/*.js` (`vercel.json` sets `maxDuration`). No sandbox layer. |
| Convex `action` calling MCP     | Server route `api/image.js` (image/video) + `api/generate.js` (the multi-engine text brain). |
| Higgsfield MCP direct call      | Reached server-side through `api/image.js` (mode:`image`/`video`). Keys stay server-side. |
| TypeScript strict               | Mostly plain JS (`api/*.js`, inline `<script>` in HTML). `pricing.ts`/`route.ts` are the exceptions. |

### 7a. Where site generation lives today
- The **entire generation prompt is client-side** in `public/builder.html` (~line 401), producing
  ONE JSON blob that renders a **consumer marketing site only**. Schema: tagline, hero, services,
  menu, reviews, faqs, hours, design tokens, labels.
- `api/generate.js` is a stateless multi-engine text proxy (Claude → NVIDIA → OpenAI → Grok →
  Gemini → GLM, with per-engine + total time budgets to avoid 504s). It does not know about
  industries or dashboards — it just runs whatever prompt it's handed.
- `public/dashboard.html` is the **operator's** leads/clients board (calls `api/data.js`). It is
  the agency's own CRM — NOT the per-client industry back-office §4 describes.

### 7b. THE MISSING HALF (this is the actual work §1 & §4 demand)
Today the factory ships a beautiful consumer site with **no per-industry owner dashboard**, and
the builder form has **no industry/vertical selector**. To make this spec real:

1. **Add a vertical selector** to `public/builder.html` (a `<select id="fIndustry">` near the
   business-type field), and pass the chosen vertical into the generation call.
2. **Extend the generation contract** so `/api/generate` returns BOTH:
   - `site`  → the existing consumer marketing JSON, and
   - `backoffice` → an industry-specific dashboard spec (modules, panels, data schema) chosen
     from the §4 map for that vertical.
   Keep the two prompts separate (marketing designer vs. ops architect) so one weak response
   can't corrupt the other.
3. **Add a per-industry module registry** (suggest `lib/verticals.js`) mapping each vertical →
   its dashboard modules + the Upstash key shapes each module reads/writes. Start with the four
   §4 rows; make adding a vertical a data edit, not a code rewrite.
4. **Render the back-office** as a generated `dashboard` view (mirroring how `builder.html`
   renders the site preview), backed by `api/data.js` (Upstash) for live state — this is our
   stand-in for Convex reactivity (poll or SSE, not true subscriptions).
5. **Cinematic dashboard visuals** come from `api/image.js` using the §5 five-field prompt block,
   not a Convex action.

### 7c. Guardrails specific to this repo
- Never leak provider keys to the browser — all AI/asset calls go through `api/*.js`.
- Respect the existing time budgets in `api/generate.js`; a second (back-office) generation must
  not push a single request past `vercel.json`'s `maxDuration`. Prefer a separate request/route
  for the back-office spec over one giant prompt.
- Preserve the anti-generic guarantee already in `builder.html`: if generation fails, tell the
  user a starter site was used — never present a generic fallback as a finished AI design.
