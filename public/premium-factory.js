// Premium website-factory foundation. Pure/data-driven so the browser builder
// and Node tests use the same concept, token, industry, and quality rules.

export const CONCEPTS = Object.freeze([
  { id: "authority", label: "Premium Authority", purpose: "Establish trust, expertise, and category leadership.", layout: "editorial", headingFont: "Fraunces", bodyFont: "Inter", radius: 4, motion: 700 },
  { id: "conversion", label: "Modern Conversion", purpose: "Turn qualified visits into calls, bookings, quotes, or purchases.", layout: "conversion", headingFont: "Manrope", bodyFont: "DM Sans", radius: 14, motion: 420 },
  { id: "cinematic", label: "Cinematic Innovation", purpose: "Create a distinctive, immersive, technology-forward brand experience.", layout: "cinematic", headingFont: "Syne", bodyFont: "Figtree", radius: 22, motion: 1000 },
]);

export const INDUSTRY_INTELLIGENCE = Object.freeze({
  "home-services": { keywords: /hvac|plumb|roof|electric|construction|landscap|cleaning|contractor|repair/i, primary: "Request an estimate", secondary: "Call now", trust: ["Service area", "Licensing and insurance", "Verified reviews", "Financing"], objections: ["Response time", "Price clarity", "Workmanship guarantee"], sections: ["services", "service-area", "proof", "process", "financing", "faq", "contact"], compliance: ["Confirm licensing claims before publication"] },
  medical: { keywords: /medical|clinic|doctor|dental|dentist|health|therapy/i, primary: "Book an appointment", secondary: "Call the practice", trust: ["Provider credentials", "Insurance information", "Patient experience", "Privacy"], objections: ["Treatment anxiety", "Insurance coverage", "Availability"], sections: ["treatments", "providers", "insurance", "process", "faq", "booking"], compliance: ["Do not imply HIPAA compliance without verification", "Do not make unsupported treatment claims"] },
  legal: { keywords: /law|legal|attorney|solicitor/i, primary: "Schedule a consultation", secondary: "Call confidentially", trust: ["Practice focus", "Attorney credentials", "Case process", "Confidentiality"], objections: ["Cost", "Case fit", "Confidentiality"], sections: ["practice-areas", "expertise", "process", "case-studies", "faq", "consultation"], compliance: ["Do not promise outcomes", "Mark jurisdiction-specific disclaimers"] },
  restaurant: { keywords: /restaurant|cafe|bakery|bar|food|pizza|taco|hospitality|hotel/i, primary: "Reserve or order", secondary: "View menu", trust: ["Real menu", "Location and hours", "Dietary information", "Guest reviews"], objections: ["Availability", "Dietary needs", "Price expectations"], sections: ["menu", "signature-items", "story", "gallery", "events", "locations", "reservation"], compliance: ["Confirm prices and allergen information"] },
  "real-estate": { keywords: /real estate|realtor|realty|broker|property/i, primary: "Start a property search", secondary: "Request a valuation", trust: ["Market expertise", "Active listings", "Agent credentials", "Client proof"], objections: ["Market uncertainty", "Agent responsiveness", "Valuation accuracy"], sections: ["listings", "buyer-flow", "seller-flow", "areas", "agents", "proof", "valuation"], compliance: ["Confirm fair-housing and licensing disclosures"] },
  commerce: { keywords: /shop|store|retail|e-?commerce|product|boutique/i, primary: "Shop products", secondary: "Explore collections", trust: ["Returns", "Delivery", "Secure payment", "Product reviews"], objections: ["Product fit", "Shipping", "Returns"], sections: ["collections", "featured-products", "proof", "recommendations", "faq", "shop"], compliance: ["Confirm pricing, inventory, shipping, and returns"] },
  general: { keywords: /.*/, primary: "Start a conversation", secondary: "Explore services", trust: ["Specific expertise", "Real customer proof", "Clear process", "Contact details"], objections: ["Fit", "Value", "Next steps"], sections: ["services", "differentiation", "proof", "process", "faq", "contact"], compliance: ["Confirm every factual claim before publication"] },
});

