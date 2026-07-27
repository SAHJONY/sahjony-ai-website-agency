import { test } from "node:test";
import assert from "node:assert/strict";
import { auditSite, contrastRatio, relativeLuminance, parseHex, readableOn, CATEGORY_WEIGHTS } from "../public/quality-engine.js";
import { INDUSTRY_INTELLIGENCE } from "../public/premium-factory.js";

/* A site that genuinely deserves to ship, used as the baseline every variant
   below degrades from — so each test measures ONE defect's cost. */
const site = {
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
  hours: [{ day: "Mon – Fri", time: "7:00 – 18:00" }],
  design: { headingFont: "Fraunces", bodyFont: "Inter", primary: "#2dd4bf", accent: "#2dd4bf", dark: "#0a0b0e" },
  labels: { nav: ["Home", "About", "Services", "Contact"], heroCta: "Request an estimate" },
};
const biz = {
  name: "Northstar Roofing", industry: "roofing contractor", vertical: "home-services", city: "Chicago",
  phone: "+1 312 555 0142", email: "hello@northstarroofing.com", address: "1420 W Fulton St",
  hasVerifiedProof: true, hasDescribedMedia: true,
  heroImage: "https://cdn.northstarroofing.com/hero.jpg",
  photos: ["https://cdn.northstarroofing.com/1.jpg", "https://cdn.northstarroofing.com/2.jpg", "https://cdn.northstarroofing.com/3.jpg"],
};
const concept = {
  id: "conversion",
  tokens: { primary: "#2dd4bf", accent: "#2dd4bf", neutral: ["#04080f", "#0d1a2d", "#9fb3c9", "#e8eef7"], headingFont: "Fraunces", bodyFont: "Inter", spacing: [4, 8, 12, 16, 24, 32, 48, 72, 112] },
};
const intel = INDUSTRY_INTELLIGENCE["home-services"];
const audit = (g = {}, b = {}, c = {}) => auditSite({ ...site, ...g }, { ...biz, ...b }, intel, { ...concept, ...c });

/* ------------------------------ colour science ------------------------------ */

test("WCAG contrast matches the published reference values", () => {
  // Black on white is the canonical 21:1; identical colours are always 1:1.
  assert.equal(Math.round(contrastRatio("#000000", "#ffffff")), 21);
  assert.equal(contrastRatio("#2dd4bf", "#2dd4bf"), 1);
  // Relative luminance endpoints from the WCAG 2.1 definition.
  assert.equal(relativeLuminance("#000000"), 0);
  assert.equal(relativeLuminance("#ffffff"), 1);
  // #767676 on white is the classic "exactly AA for body text" grey.
  assert.ok(Math.abs(contrastRatio("#767676", "#ffffff") - 4.54) < 0.05);
});

test("colour parsing handles shorthand and rejects junk", () => {
  assert.deepEqual(parseHex("#fff"), [255, 255, 255]);
  assert.deepEqual(parseHex("2dd4bf"), [45, 212, 191]);
  for (const bad of ["", null, undefined, "teal", "#12345", "#gggggg"]) assert.equal(parseHex(bad), null, `${bad} is not a colour`);
  assert.equal(contrastRatio("not-a-colour", "#000"), null);
});

test("readable text colour is chosen by measured contrast", () => {
  assert.equal(readableOn("#ffffff"), "#000000");
  assert.equal(readableOn("#000000"), "#ffffff");
  assert.equal(readableOn("#2dd4bf"), "#000000", "black is readable on a bright cyan fill");
});

/* --------------------------------- scoring --------------------------------- */

test("category weights sum to exactly 100", () => {
  assert.equal(Object.values(CATEGORY_WEIGHTS).reduce((a, b) => a + b, 0), 100);
});

test("a genuinely good site scores full marks with no findings", () => {
  const r = audit();
  assert.equal(r.total, 100);
  assert.equal(r.grade, "flagship");
  assert.equal(r.productionReady, true);
  assert.deepEqual(r.findings, []);
});

test("the score is the sum of its categories, and no category goes negative", () => {
  // Strip the site to nothing: several categories are deducted past their weight.
  const r = auditSite({}, {}, intel, {});
  assert.equal(Object.values(r.categories).reduce((a, b) => a + b, 0), r.total);
  for (const [key, earned] of Object.entries(r.categories)) {
    assert.ok(earned >= 0, `${key} floored below zero`);
    assert.ok(earned <= CATEGORY_WEIGHTS[key], `${key} earned more than its weight`);
  }
});

