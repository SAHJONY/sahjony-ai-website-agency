import { test } from "node:test";
import assert from "node:assert/strict";
import { CONCEPTS, createPremiumProject, applyConcept, resolveMarketingIndustry } from "../public/premium-factory.js";

const generated = { primary: "#2dd4bf", design: { accent: "#2dd4bf" }, services: [{}, {}, {}, {}, {}, {}], faqs: [{}, {}, {}] };
const input = { name: "Northstar Roofing", industry: "roofing contractor", city: "Chicago", country: "USA", hasBrandAssets: true, hasVerifiedProof: true, hasOptimizedMedia: true };

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

test("missing proof is reported rather than fabricated", () => {
  const project = createPremiumProject({ ...input, hasVerifiedProof: false }, generated);
  assert.ok(project.concepts.every((c) => c.quality.improvements.some((x) => /verified/i.test(x))));
});

test("applying a concept preserves generated business content", () => {
  const project = createPremiumProject(input, generated);
  const applied = applyConcept(generated, project, "cinematic");
  assert.equal(applied.services, generated.services);
  assert.equal(applied.__concept.id, "cinematic");
  assert.equal(applied.__factoryProject.selectedConcept, "cinematic");
  assert.equal(applied.design.headingFont, "Syne");
});