export function resolveMarketingIndustry(text) {
  return Object.keys(INDUSTRY_INTELLIGENCE).find((id) => id !== "general" && INDUSTRY_INTELLIGENCE[id].keywords.test(String(text || ""))) || "general";
}

function hue(hex, delta) {
  const raw = String(hex || "#2dd4bf").replace("#", "");
  const n = /^[0-9a-f]{6}$/i.test(raw) ? parseInt(raw, 16) : 0x2dd4bf;
  const parts = [(n >> 16) & 255, (n >> 8) & 255, n & 255].map((v, i) => Math.max(0, Math.min(255, v + delta * (i === 1 ? .65 : 1))));
  return "#" + parts.map((v) => Math.round(v).toString(16).padStart(2, "0")).join("");
}

export function createTokens(baseAccent, concept) {
  const accent = /^#[0-9a-f]{6}$/i.test(baseAccent || "") ? baseAccent : "#2dd4bf";
  return {
    primary: accent,
    secondary: hue(accent, concept.id === "authority" ? -42 : 24),
    accent: concept.id === "cinematic" ? hue(accent, 38) : accent,
    neutral: ["#04080f", "#0d1a2d", "#9fb3c9", "#e8eef7"],
    headingFont: concept.headingFont,
    bodyFont: concept.bodyFont,
    typeScale: [12, 14, 16, 20, 28, 40, 64, 88],
    spacing: [4, 8, 12, 16, 24, 32, 48, 72, 112],
    radius: concept.radius,
    shadow: concept.id === "authority" ? "0 24px 70px -36px rgba(0,0,0,.65)" : "0 32px 90px -32px rgba(0,0,0,.72)",
    motion: { fast: Math.round(concept.motion * .45), standard: concept.motion, slow: Math.round(concept.motion * 1.45) },
    containers: { reading: 760, content: 1180, wide: 1380 },
    breakpoints: { mobile: 600, tablet: 820, desktop: 1180 },
  };
}

export function scoreConcept(concept, context) {
  const g = context.generated || {};
  const input = context.input || {};
  const hasRealProof = !!input.hasVerifiedProof;
  const categories = {
    visual: concept.tokens && concept.tokens.headingFont && concept.tokens.spacing.length >= 7 ? 20 : 12,
    brand: input.name && input.industry ? (input.hasBrandAssets ? 15 : 13) : 9,
    conversion: concept.strategy.primary && (g.services || []).length >= 3 && (g.faqs || []).length >= 2 ? 20 : 14,
    mobile: concept.tokens.breakpoints && concept.mobileAction ? 15 : 10,
    accessibility: concept.accessibility.length >= 4 ? 10 : 6,
    performance: input.hasOptimizedMedia ? 10 : 9,
    seo: input.name && input.industry && (input.city || input.country) ? 10 : 8,
  };
  if (!hasRealProof) categories.brand = Math.min(categories.brand, 13);
  return { total: Object.values(categories).reduce((a, b) => a + b, 0), categories, threshold: 90, productionReady: Object.values(categories).reduce((a, b) => a + b, 0) >= 90, improvements: [!input.hasBrandAssets ? "Confirm logo and brand assets" : "", !hasRealProof ? "Add verified testimonials, credentials, or case proof" : "", !input.hasOptimizedMedia ? "Optimize final responsive media before production" : ""].filter(Boolean) };
}

