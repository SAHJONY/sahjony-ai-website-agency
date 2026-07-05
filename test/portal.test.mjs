// Zero-dependency tests (Node 22 built-in runner: `node --test`).
// Guards the data-driven per-industry system so future edits to the registry
// or the classifier can't silently break the owner back-office / customer portal.
import { test } from "node:test";
import assert from "node:assert/strict";
import { VERTICALS, VERTICAL_ORDER, REQUESTS_MODULE_ID, getVertical, inferVertical } from "../public/verticals.js";
import { composeRequestDetail, custUserKey } from "../api/site.js";

const KPI_AGGS = new Set(["count", "countStatus", "sum", "sumProduct"]);

test("every vertical is structurally sound", () => {
  for (const id of VERTICAL_ORDER) {
    const v = getVertical(id);
    assert.ok(v, `missing vertical ${id}`);
    assert.equal(v.id, id, `id mismatch for ${id}`);
    assert.ok(v.accent && /^#/.test(v.accent), `${id}: bad accent`);
    assert.ok(Array.isArray(v.modules) && v.modules.length, `${id}: no modules`);

    for (const m of v.modules) {
      assert.ok(m.id, `${id}: module missing id`);
      assert.ok(Array.isArray(m.columns) && m.columns.length, `${id}/${m.id}: no columns`);
      // select columns must declare options
      for (const c of m.columns) {
        if (c.type === "select") {
          assert.ok(m.options && Array.isArray(m.options[c.key]) && m.options[c.key].length,
            `${id}/${m.id}: select column "${c.key}" has no options`);
        }
      }
      for (const k of (m.kpis || [])) {
        assert.ok(KPI_AGGS.has(k.agg), `${id}/${m.id}: unknown KPI agg "${k.agg}"`);
        if (k.agg === "countStatus") {
          assert.ok(m.statusField, `${id}/${m.id}: countStatus needs a statusField`);
          if (m.statuses) assert.ok(m.statuses.includes(k.value), `${id}/${m.id}: countStatus value "${k.value}" not in statuses`);
        }
        if (k.agg === "sum") assert.ok(k.field, `${id}/${m.id}: sum needs field`);
        if (k.agg === "sumProduct") assert.ok(k.field && k.field2, `${id}/${m.id}: sumProduct needs field + field2`);
      }
    }
  }
});

test("every vertical has exactly one customer-writable Requests module", () => {
  for (const id of VERTICAL_ORDER) {
    const v = getVertical(id);
    const writable = v.modules.filter((m) => m.customerWritable);
    assert.equal(writable.length, 1, `${id}: expected exactly 1 customerWritable module, got ${writable.length}`);
    assert.equal(writable[0].id, REQUESTS_MODULE_ID, `${id}: writable module must be "${REQUESTS_MODULE_ID}"`);
  }
});

test("every vertical has a customer portal with valid fields", () => {
  for (const id of VERTICAL_ORDER) {
    const p = getVertical(id).portal;
    assert.ok(p && p.cta && Array.isArray(p.fields) && p.fields.length, `${id}: incomplete portal`);
    assert.ok(p.fields.some((f) => f.required), `${id}: portal has no required field`);
    for (const f of p.fields) {
      assert.ok(f.key && f.label && f.type, `${id}: portal field missing key/label/type`);
      if (f.type === "select") assert.ok(Array.isArray(f.options) && f.options.length, `${id}: portal select "${f.key}" has no options`);
    }
  }
});

test("inferVertical routes real-world business descriptions correctly", () => {
  const cases = [
    ["real estate broker", "real-estate"], ["dental clinic", "medical"], ["med spa", "medical"],
    ["personal injury law firm", "legal"], ["cpa accounting", "legal"], ["freight trucking", "logistics"],
    ["barber shop", "salon"], ["day spa", "salon"], ["wine bar", "restaurant"], ["taco truck", "restaurant"],
    ["crossfit gym", "fitness"], ["roofing contractor", "home-services"], ["auto repair mechanic", "home-services"],
    ["used car dealership", "retail"], ["clothing boutique", "retail"], ["flower shop", "retail"],
    ["boutique hotel", "hotel"], ["bed and breakfast", "hotel"], ["mountain resort", "hotel"],
    ["wedding venue", "events"], ["banquet hall", "events"], ["wedding photographer", "events"],
    ["", "general"], ["something unrecognizable", "general"],
    // substring-misroute regressions (found in review):
    ["lawn care service", "home-services"], ["lawn mowing", "home-services"],
    ["delivery service", "logistics"], ["courier delivery", "logistics"],
    ["marketing agency", "general"], ["digital advertising", "general"],
    ["pet food store", "retail"], ["health food store", "retail"], ["grocery store", "retail"],
    ["counseling center", "medical"], ["marriage counseling", "medical"],
    ["it consulting", "general"], ["business consultant", "general"],
    ["law firm", "legal"], ["law office", "legal"],
  ];
  for (const [input, expected] of cases) {
    assert.equal(inferVertical(input), expected, `"${input}" should route to ${expected}`);
  }
});

test("composeRequestDetail builds a line from the vertical's portal fields", () => {
  const restaurant = getVertical("restaurant").portal;
  const detail = composeRequestDetail(restaurant, { size: 4, time: "2026-07-12 19:30", notes: "anniversary" });
  assert.match(detail, /Party size: 4/);
  assert.match(detail, /Date & time: 2026-07-12 19:30/);
  assert.match(detail, /anniversary/);
  assert.ok(detail.includes(" · "), "fields should be joined with a separator");
});

test("composeRequestDetail drops empty and non-finite values, and returns '' when nothing is filled", () => {
  const hotel = getVertical("hotel").portal;
  assert.equal(composeRequestDetail(hotel, {}), "");
  assert.equal(composeRequestDetail(hotel, { nights: "not-a-number" }), "", "non-finite num is dropped");
  const detail = composeRequestDetail(hotel, { roomType: "Suite", nights: 3, guests: "" });
  assert.match(detail, /Room type: Suite/);
  assert.match(detail, /Nights: 3/);
  assert.doesNotMatch(detail, /Guests/, "empty field should be omitted");
});

test("composeRequestDetail strips the '(optional)' hint from field labels", () => {
  const salon = getVertical("salon").portal; // has "Preferred stylist (optional)"
  const detail = composeRequestDetail(salon, { stylist: "Ana" });
  assert.match(detail, /Preferred stylist: Ana/);
  assert.doesNotMatch(detail, /optional/i);
});

test("composeRequestDetail caps output at 400 chars (matches the ops-save field cap)", () => {
  const g = getVertical("general").portal; // subject + notes(textarea)
  const detail = composeRequestDetail(g, { subject: "x", notes: "y".repeat(5000) });
  assert.ok(detail.length <= 400, `detail length ${detail.length} should be <= 400`);
});

test("custUserKey builds a safe, slug-scoped, per-customer key (no object indexing)", () => {
  // Accounts are stored one-per-Redis-key, so the prototype-chain auth bypass is
  // structurally impossible — there is no object to index with "constructor" etc.
  const k = custUserKey("acme", "Jo.Doe+tag@Email.com");
  assert.match(k, /^fda:portaluser:acme:/, "key is slug-scoped under the portaluser namespace");
  assert.match(k.split(":").pop(), /^[a-z0-9_]+$/, "email fragment is sanitized to safe key chars");
  // Different emails → different keys; same email is stable (idempotent normalization).
  assert.notEqual(custUserKey("acme", "a@x.com"), custUserKey("acme", "b@x.com"));
  assert.equal(custUserKey("acme", "a@x.com"), custUserKey("acme", "A@X.COM"));
  // Built-in property names are just ordinary key fragments, not a lookup on a shared object.
  assert.equal(custUserKey("acme", "constructor"), "fda:portaluser:acme:constructor");
});
