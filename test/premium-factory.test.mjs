import { test } from "node:test";
import assert from "node:assert/strict";
import { VERTICAL_ORDER } from "../public/verticals.js";
import { CONCEPTS, INDUSTRY_INTELLIGENCE, createPremiumProject, applyConcept, resolveMarketingIndustry, applyReview, appendRevision, canPublish, canTransition, mergeFactoryProject, selectedConcept, summarizeProject } from "../public/premium-factory.js";

// A genuinely deliverable site. The fixture used to be an empty shell
// (six `{}` services, no contact details) and still scored 97/100, because the
// old rubric graded the order form rather than the site. The quality engine
// audits real output, so the fixture has to BE real output.
const generated = {
  tagline: "Chicago roofs, built to outlast the winter",
  heroSub: "Licensed roofing crews replacing and repairing residential roofs across Chicagoland, with written workmanship warranties on every job.",
  about1: "We have re-roofed more than 900 Chicago homes since 2011, one street at a time.",
  about2: "Our crews are employees, not subcontractors, so the people who quote your roof are the people who build it.",
  services: [
    { name: "Free roof inspection", desc: "A 40-point inspection with photographs of every problem area.", price: "Free" },
    { name: "Full roof replacement", desc: "Tear-off and rebuild with architectural asphalt shingles.", price: "From $9,800" },
    { name: "Storm damage repair", desc: "Emergency tarping within 24 hours, then a permanent repair.", price: "" },
    { name: "Gutter replacement", desc: "Seamless aluminium gutters formed on site to fit your roofline.", price: "" },
    { name: "Flat roof coating", desc: "Silicone coating that extends a flat roof by ten years.", price: "" },
    { name: "Maintenance plan", desc: "Twice-yearly inspection and minor repairs on a fixed fee.", price: "$240/yr" },
  ],
  menu: [],
  reviews: [{ quote: "They found hail damage two other roofers missed and handled the whole insurance claim.", author: "Marcus Delgado" }],
  faqs: [
    { q: "How fast do you respond to a leak?", a: "We tarp emergency leaks within 24 hours, usually the same day." },
    { q: "How clear is your pricing?", a: "You get a fixed written price before work starts; we do not bill extras without approval." },
    { q: "What workmanship guarantee do I get?", a: "Ten years on our workmanship, plus the manufacturer warranty on materials." },
  ],
  hours: [{ day: "Mon – Fri", time: "7:00 – 18:00" }, { day: "Saturday", time: "8:00 – 14:00" }, { day: "Sunday", time: "Closed" }],
  primary: "#2dd4bf",
  design: { headingFont: "Fraunces", bodyFont: "Inter", primary: "#2dd4bf", accent: "#2dd4bf", dark: "#0a0b0e", mood: "confident craft" },
  labels: { nav: ["Home", "About", "Services", "Gallery", "Reviews", "Contact"], heroCta: "Request an estimate", heroCta2: "See our work" },
};
const input = {
  name: "Northstar Roofing", industry: "roofing contractor", city: "Chicago", country: "USA",
  phone: "+1 312 555 0142", email: "hello@northstarroofing.com", address: "1420 W Fulton St",
  hasBrandAssets: true, hasVerifiedProof: true, hasOptimizedMedia: true, hasDescribedMedia: true,
  heroImage: "https://cdn.northstarroofing.com/hero.jpg",
  photos: ["https://cdn.northstarroofing.com/1.jpg", "https://cdn.northstarroofing.com/2.jpg", "https://cdn.northstarroofing.com/3.jpg", "https://cdn.northstarroofing.com/4.jpg"],
};

test("factory always creates three distinct premium concepts", () => {
  const project = createPremiumProject(input, generated);
  assert.equal(project.concepts.length, 3);
  assert.deepEqual(project.concepts.map((c) => c.id), CONCEPTS.map((c) => c.id));
  assert.equal(new Set(project.concepts.map((c) => c.layout)).size, 3);
  assert.equal(new Set(project.concepts.map((c) => c.tokens.headingFont)).size, 3);
});

test("industry intelligence routes priority businesses", () => {
  assert.equal(resolveMarketingIndustry("emergency HVAC contractor"), "home-services");
  assert.equal(resolveMarketingIndustry("dental clinic"), "medical");
  assert.equal(resolveMarketingIndustry("real estate brokerage"), "real-estate");
  assert.equal(resolveMarketingIndustry("French restaurant"), "restaurant");
});

