import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { assessProduct, DELIVERY_READY_SCORE } from "../public/product-quality.js";
import { normalizeDelivery } from "../api/sites.js";

const complete = {
  name: "Northline Studio",
  type: "design agency",
  city: "Chicago, IL",
  phone: "+1 312 555 0101",
  factsConfirmed: true,
  usedFallback: false,
  media: { photos: ["https://cdn.example.com/hero.webp", "https://cdn.example.com/team.webp", "https://cdn.example.com/work.webp"] },
  content: {
    tagline: "Strategy made visible.",
    heroSub: "Premium brand strategy and digital experiences for ambitious local companies.",
    about1: "We turn clear strategy into memorable customer experiences.",
    about2: "Every decision is built around trust, clarity, and measurable growth.",
    services: [
      { name: "Brand strategy", desc: "Positioning built around customer demand." },
      { name: "Web design", desc: "Conversion-focused digital product design." },
      { name: "Launch support", desc: "A disciplined path from approval to live." },
    ],
    faqs: [{}, {}, {}],
    reviews: [{ quote: "Verified review" }],
    hours: [{ day: "Monday", time: "9–5" }],
    labels: { nav: ["Home", "About", "Services", "Work", "Contact"] },
  },
};

test("complete products pass the FrontDeskOS delivery standard", () => {
  const result = assessProduct(complete);
  assert.equal(result.ready, true);
  assert.ok(result.score >= DELIVERY_READY_SCORE);
  assert.deepEqual(result.blockers, []);
});

test("starter fallback content can never be delivered", () => {
  const result = assessProduct({ ...complete, usedFallback: true });
  assert.equal(result.ready, false);
  assert.ok(result.blockers.some((item) => item.id === "original"));
});

test("unverified facts, missing contact, and missing media block delivery", () => {
  const result = assessProduct({
    ...complete,
    factsConfirmed: false,
    phone: "",
    email: "",
    media: { photos: [] },
  });
  assert.equal(result.ready, false);
  assert.deepEqual(result.blockers.map((item) => item.id).sort(), ["contact", "facts", "media"]);
});

test("missing reviews and hours are honest advisories, not fake-content prompts", () => {
  const result = assessProduct({
    ...complete,
    content: { ...complete.content, reviews: [], hours: [] },
  });
  assert.equal(result.ready, true);
  assert.ok(result.advisories.some((item) => /verified customer reviews/i.test(item)));
  assert.ok(result.advisories.some((item) => /confirmed business hours/i.test(item)));
});

test("the publish API accepts only approved delivery records at 90 or higher", () => {
  assert.equal(normalizeDelivery({ approved: true, score: 100 }).ready, true);
  assert.equal(normalizeDelivery({ approved: true, score: 89 }).ready, false);
  assert.equal(normalizeDelivery({ approved: false, score: 100 }).ready, false);
  assert.equal(normalizeDelivery(null).ready, false);
});

test("the builder enforces truthful content and loads the delivery gate", () => {
  const builder = readFileSync(new URL("../public/builder.html", import.meta.url), "utf8");
  assert.match(builder, /TRUTH STANDARD: NEVER invent testimonials/);
  assert.match(builder, /type="module" src="\/product-quality\.js"/);
  assert.match(builder, /Complete QA to publish/);
  assert.doesNotMatch(builder, /Maria G\.|James T\.|Dana R\./);
  assert.doesNotMatch(builder, />Claude Fable 5</);
  assert.doesNotMatch(builder, />Claude Opus 4\.8</);
});