export function createPremiumProject(input, generated) {
  const industryId = resolveMarketingIndustry(`${input.industry || ""} ${input.notes || ""}`);
  const intelligence = INDUSTRY_INTELLIGENCE[industryId];
  const baseAccent = (generated.design && (generated.design.accent || generated.design.primary)) || generated.primary;
  const concepts = CONCEPTS.map((definition) => {
    const concept = {
      ...definition,
      tokens: createTokens(baseAccent, definition),
      strategy: { primary: intelligence.primary, secondary: intelligence.secondary, trust: intelligence.trust, objections: intelligence.objections, sections: intelligence.sections },
      mobileAction: definition.id === "conversion" ? intelligence.primary : intelligence.secondary,
      accessibility: ["semantic landmarks", "visible focus", "reduced motion", "AA contrast", "keyboard navigation"],
      rationale: `${definition.label} aligns ${input.name || "the business"} with ${intelligence.primary.toLowerCase()} while addressing ${intelligence.objections.slice(0, 2).join(" and ").toLowerCase()}.`,
    };
    concept.quality = scoreConcept(concept, { input, generated });
    return concept;
  });
  const recommended = concepts.slice().sort((a, b) => (b.quality.total + (b.id === "conversion" ? 2 : 0)) - (a.quality.total + (a.id === "conversion" ? 2 : 0)))[0].id;
  return { version: 1, industryId, intelligence, input, concepts, recommended, selectedConcept: recommended, review: newReview(), revisions: [], createdAt: new Date().toISOString() };
}

/* ============================ APPROVAL & REVISIONS ============================
   A project moves draft → in-review → (changes-requested ⇄ in-review) → approved.
   The state and its revision trail live ON the project blob so they survive a
   publish round-trip through /api/sites (fda:site:<slug>.factoryProject) — the
   builder is stateless between sessions, so nothing else would remember them. */

export const REVIEW_STATES = Object.freeze(["draft", "in-review", "changes-requested", "approved"]);
const REVISION_LIMIT = 25;

function newReview() { return { state: "draft", note: "", by: "", at: null }; }

/** True when `next` is a legal move from `current`. Approval is never sticky: any
 *  later edit re-opens review, so approved → in-review is allowed on purpose. */
export function canTransition(current, next) {
  return REVIEW_STATES.includes(next) && REVIEW_STATES.includes(current || "draft") && next !== (current || "draft");
}

/** Pure publish gate. The builder and the server both call this so an owner can
 *  never be shown one verdict by the UI and another by the API. */
export function canPublish(project) {
  const blockers = [];
  const concept = selectedConcept(project);
  if (!concept) blockers.push("Pick a design concept before publishing.");
  if (concept && !concept.quality.productionReady) blockers.push(`Quality is ${concept.quality.total}/100 — the delivery standard is ${concept.quality.threshold}/100.`);
  if (project && project.review && project.review.state === "changes-requested") blockers.push(`Changes were requested${project.review.note ? ": " + project.review.note : "."}`);
  return { allowed: blockers.length === 0, blockers, improvements: (concept && concept.quality.improvements) || [] };
}

export function selectedConcept(project) {
  if (!project || !Array.isArray(project.concepts)) return null;
  return project.concepts.find((c) => c.id === project.selectedConcept) || project.concepts.find((c) => c.id === project.recommended) || project.concepts[0] || null;
}

/** Record a review decision and append it to the trail. Returns a NEW project —
 *  callers persist the result; nothing here mutates the input. */
export function applyReview(project, decision) {
  const current = (project && project.review && project.review.state) || "draft";
  const next = decision && decision.state;
  if (!canTransition(current, next)) return project;
  const review = { state: next, note: String((decision && decision.note) || "").slice(0, 500), by: String((decision && decision.by) || "").slice(0, 120), at: (decision && decision.at) || new Date().toISOString() };
  return { ...project, review, revisions: appendRevision(project, { kind: "review", state: next, note: review.note, by: review.by, at: review.at }) };
}