test("quality scoring uses the 100-point contract and threshold", () => {
  const project = createPremiumProject(input, generated);
  for (const concept of project.concepts) {
    assert.equal(Object.values(concept.quality.categories).reduce((a, b) => a + b, 0), concept.quality.total);
    assert.ok(concept.quality.total >= 90);
    assert.equal(concept.quality.productionReady, true);
  }
});

test("testimonials without a verified source block delivery, not just warn", () => {
  const project = createPremiumProject({ ...input, hasVerifiedProof: false }, generated);
  for (const concept of project.concepts) {
    const blocking = concept.quality.blockingFindings.map((f) => f.message).join(" ");
    assert.match(blocking, /no verified source/i);
    assert.equal(concept.quality.productionReady, false, "unverifiable social proof must not ship");
  }
  assert.equal(canPublish(project).allowed, false);
  // Removing the testimonials — rather than inventing a source — clears it.
  const honest = createPremiumProject({ ...input, hasVerifiedProof: false }, { ...generated, reviews: [] });
  assert.equal(canPublish(honest).allowed, true);
});

test("applying a concept preserves generated business content", () => {
  const project = createPremiumProject(input, generated);
  const applied = applyConcept(generated, project, "cinematic");
  assert.equal(applied.services, generated.services);
  assert.equal(applied.__concept.id, "cinematic");
  assert.equal(applied.__factoryProject.selectedConcept, "cinematic");
  assert.equal(applied.design.headingFont, "Syne");
});

/* ---------------------------- approval & revisions ---------------------------- */

// A project below the delivery standard: no brand assets, no proof, no optimised
// media and too little content for the conversion category to score full marks.
const weakInput = { name: "", industry: "", hasBrandAssets: false, hasVerifiedProof: false, hasOptimizedMedia: false };
const weakGenerated = { primary: "#2dd4bf", design: {}, services: [], faqs: [] };

test("a new project starts as a draft with an empty revision trail", () => {
  const project = createPremiumProject(input, generated);
  assert.equal(project.review.state, "draft");
  assert.deepEqual(project.revisions, []);
  assert.equal(project.selectedConcept, project.recommended);
  assert.equal(selectedConcept(project).id, project.recommended);
});

test("review transitions accept real moves and reject no-ops or unknown states", () => {
  assert.equal(canTransition("draft", "in-review"), true);
  assert.equal(canTransition("changes-requested", "approved"), true);
  assert.equal(canTransition("approved", "in-review"), true, "a later edit must be able to re-open review");
  assert.equal(canTransition("draft", "draft"), false);
  assert.equal(canTransition("draft", "published"), false);
});

test("applying a review records state, note and an appended trail entry", () => {
  const project = createPremiumProject(input, generated);
  const reviewed = applyReview(project, { state: "changes-requested", note: "Swap the hero photo", by: "owner" });
  assert.equal(reviewed.review.state, "changes-requested");
  assert.equal(reviewed.review.note, "Swap the hero photo");
  assert.equal(reviewed.revisions.length, 1);
  assert.equal(reviewed.revisions[0].n, 1);
  assert.equal(reviewed.revisions[0].kind, "review");
  assert.equal(reviewed.revisions[0].concept, project.selectedConcept);
  assert.deepEqual(project.revisions, [], "the input project is never mutated");
});

test("an illegal review transition returns the project untouched", () => {
  const project = createPremiumProject(input, generated);
  assert.equal(applyReview(project, { state: "nonsense" }), project);
  assert.equal(applyReview(project, { state: "draft" }), project);
});

test("publishing is blocked while changes are outstanding, and unblocked on approval", () => {
  const project = createPremiumProject(input, generated);
  assert.equal(canPublish(project).allowed, true);
  const blocked = applyReview(project, { state: "changes-requested", note: "Fix the pricing table" });
  const gate = canPublish(blocked);
  assert.equal(gate.allowed, false);
  assert.ok(gate.blockers.some((b) => /Fix the pricing table/.test(b)), "the blocker must name the actual reason");
  assert.equal(canPublish(applyReview(blocked, { state: "approved" })).allowed, true);
});

test("a below-standard project is blocked and told exactly what to fix", () => {
  const project = createPremiumProject(weakInput, weakGenerated);
  const gate = canPublish(project);
  assert.equal(selectedConcept(project).quality.productionReady, false);
  assert.equal(gate.allowed, false);
  assert.ok(gate.blockers.some((b) => /delivery standard/i.test(b)));
  assert.ok(gate.improvements.length >= 3, "every unmet quality input is surfaced as an improvement");
});