test("an empty shell scores far below a real site", () => {
  // The regression that motivated this engine: the old rubric gave this 97/100.
  const shell = auditSite({ services: [{}, {}, {}, {}, {}, {}], faqs: [{}, {}, {}] }, { name: "X", industry: "roofing" }, intel, concept);
  assert.ok(shell.total < 60, `an empty shell must not look deliverable (got ${shell.total})`);
  assert.equal(shell.productionReady, false);
  assert.ok(audit().total - shell.total > 40, "the engine must separate real work from filler");
});

/* ------------------------------ what it catches ------------------------------ */

test("fabricated and unattributed testimonials are critical", () => {
  const invented = audit({ reviews: [{ quote: "Best roofer in town. Highly recommend!", author: "Maria G." }] });
  assert.ok(invented.blockingFindings.some((f) => /fabricated-review/i.test(f.message)));
  assert.equal(invented.productionReady, false);

  const anonymous = audit({ reviews: [{ quote: "They handled the insurance claim end to end.", author: "" }] });
  assert.ok(anonymous.blockingFindings.some((f) => /no attributed author/i.test(f.message)));

  const unsourced = audit({}, { hasVerifiedProof: false });
  assert.ok(unsourced.blockingFindings.some((f) => /no verified source/i.test(f.message)));
});

test("an accent that vanishes on near-black is caught by measurement", () => {
  const dim = audit({}, {}, { tokens: { ...concept.tokens, accent: "#1b2430", primary: "#1b2430" } });
  const finding = dim.findings.find((f) => /accent/i.test(f.message));
  assert.ok(finding, "a 1.3:1 accent must be reported");
  assert.equal(finding.severity, "critical");
  assert.match(finding.message, /contrast \d+\.\d:1/, "the finding states the measured ratio");
  // A bright accent on the same background passes.
  assert.ok(!audit().findings.some((f) => /accent/i.test(f.message)));
});

test("body text below AA is caught even when the accent is fine", () => {
  const faint = audit({}, {}, { tokens: { ...concept.tokens, neutral: ["#04080f", "#0d1a2d", "#9fb3c9", "#2a2f38"] } });
  assert.ok(faint.blockingFindings.some((f) => /Body text/i.test(f.message)));
});

test("a site with no way to make contact cannot ship at any score", () => {
  const r = audit({}, { phone: "", email: "" });
  assert.equal(r.productionReady, false);
  assert.equal(r.grade, "draft");
  assert.equal(r.categories.conversion, 4, "conversion is gutted, not nicked");
  assert.ok(r.blockingFindings.some((f) => /no way to make contact/i.test(f.message)));
});

test("placeholder copy and stock imagery are detected", () => {
  assert.ok(audit({ about1: "Lorem ipsum dolor sit amet." }).blockingFindings.some((f) => /placeholder text/i.test(f.message)));
  const stock = audit({}, { heroImage: "https://loremflickr.com/1600/900/roof" });
  assert.ok(stock.findings.some((f) => /stock placeholder/i.test(f.message)));
  assert.notEqual(stock.grade, "flagship", "a stock hero can never be flagship work");
});

test("industry rules fire: a restaurant needs a priced menu", () => {
  const restaurant = auditSite(site, { ...biz, vertical: "restaurant" }, INDUSTRY_INTELLIGENCE.restaurant, concept);
  assert.ok(restaurant.blockingFindings.some((f) => /priced menu/i.test(f.message)));
  // ...and a service business should not have had one generated.
  assert.ok(audit({ menu: [{ name: "Pizza", price: "$12" }] }).findings.some((f) => /service business/i.test(f.message)));
});

test("unanswered industry objections are reported by name", () => {
  const silent = audit({ faqs: [{ q: "Where are you?", a: "Chicago." }], about1: "We do roofs.", about2: "Call us.", heroSub: "Roofing.", tagline: "Roofs" });
  const finding = silent.findings.find((f) => /objection/i.test(f.message));
  assert.ok(finding, "objections the copy never addresses must be surfaced");
});

