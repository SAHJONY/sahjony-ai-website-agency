// QUALITY ENGINE — the platform's definition of "good".
//
// The rubric this replaces scored the ORDER FORM: it asked whether the owner
// ticked "has brand assets" and returned 91-100 for virtually any input, so the
// 90/100 delivery gate never fired. This audits the SITE THAT WAS ACTUALLY
// GENERATED — its copy, its contact paths, its colour contrast, its coverage of
// the industry's sections — and every deduction names the thing to fix.
//
// Design rules for anything added here:
//   1. Measure the artefact, never the intent. "hasOptimizedMedia: true" is a
//      claim; a hero URL that is a loremflickr placeholder is a fact.
//   2. Prefer real math to heuristics. Colour contrast is WCAG 2.1, computed.
//   3. Every deduction carries a fix. A score with no remedy is not actionable.

/* ----------------------------- colour science ----------------------------- */

/** Parse #rgb / #rrggbb into [r,g,b] 0-255, or null when it isn't a colour. */
export function parseHex(hex) {
  const raw = String(hex || "").trim().replace(/^#/, "");
  const full = raw.length === 3 ? raw.split("").map((c) => c + c).join("") : raw;
  if (!/^[0-9a-f]{6}$/i.test(full)) return null;
  const n = parseInt(full, 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

/** WCAG 2.1 relative luminance. */
export function relativeLuminance(hex) {
  const rgb = parseHex(hex);
  if (!rgb) return null;
  const [r, g, b] = rgb.map((v) => {
    const c = v / 255;
    return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/** WCAG 2.1 contrast ratio, 1..21. Returns null if either colour is invalid. */
export function contrastRatio(a, b) {
  const la = relativeLuminance(a);
  const lb = relativeLuminance(b);
  if (la === null || lb === null) return null;
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
}

/** Black or white — whichever is readable on `bg`. Mirrors the builder's rule. */
export function readableOn(bg) {
  const onWhite = contrastRatio(bg, "#ffffff");
  const onBlack = contrastRatio(bg, "#000000");
  if (onWhite === null || onBlack === null) return "#000000";
  return onWhite >= onBlack ? "#ffffff" : "#000000";
}

/* ------------------------------ content rules ------------------------------ */

// Text that means the generator gave up or a field was never filled.
const PLACEHOLDER = /(lorem ipsum|dolor sit amet|\bTBD\b|\bTODO\b|\bXXX+\b|placeholder|your (?:business|company) name|sample text|coming soon)/i;
const EMPTY_ARTEFACT = /^(undefined|null|NaN|\[object Object\]|-|—|n\/?a)$/i;
// Stock-photo services the builder falls back to when the client uploaded none.
const PLACEHOLDER_MEDIA = /loremflickr|placehold|picsum\.photos|unsplash\.it|dummyimage/i;
// Review copy the AI was told never to invent; these read as fabricated praise.
const GENERIC_REVIEW = /(best .* in town|highly recommend|friendly, fair|won'?t go anywhere else|great work, every time|quick, professional)/i;

const BLANK = (s) => !String(s || "").trim() || EMPTY_ARTEFACT.test(String(s).trim());

// Verticals whose site is incomplete without a priced item list.
const MENU_REQUIRED = new Set(["restaurant", "retail", "hotel"]);

/* -------------------------------- the audit -------------------------------- */

/** Weight of each category; they sum to 100. Kept explicit so the contract is
 *  auditable and a reweighting is a visible diff rather than a silent drift. */
export const CATEGORY_WEIGHTS = Object.freeze({
  contentIntegrity: 24,
  conversion: 20,
  industryFit: 16,
  designCraft: 14,
  accessibility: 12,
  media: 8,
  seo: 6,
});

const SEVERITY_ORDER = { critical: 0, major: 1, minor: 2 };

/**
 * Audit a generated site.
 * @param {object} generated  the AI content blob (tagline, services, faqs, ...)
 * @param {object} input      verified business facts (name, city, phone, media)
 * @param {object} intel      the industry's INDUSTRY_INTELLIGENCE entry
 * @param {object} concept    the chosen design concept (tokens, id)
 * @returns {{total:number, categories:object, findings:Array, threshold:number,
 *            productionReady:boolean, improvements:string[], grade:string}}
 */
export function auditSite(generated, input, intel, concept) {
  const g = generated || {};
  const i = input || {};
  const industry = intel || {};
  const tokens = (concept && concept.tokens) || {};
  const findings = [];
  const lost = {};
  for (const key of Object.keys(CATEGORY_WEIGHTS)) lost[key] = 0;

  /** Record a deduction. Points are capped by the category's weight later. */
  const deduct = (category, points, severity, message, fix) => {
    lost[category] += points;
    findings.push({ category, points, severity, message, fix });
  };

  const services = Array.isArray(g.services) ? g.services : [];
  const faqs = Array.isArray(g.faqs) ? g.faqs : [];
  const reviews = Array.isArray(g.reviews) ? g.reviews : [];
  const hours = Array.isArray(g.hours) ? g.hours : [];
  const menu = Array.isArray(g.menu) ? g.menu : [];
  const labels = g.labels || {};
  const photos = Array.isArray(i.photos) ? i.photos : [];

  /* --- 1. content integrity: is the copy real, specific and complete? --- */
  const copyFields = { tagline: g.tagline, heroSub: g.heroSub, about1: g.about1, about2: g.about2 };
  for (const [field, value] of Object.entries(copyFields)) {
    if (BLANK(value)) deduct("contentIntegrity", 4, "critical", `Hero copy is missing: ${field}.`, `Regenerate the site, or write ${field} by hand before delivery.`);
    else if (PLACEHOLDER.test(String(value))) deduct("contentIntegrity", 4, "critical", `${field} still contains placeholder text.`, `Replace the placeholder in ${field} with real copy about the business.`);
  }
  const namedServices = services.filter((s) => !BLANK(s && s.name));
  const describedServices = namedServices.filter((s) => !BLANK(s && s.desc));
  if (!services.length) deduct("contentIntegrity", 8, "critical", "The site lists no services or offerings.", "Add at least four services — this is the page visitors scan first.");
  else if (namedServices.length < services.length) deduct("contentIntegrity", 4, "major", `${services.length - namedServices.length} of ${services.length} services have no name.`, "Name every service, or remove the empty entries.");
  if (namedServices.length && describedServices.length < namedServices.length) {
    deduct("contentIntegrity", 3, "major", `${namedServices.length - describedServices.length} services have no description.`, "Give every service one concrete sentence — what it is and who it is for.");
  }
  if (!hours.length) deduct("contentIntegrity", 2, "minor", "No opening hours are published.", "Add opening hours; visitors and local search both look for them.");
  // Fabricated social proof is the failure mode the generator is explicitly
  // instructed to avoid, so it is graded as an integrity breach, not a nicety.
  const unattributed = reviews.filter((r) => BLANK(r && r.author));
  const generic = reviews.filter((r) => GENERIC_REVIEW.test(String((r && r.quote) || "")));
  if (unattributed.length) deduct("contentIntegrity", 6, "critical", `${unattributed.length} testimonial(s) have no attributed author.`, "Remove unattributed testimonials, or add the real reviewer's name.");
  if (generic.length) deduct("contentIntegrity", 6, "critical", `${generic.length} testimonial(s) match known fabricated-review phrasing.`, "Delete invented testimonials. Publish only reviews the owner supplied.");
  if (reviews.length && !i.hasVerifiedProof) deduct("contentIntegrity", 5, "critical", "Testimonials are shown but no verified source was provided.", "Paste the real reviews into the source field, or remove the reviews section.");

  /* --- 2. conversion: can a motivated visitor actually act? --- */
  const hasPhone = !BLANK(i.phone);
  const hasEmail = !BLANK(i.email);
  // A site nobody can contact has no conversion value at all, so this empties
  // the category rather than shaving a few points off it.
  if (!hasPhone && !hasEmail) deduct("conversion", 16, "critical", "The site offers no way to make contact.", "Add a phone number or an email address — without one the site cannot convert.");
  else if (!hasPhone) deduct("conversion", 3, "minor", "No phone number is published.", "Add a click-to-call number; most local enquiries start as calls.");
  if (BLANK(labels.heroCta)) deduct("conversion", 5, "major", "The hero has no call-to-action label.", `Set the hero action to something like “${industry.primary || "Get in touch"}”.`);
  if (services.length < 4) deduct("conversion", 6, "major", `Only ${services.length} service(s) are listed.`, "List at least four offerings so visitors can self-qualify.");
  if (faqs.length < 3) deduct("conversion", 5, "major", `Only ${faqs.length} FAQ(s) answered.`, `Answer at least three, starting with: ${(industry.objections || []).slice(0, 3).join(", ") || "cost, process, timing"}.`);

  /* --- 3. industry fit: is this the RIGHT site for this trade? --- */
  // The industry's objections should be visibly answered somewhere in the copy.
  const corpus = [g.tagline, g.heroSub, g.about1, g.about2, ...services.map((s) => `${(s && s.name) || ""} ${(s && s.desc) || ""}`), ...faqs.map((f) => `${(f && f.q) || ""} ${(f && f.a) || ""}`)].join(" ").toLowerCase();
  const objections = industry.objections || [];
  const unanswered = objections.filter((o) => !String(o).toLowerCase().split(/\s+/).some((word) => word.length > 3 && corpus.includes(word)));
  if (objections.length && unanswered.length === objections.length) {
    deduct("industryFit", 8, "major", `None of this industry's buying objections are addressed (${objections.join(", ")}).`, "Add FAQ entries or copy that answer each objection head-on.");
  } else if (unanswered.length) {
    deduct("industryFit", 3 * unanswered.length, "minor", `Unaddressed objection(s): ${unanswered.join(", ")}.`, "Answer each in the FAQ — these are the reasons visitors leave without acting.");
  }
  if (MENU_REQUIRED.has(i.vertical) && !menu.length) {
    deduct("industryFit", 8, "critical", `A ${i.vertical} site without a priced menu or product list is incomplete.`, "Add the real items with prices; this is the page this industry's visitors come for.");
  }
  if (!MENU_REQUIRED.has(i.vertical) && menu.length) {
    deduct("industryFit", 2, "minor", "A product/menu list was generated for a service business.", "Remove the menu block, or reclassify the business industry.");
  }

  /* --- 4. design craft: does it read as a premium artefact? --- */
  // The house style renders on near-black. An accent that disappears against it
  // is the single most common way a generated site looks cheap.
  const accent = tokens.accent || tokens.primary || (g.design && (g.design.accent || g.design.primary)) || g.primary;
  const surface = (g.design && g.design.dark) || "#0a0b0e";
  const accentContrast = contrastRatio(accent, surface);
  if (accentContrast === null) {
    deduct("designCraft", 6, "critical", `The accent colour is not a valid hex value (${JSON.stringify(accent || null)}).`, "Set a valid #rrggbb accent colour.");
  } else if (accentContrast < 3) {
    deduct("designCraft", 6, "critical", `The accent ${accent} nearly vanishes on ${surface} (contrast ${accentContrast.toFixed(1)}:1).`, "Pick a saturated accent that glows on near-black — aim for 4.5:1 or better.");
  } else if (accentContrast < 4.5) {
    deduct("designCraft", 3, "major", `The accent ${accent} is dim on ${surface} (contrast ${accentContrast.toFixed(1)}:1).`, "Brighten the accent to clear 4.5:1 so headings and links stay legible.");
  }
  if (BLANK(tokens.headingFont) || BLANK(tokens.bodyFont)) {
    deduct("designCraft", 4, "major", "The concept has no resolved font pairing.", "Choose a heading and body font from the approved sets.");
  } else if (tokens.headingFont === tokens.bodyFont) {
    deduct("designCraft", 2, "minor", `Heading and body are both ${tokens.headingFont}.`, "Pair a display face with a distinct text face for editorial contrast.");
  }
  if (!Array.isArray(tokens.spacing) || tokens.spacing.length < 7) deduct("designCraft", 2, "minor", "The spacing scale is incomplete.", "Restore the full spacing scale so rhythm stays consistent.");

  /* --- 5. accessibility: WCAG AA, computed rather than asserted --- */
  const bodyText = tokens.neutral && tokens.neutral[3] ? tokens.neutral[3] : "#e8eef7";
  const bodyContrast = contrastRatio(bodyText, surface);
  if (bodyContrast !== null && bodyContrast < 4.5) {
    deduct("accessibility", 6, "critical", `Body text ${bodyText} on ${surface} is ${bodyContrast.toFixed(1)}:1 — below the 4.5:1 AA minimum.`, "Lighten the body text until it clears 4.5:1.");
  }
  // Text sitting ON an accent-filled button must also pass.
  const ctaContrast = contrastRatio(readableOn(accent), accent);
  if (ctaContrast !== null && ctaContrast < 4.5) {
    deduct("accessibility", 4, "major", `Button text on the accent fill is ${ctaContrast.toFixed(1)}:1 — below AA.`, "Adjust the accent's lightness so black or white text clears 4.5:1 on it.");
  }
  const nav = Array.isArray(labels.nav) ? labels.nav.filter((n) => !BLANK(n)) : [];
  if (nav.length < 3) deduct("accessibility", 3, "major", "The navigation has fewer than three usable labels.", "Provide clear navigation labels; they are the page's primary landmarks.");
  if (photos.length && !i.hasDescribedMedia) deduct("accessibility", 2, "minor", "Gallery images rely on generated alt text.", "Add a short description for each uploaded photo.");

  /* --- 6. media: is the imagery real, or stock filler? --- */
  const hero = i.heroImage || photos[0] || "";
  // Stock imagery is the single clearest tell of a templated site, so it costs
  // the whole media category rather than a token deduction.
  if (BLANK(hero)) deduct("media", 8, "major", "The hero has no image.", "Upload a real photograph of the business, or generate a cinematic hero.");
  else if (PLACEHOLDER_MEDIA.test(String(hero))) deduct("media", 8, "major", "The hero is a stock placeholder, not the real business.", "Replace it with the owner's own photography before delivery.");
  const realPhotos = photos.filter((u) => /^https?:/i.test(String(u)) && !PLACEHOLDER_MEDIA.test(String(u)));
  if (realPhotos.length < 3) deduct("media", 3, "minor", `Only ${realPhotos.length} genuine photo(s) supplied.`, "Collect at least three real photos — generic imagery is what makes a site feel templated.");

  /* --- 7. SEO / local presence --- */
  if (BLANK(i.city) && BLANK(i.address)) deduct("seo", 5, "major", "No location is published.", "Add the city or full address so the business can rank locally.");
  const desc = String(g.heroSub || g.tagline || "");
  if (desc.length > 0 && desc.length < 50) deduct("seo", 2, "minor", `The meta description is only ${desc.length} characters.`, "Aim for 50-160 characters so search results render a full snippet.");
  if (BLANK(i.name)) deduct("seo", 2, "major", "The business has no name set.", "Set the business name — it is the page title and the brand.");

  /* ------------------------------- scoring ------------------------------- */
  const categories = {};
  let total = 0;
  for (const [key, weight] of Object.entries(CATEGORY_WEIGHTS)) {
    // A category floors at zero: one catastrophic area cannot drag the whole
    // score negative and mask problems elsewhere.
    const earned = Math.max(0, weight - lost[key]);
    categories[key] = earned;
    total += earned;
  }
  findings.sort((a, b) => SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity] || b.points - a.points);

  const threshold = 90;
  // Severity outranks arithmetic. A weighted average lets a site hide one
  // catastrophic defect behind six healthy categories — which is precisely how
  // the previous rubric passed everything. So: any critical finding makes a site
  // unshippable at any score, and "flagship" additionally requires that nothing
  // major is outstanding. A stock hero cannot be flagship however well it scores.
  const criticals = findings.filter((f) => f.severity === "critical");
  const majors = findings.filter((f) => f.severity === "major");
  const grade = criticals.length ? "draft"
    : total >= 95 && !majors.length ? "flagship"
    : total >= threshold ? "production"
    : total >= 75 ? "needs work"
    : "draft";
  return {
    total,
    categories,
    findings,
    threshold,
    productionReady: total >= threshold && criticals.length === 0,
    blockingFindings: criticals,
    improvements: findings.map((f) => f.fix),
    grade,
  };
}