test("the revision trail numbers entries in order and is capped", () => {
  let project = createPremiumProject(input, generated);
  for (let i = 0; i < 40; i++) project = { ...project, revisions: appendRevision(project, { kind: "publish", state: "published" }) };
  assert.equal(project.revisions.length, 25, "history is trimmed rather than growing without bound");
  assert.equal(project.revisions[project.revisions.length - 1].n, 40, "numbering keeps counting past the cap");
  assert.ok(project.revisions.every((r, i, a) => i === 0 || r.n > a[i - 1].n));
});

test("summary reports the metrics the owner dashboard renders", () => {
  let project = createPremiumProject(input, generated);
  project = applyReview(project, { state: "approved", note: "Ship it" });
  project = { ...project, revisions: appendRevision(project, { kind: "publish", state: "published", overridden: true }) };
  const summary = summarizeProject(project);
  assert.equal(summary.reviewState, "approved");
  assert.equal(summary.reviewNote, "Ship it");
  assert.equal(summary.revisions, 2);
  assert.equal(summary.publishes, 1);
  assert.equal(summary.overrides, 1);
  assert.equal(summary.productionReady, true);
  assert.equal(summary.conceptLabel, selectedConcept(project).label);
  assert.ok(summary.lastPublishedAt);
});

test("selecting a concept carries the approval trail forward", () => {
  const project = createPremiumProject(input, generated);
  const reviewed = applyReview(project, { state: "in-review", note: "Client is reviewing" });
  const applied = applyConcept(generated, reviewed, "authority");
  assert.equal(applied.__factoryProject.selectedConcept, "authority");
  assert.equal(applied.__factoryProject.review.state, "in-review");
  assert.equal(applied.__factoryProject.revisions.length, 1);
});

test("publish merge keeps the server's approval trail and ignores a forged one", () => {
  // Stored: the client asked for changes, and there is already one entry.
  let stored = createPremiumProject(input, generated);
  stored = applyReview(stored, { state: "changes-requested", note: "Fix the hero" });

  // Incoming: a payload claiming approval and a fabricated history.
  const forged = { ...createPremiumProject(input, generated), review: { state: "approved", note: "self-approved", by: "attacker" }, revisions: [{ n: 99, kind: "publish", state: "published" }] };

  const merged = mergeFactoryProject(stored, forged, "2026-07-27T00:00:00.000Z");
  assert.equal(merged.review.state, "changes-requested", "the stored review state wins");
  assert.equal(merged.review.note, "Fix the hero");
  assert.equal(merged.revisions.length, 2, "the forged history is dropped, the real one is extended");
  assert.equal(merged.revisions[0].note, "Fix the hero");
  assert.equal(merged.revisions[1].kind, "publish");
  assert.equal(merged.revisions[1].at, "2026-07-27T00:00:00.000Z");
  assert.equal(merged.revisions[1].overridden, true, "publishing over an open change request is an override");
  assert.ok(/Fix the hero/.test(merged.revisions[1].note));
});

test("a first publish starts a clean trail and is not flagged as an override", () => {
  const merged = mergeFactoryProject(null, createPremiumProject(input, generated), "2026-07-27T00:00:00.000Z");
  assert.equal(merged.review.state, "draft");
  assert.equal(merged.revisions.length, 1);
  assert.equal(merged.revisions[0].kind, "publish");
  assert.equal(merged.revisions[0].overridden, false);
  assert.equal(summarizeProject(merged).publishes, 1);
});

test("re-publishing without a project payload still extends the stored trail", () => {
  const first = mergeFactoryProject(null, createPremiumProject(input, generated), "2026-07-27T00:00:00.000Z");
  const second = mergeFactoryProject(first, undefined, "2026-07-28T00:00:00.000Z");
  assert.equal(second.revisions.length, 2);
  assert.equal(second.revisions[1].n, 2);
  assert.equal(mergeFactoryProject(null, undefined, "2026-07-27T00:00:00.000Z"), null, "no project either side stays null");
});

/* --------------------- industry coverage (registry invariant) --------------------- */

test("every back-office vertical has tailored marketing intelligence", () => {
  // The guarantee behind "a premium site for each industry": adding a vertical to
  // verticals.js without giving it marketing intelligence fails here rather than
  // silently shipping that industry a generic site.
  const missing = VERTICAL_ORDER.filter((id) => !INDUSTRY_INTELLIGENCE[id]);
  assert.deepEqual(missing, [], `verticals with no marketing intelligence: ${missing.join(", ")}`);
});