/* ------------------------------ grading contract ------------------------------ */

test("severity outranks arithmetic in the grade", () => {
  // The failure mode of a plain weighted average: one catastrophic defect hides
  // behind healthy categories. A critical must force "draft" however high the sum.
  const critical = audit({ about1: "Lorem ipsum dolor sit amet." });
  assert.ok(critical.total > 90, "score stays high because only one field broke");
  assert.equal(critical.grade, "draft");
  assert.equal(critical.productionReady, false);
  // A major defect permits delivery but forfeits the top grade.
  const major = audit({ services: site.services.slice(0, 2) });
  assert.equal(major.productionReady, true);
  assert.notEqual(major.grade, "flagship");
});

test("every finding carries a severity and an actionable fix", () => {
  const r = auditSite({}, {}, intel, {});
  assert.ok(r.findings.length > 5);
  for (const f of r.findings) {
    assert.ok(["critical", "major", "minor"].includes(f.severity), `bad severity: ${f.severity}`);
    assert.ok(f.message && f.message.length > 10, "a finding must say what is wrong");
    assert.ok(f.fix && f.fix.length > 10, `no remedy given for: ${f.message}`);
    assert.ok(Object.keys(CATEGORY_WEIGHTS).includes(f.category));
  }
  // Findings are ordered worst-first so the owner reads the blocker, not the nit.
  const severities = r.findings.map((f) => ["critical", "major", "minor"].indexOf(f.severity));
  assert.deepEqual(severities, severities.slice().sort((a, b) => a - b));
});

/* ------------------- design system: palettes cannot fail the audit ------------------- */

test("every generated palette clears AA on its surface, for any brand colour", async () => {
  const { createPalette, hslToHex } = await import("../public/design-system.js");
  // Sweep the failure zone the old RGB-delta maths produced: dark, desaturated
  // brand colours across the hue circle. #1b2430 used to yield a 1.9:1 accent.
  let worst = { ratio: Infinity, seed: "", key: "" };
  for (let h = 0; h < 360; h += 15) {
    for (const l of [3, 8, 14, 22, 50, 88]) {
      for (const s of [8, 45, 90]) {
        const seed = hslToHex(h, s, l);
        const p = createPalette(seed);
        for (const key of ["primary", "secondary", "tertiary", "text", "textMuted"]) {
          const ratio = contrastRatio(p[key], p.surface);
          if (ratio < worst.ratio) worst = { ratio, seed, key };
        }
      }
    }
  }
  assert.ok(worst.ratio >= 4.5, `${worst.seed} produced ${worst.key} at ${worst.ratio.toFixed(2)}:1 — below AA`);
});

test("hue rotation rotates hue instead of mangling channels", async () => {
  const { rotate, hexToHsl } = await import("../public/design-system.js");
  const base = "#2dd4bf";
  const spun = rotate(base, 120);
  const a = hexToHsl(base);
  const b = hexToHsl(spun);
  assert.ok(Math.abs(((b.h - a.h + 360) % 360) - 120) < 1, "hue moved by the requested amount");
  assert.ok(Math.abs(b.s - a.s) < 1, "saturation is preserved");
  assert.ok(Math.abs(b.l - a.l) < 1, "lightness is preserved");
});

test("the three archetypes are genuinely different layout systems", async () => {
  const { buildTokens, archetypeCss, ARCHETYPES } = await import("../public/design-system.js");
  const ids = Object.keys(ARCHETYPES);
  assert.equal(ids.length, 3);
  const built = ids.map((id) => buildTokens("#2dd4bf", id));
  // Differing on more than decoration: CTA placement, scroll behaviour, type
  // ratio and section height all vary — that is what makes them distinct designs.
  assert.equal(new Set(built.map((t) => t.layout.ctaPlacement)).size, 2);
  assert.equal(new Set(built.map((t) => t.type[7].px)).size, 3, "display sizes differ by type ratio");
  assert.equal(built.filter((t) => t.layout.scrollSnap).length, 1, "only the Tesla archetype snaps");
  assert.equal(new Set(built.map((t) => t.headingFont)).size, 3);
  for (const t of built) assert.ok(archetypeCss(t).length > 1000, `${t.archetype} must emit a real stylesheet`);
});
