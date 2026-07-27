// Premium website-factory foundation. Pure/data-driven so the browser builder
// and Node tests use the same concept, token, industry, and quality rules.
//
// INDUSTRY TAXONOMY: there is exactly one — the vertical registry in
// verticals.js. Marketing intelligence is keyed by the SAME vertical ids the
// back-office uses, and classification delegates to inferVertical(), so one
// industry decision drives both halves of the platform. Adding an industry is
// a data edit in two registries, never a change to classification logic.

import { VERTICAL_ORDER, inferVertical } from "./verticals.js";
import { auditSite } from "./quality-engine.js";

export const CONCEPTS = Object.freeze([
  { id: "authority", label: "Premium Authority", purpose: "Establish trust, expertise, and category leadership.", layout: "editorial", headingFont: "Fraunces", bodyFont: "Inter", radius: 4, motion: 700 },
  { id: "conversion", label: "Modern Conversion", purpose: "Turn qualified visits into calls, bookings, quotes, or purchases.", layout: "conversion", headingFont: "Manrope", bodyFont: "DM Sans", radius: 14, motion: 420 },
  { id: "cinematic", label: "Cinematic Innovation", purpose: "Create a distinctive, immersive, technology-forward brand experience.", layout: "cinematic", headingFont: "Syne", bodyFont: "Figtree", radius: 22, motion: 1000 },
]);

// One entry per vertical in VERTICAL_ORDER — enforced by test. Each describes how
// that industry actually converts: what the visitor is asked to do, what earns
// their trust, what stops them buying, and what must be verified before publishing.
export const INDUSTRY_INTELLIGENCE = Object.freeze({
  "home-services": { primary: "Request an estimate", secondary: "Call now", trust: ["Service area", "Licensing and insurance", "Verified reviews", "Financing"], objections: ["Response time", "Price clarity", "Workmanship guarantee"], sections: ["services", "service-area", "proof", "process", "financing", "faq", "contact"], compliance: ["Confirm licensing and insurance claims before publication"] },
  medical: { primary: "Book an appointment", secondary: "Call the practice", trust: ["Provider credentials", "Insurance information", "Patient experience", "Privacy"], objections: ["Treatment anxiety", "Insurance coverage", "Availability"], sections: ["treatments", "providers", "insurance", "process", "faq", "booking"], compliance: ["Do not imply HIPAA compliance without verification", "Do not make unsupported treatment claims"] },
  legal: { primary: "Schedule a consultation", secondary: "Call confidentially", trust: ["Practice focus", "Attorney credentials", "Case process", "Confidentiality"], objections: ["Cost", "Case fit", "Confidentiality"], sections: ["practice-areas", "expertise", "process", "case-studies", "faq", "consultation"], compliance: ["Do not promise outcomes", "Mark jurisdiction-specific disclaimers"] },
  restaurant: { primary: "Reserve a table", secondary: "View the menu", trust: ["Real menu and prices", "Location and hours", "Dietary information", "Guest reviews"], objections: ["Availability", "Dietary needs", "Price expectations"], sections: ["menu", "signature-items", "story", "gallery", "events", "locations", "reservation"], compliance: ["Confirm prices and allergen information"] },
  salon: { primary: "Book an appointment", secondary: "See the lookbook", trust: ["Stylist portfolios", "Licensing", "Hygiene standards", "Real client results"], objections: ["Choosing the right stylist", "Price certainty", "Availability"], sections: ["services", "stylists", "lookbook", "pricing", "reviews", "faq", "booking"], compliance: ["Confirm licensing", "Never promise a guaranteed cosmetic result"] },
  fitness: { primary: "Start a free trial", secondary: "See the class schedule", trust: ["Coach credentials", "Member results", "Live schedule", "Facility tour"], objections: ["Feeling out of place", "Contract lock-in", "Time to see results"], sections: ["programs", "schedule", "coaches", "results", "pricing", "faq", "trial"], compliance: ["Never guarantee fitness or weight outcomes", "Include a consult-your-physician note"] },
  hotel: { primary: "Check availability", secondary: "Explore the rooms", trust: ["Real room photography", "Verified guest reviews", "Location and transport", "Cancellation policy"], objections: ["Price versus value", "Location suitability", "Cancellation risk"], sections: ["rooms", "amenities", "gallery", "location", "offers", "faq", "booking"], compliance: ["Confirm rates, taxes, resort fees, and cancellation terms"] },
  events: { primary: "Check your date", secondary: "Book a venue tour", trust: ["Real event galleries", "Capacity and layouts", "Transparent packages", "Preferred vendors"], objections: ["Date availability", "Total budget", "Guest capacity"], sections: ["spaces", "capacity", "packages", "gallery", "vendors", "faq", "inquiry"], compliance: ["Confirm licensed capacity, alcohol licensing, and insurance requirements"] },
  retail: { primary: "Shop the collection", secondary: "Explore what's new", trust: ["Returns policy", "Delivery times", "Secure payment", "Product reviews"], objections: ["Will it fit or suit me", "Shipping cost and speed", "Returns friction"], sections: ["collections", "featured-products", "proof", "recommendations", "shipping-returns", "faq", "shop"], compliance: ["Confirm pricing, inventory, shipping, and returns terms"] },
  "real-estate": { primary: "Start a property search", secondary: "Request a valuation", trust: ["Market expertise", "Active listings", "Agent credentials", "Client proof"], objections: ["Market uncertainty", "Agent responsiveness", "Valuation accuracy"], sections: ["listings", "buyer-flow", "seller-flow", "areas", "agents", "proof", "valuation"], compliance: ["Confirm fair-housing and licensing disclosures"] },
  rei: { primary: "Get a cash offer", secondary: "See how it works", trust: ["Proof of funds", "Closing speed", "Deals closed", "No-fee guarantee"], objections: ["Is the offer fair", "Will it actually close", "Hidden fees"], sections: ["how-it-works", "offer-form", "proof", "situations", "funding", "faq", "contact"], compliance: ["Confirm lending licensing where required", "Never advertise guaranteed returns or a set purchase price"] },
  logistics: { primary: "Request a freight quote", secondary: "Track a shipment", trust: ["Lanes and coverage", "Authority and insurance", "On-time record", "Equipment types"], objections: ["Transit time", "Damage and liability", "Rate transparency"], sections: ["services", "coverage", "tracking", "equipment", "compliance", "faq", "quote"], compliance: ["Verify operating authority and cargo insurance before publishing"] },
  freelancer: { primary: "Book a discovery call", secondary: "See the work", trust: ["Case studies with outcomes", "Clear process", "Current availability", "Credentials"], objections: ["Reliability of a solo provider", "Price versus an agency", "Scope creep"], sections: ["services", "work", "process", "pricing", "about", "faq", "contact"], compliance: ["Get written client permission before naming them or showing their work"] },
  creative: { primary: "Book or inquire", secondary: "Experience the work", trust: ["Portfolio depth", "Press and features", "Live dates", "Notable collaborators"], objections: ["Stylistic fit", "Budget", "Availability"], sections: ["work", "portfolio", "press", "shows", "about", "faq", "contact"], compliance: ["Confirm rights and licensing for every work displayed"] },
  general: { primary: "Start a conversation", secondary: "Explore services", trust: ["Specific expertise", "Real customer proof", "Clear process", "Contact details"], objections: ["Fit", "Value", "Next steps"], sections: ["services", "differentiation", "proof", "process", "faq", "contact"], compliance: ["Confirm every factual claim before publication"] },
});