test("each industry's intelligence is complete and distinct, not filler", () => {
  const primaries = new Set();
  for (const id of VERTICAL_ORDER) {
    const intel = INDUSTRY_INTELLIGENCE[id];
    assert.ok(intel.primary && intel.secondary, `${id}: needs both calls to action`);
    assert.ok(intel.trust.length >= 4, `${id}: needs at least 4 trust signals`);
    assert.ok(intel.objections.length >= 3, `${id}: needs at least 3 objections`);
    assert.ok(intel.sections.length >= 6, `${id}: needs a real section map`);
    assert.ok(intel.compliance.length >= 1, `${id}: needs a publication check`);
    primaries.add(intel.primary);
  }
  // Industries may legitimately share a call to action (salon and medical both
  // book appointments), but the set must not collapse to a handful of defaults.
  assert.ok(primaries.size >= VERTICAL_ORDER.length - 3, "calls to action are too generic across industries");
});

test("classification delegates to the registry and resists substring traps", () => {
  // The trap that shipped: "bar" matched inside "Barber", so barbershops were
  // sold restaurant sites — reservations, menus and allergen notices.
  assert.equal(resolveMarketingIndustry("Salon / Beauty / Barber"), "salon");
  assert.equal(resolveMarketingIndustry("barber shop"), "salon");
  assert.equal(resolveMarketingIndustry("lawn care service"), "home-services", "'lawn' must not read as 'law'");
  assert.equal(resolveMarketingIndustry("Hotel / Lodging"), "hotel");
  assert.equal(resolveMarketingIndustry("boutique hotel"), "hotel", "lodging must not read as retail");
  assert.equal(resolveMarketingIndustry("we buy houses for cash"), "rei", "investors are not brokerages");
  assert.equal(resolveMarketingIndustry("crossfit gym"), "fitness");
  assert.equal(resolveMarketingIndustry("freight brokerage and trucking"), "logistics");
  assert.equal(resolveMarketingIndustry("wedding venue"), "events");
});

test("an explicit industry pick overrides inference", () => {
  // The owner selected an industry in the builder; the typed description says
  // something else. The deliberate choice must win.
  const project = createPremiumProject({ ...input, vertical: "fitness", industry: "roofing contractor" }, generated);
  assert.equal(project.industryId, "fitness");
  assert.equal(project.intelligence.primary, INDUSTRY_INTELLIGENCE.fitness.primary);
  // An unknown or empty pick falls back to inference rather than breaking.
  assert.equal(createPremiumProject({ ...input, vertical: "not-a-vertical" }, generated).industryId, "home-services");
});

test("industry strategy actually reaches the rendered concepts", () => {
  const project = createPremiumProject({ ...input, vertical: "hotel" }, generated);
  for (const concept of project.concepts) {
    assert.equal(concept.strategy.primary, "Check availability");
    assert.ok(concept.strategy.sections.includes("rooms"));
  }
  assert.equal(summarizeProject(project).industryId, "hotel");
});

test("classifier regression table: real business descriptions route correctly", () => {
  // Each trap below shipped at some point or was one keyword away from doing so.
  // A business misrouted here gets both the wrong website and the wrong dashboard.
  const cases = {
    "home-services": ["home services", "handyman", "roofing contractor", "solar installer", "junk removal", "locksmith", "kitchen remodel", "kitchen and bath", "countertop installer", "bathroom remodel", "snow removal", "tradesman", "lawn care service"],
    restaurant: ["sushi bar", "pizza kitchen", "coffee shop", "taco truck", "sports bar", "ghost kitchen"],
    salon: ["barber shop", "nail salon", "tattoo studio", "hair salon"],
    medical: ["dental clinic", "physical therapy", "veterinary clinic", "med spa"],
    retail: ["textile boutique", "clothing store", "grocery store", "liquor store"],
    legal: ["law firm", "insurance broker", "mortgage broker", "tax service", "bookkeeping"],
    logistics: ["freight broker", "freight brokerage and trucking", "trucking company", "courier service", "customs broker"],
    hotel: ["boutique hotel", "bed and breakfast", "mountain resort"],
    events: ["wedding venue", "banquet hall", "event photographer"],
    fitness: ["crossfit gym", "yoga studio", "personal trainer"],
    rei: ["we buy houses", "hard money lender", "fix and flip"],
    "real-estate": ["real estate broker", "realty group", "property management"],
    creative: ["recording studio", "art gallery", "musician"],
    freelancer: ["freelance copywriter", "business consultant", "web design"],
  };
  const wrong = [];
  for (const [expected, samples] of Object.entries(cases)) {
    for (const sample of samples) {
      const got = resolveMarketingIndustry(sample);
      if (got !== expected) wrong.push(`${JSON.stringify(sample)} -> ${got} (expected ${expected})`);
    }
  }
  assert.deepEqual(wrong, [], `misrouted business descriptions:\n  ${wrong.join("\n  ")}`);
});
