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
  return { version: 1, industryId, intelligence, input, concepts, recommended, createdAt: new Date().toISOString() };
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

if (typeof window !== "undefined") window.PremiumFactory = { CONCEPTS, INDUSTRY_INTELLIGENCE, resolveMarketingIndustry, createTokens, scoreConcept, createPremiumProject, applyConcept };