/** Map a business description to its marketing industry. Classification is NOT
 *  reimplemented here — it delegates to the registry's inferVertical(), whose
 *  rule ordering already handles the traps (a "Barber" is not a "bar", "lawn
 *  care" is not a law firm). Any vertical without an entry degrades to general. */
export function resolveMarketingIndustry(text) {
  const vertical = inferVertical(String(text || ""));
  return INDUSTRY_INTELLIGENCE[vertical] ? vertical : "general";
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

/** Score a concept by auditing the site it produces. Scoring lives in
 *  quality-engine.js; this is the seam the factory calls through, so the rubric
 *  can be tightened without the factory knowing how grading works. */
export function scoreConcept(concept, context) {
  return auditSite(context.generated, context.input, (concept && concept.strategy) || {}, concept);
}

export function createPremiumProject(input, generated) {
  // An explicit pick in the builder's industry selector wins over inference, so
  // the owner's one choice steers the marketing site and the back-office alike.
  const industryId = input.vertical && INDUSTRY_INTELLIGENCE[input.vertical] ? input.vertical : resolveMarketingIndustry(`${input.industry || ""} ${input.notes || ""}`);
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
    // The audit needs the RESOLVED industry (inference may have supplied it), so
    // rules like "a restaurant without a priced menu is incomplete" can fire.
    concept.quality = scoreConcept(concept, { input: { ...input, vertical: industryId }, generated });
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
  if (concept && !concept.quality.productionReady) {
    if (concept.quality.total < concept.quality.threshold) blockers.push(`Quality is ${concept.quality.total}/100 — the delivery standard is ${concept.quality.threshold}/100.`);
    // Name the defects themselves, not just the arithmetic: a site can clear the
    // score and still be unshippable (invented reviews, no way to make contact).
    for (const finding of (concept.quality.blockingFindings || [])) blockers.push(finding.message);
  }
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