/** Append a trail entry (review decision or publish), oldest trimmed first. */
export function appendRevision(project, entry) {
  const trail = Array.isArray(project && project.revisions) ? project.revisions : [];
  const concept = selectedConcept(project);
  const record = {
    // Counted from the highest number seen, not the array length: once the trail
    // is trimmed those diverge, and reusing a revision number would make the
    // audit trail ambiguous about which entry is being referred to.
    n: trail.reduce((max, r) => Math.max(max, Number(r && r.n) || 0), 0) + 1,
    at: (entry && entry.at) || new Date().toISOString(),
    kind: entry && entry.kind === "publish" ? "publish" : "review",
    state: String((entry && entry.state) || "").slice(0, 40),
    concept: (concept && concept.id) || "",
    quality: (concept && concept.quality.total) || 0,
    note: String((entry && entry.note) || "").slice(0, 500),
    by: String((entry && entry.by) || "").slice(0, 120),
    overridden: !!(entry && entry.overridden),
  };
  return trail.concat(record).slice(-REVISION_LIMIT);
}

/** Merge a browser-supplied project over the stored one at publish time.
 *  The browser owns design data (concepts, tokens, which one is selected); the
 *  server owns the approval trail, so `review` and `revisions` are always taken
 *  from what is already stored and a forged trail in the request is discarded.
 *  Returns the project with the publish already stamped into its history. */
export function mergeFactoryProject(stored, incoming, at) {
  const project = incoming && typeof incoming === "object" ? incoming : stored;
  if (!project || typeof project !== "object") return null;
  const kept = stored && typeof stored === "object" ? stored : {};
  const merged = {
    ...project,
    review: kept.review || (stored ? newReview() : project.review) || newReview(),
    revisions: Array.isArray(kept.revisions) ? kept.revisions : [],
  };
  // A publish that goes out below the delivery standard is recorded as an
  // override rather than hidden, so the history stays honest.
  const gate = canPublish(merged);
  merged.revisions = appendRevision(merged, { kind: "publish", state: "published", at, overridden: !gate.allowed, note: gate.allowed ? "" : gate.blockers.join(" ") });
  return merged;
}

/** Flat metrics for the owner dashboard — everything it needs without shipping
 *  the whole (large) project blob into the sites index. */
export function summarizeProject(project) {
  const concept = selectedConcept(project);
  const trail = Array.isArray(project && project.revisions) ? project.revisions : [];
  const gate = canPublish(project);
  const published = trail.filter((r) => r.kind === "publish");
  return {
    concept: (concept && concept.id) || "",
    conceptLabel: (concept && concept.label) || "",
    quality: (concept && concept.quality.total) || 0,
    threshold: (concept && concept.quality.threshold) || 90,
    productionReady: !!(concept && concept.quality.productionReady),
    industryId: (project && project.industryId) || "",
    reviewState: (project && project.review && project.review.state) || "draft",
    reviewNote: (project && project.review && project.review.note) || "",
    revisions: trail.length,
    publishes: published.length,
    lastPublishedAt: published.length ? published[published.length - 1].at : null,
    overrides: published.filter((r) => r.overridden).length,
    blockers: gate.blockers,
    improvements: gate.improvements,
  };
}

export function applyConcept(generated, project, conceptId) {
  const concept = project.concepts.find((item) => item.id === conceptId) || project.concepts[0];
  const selectedProject = { ...project, selectedConcept: concept.id };
  return {
    ...generated,
    design: { ...(generated.design || {}), primary: concept.tokens.primary, accent: concept.tokens.accent, headingFont: concept.tokens.headingFont, bodyFont: concept.tokens.bodyFont },
    __concept: concept,
    __factoryProject: selectedProject,
  };
}

if (typeof window !== "undefined") window.PremiumFactory = { CONCEPTS, INDUSTRY_INTELLIGENCE, REVIEW_STATES, resolveMarketingIndustry, createTokens, scoreConcept, createPremiumProject, applyConcept, canTransition, canPublish, selectedConcept, applyReview, appendRevision, mergeFactoryProject, summarizeProject };
