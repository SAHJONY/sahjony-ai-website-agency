// Storefront price-recompute guard. The buyer sends only {id, qty}; every price,
// availability, and stock limit MUST come from the stored catalog — never from
// the client. These tests lock that in so a future edit can't reintroduce a
// trust-the-client-price bug (which would let a buyer set their own price).
import { test } from "node:test";
import assert from "node:assert/strict";
import { buildStorefrontLines } from "../api/checkout.js";

const CATALOG = [
  { id: "tee", name: "Classic Tee", price: 25, active: true, image: "https://cdn.example.com/tee.png" },
  { id: "mug", name: "Mug", price: 12.5, active: true, trackStock: true, stock: 3 },
  { id: "hidden", name: "Draft", price: 99, active: false },
  { id: "free", name: "Freebie", price: 0, active: true },
  { id: "dataimg", name: "Sticker", price: 4, active: true, image: "data:image/png;base64,AAAA" },
];

test("prices come from the catalog, not the client", () => {
  const { lines, metaItems } = buildStorefrontLines(CATALOG, [{ id: "tee", qty: 2, price: 0.01 }]);
  assert.equal(lines.length, 1);
  assert.equal(lines[0].cents, 2500);       // 25.00, NOT the client's 0.01
  assert.equal(lines[0].qty, 2);
  assert.equal(metaItems[0].price, 25);
});

test("duplicate ids are coalesced into one line", () => {
  const { lines } = buildStorefrontLines(CATALOG, [{ id: "tee", qty: 1 }, { id: "tee", qty: 2 }]);
  assert.equal(lines.length, 1);
  assert.equal(lines[0].qty, 3);
});

test("quantity is clamped to available stock when tracked", () => {
  const { lines } = buildStorefrontLines(CATALOG, [{ id: "mug", qty: 10 }]);
  assert.equal(lines[0].qty, 3);            // only 3 in stock
});

test("inactive, unknown, and zero-price items are dropped", () => {
  const { lines } = buildStorefrontLines(CATALOG, [
    { id: "hidden", qty: 1 }, { id: "nope", qty: 1 }, { id: "free", qty: 1 },
  ]);
  assert.equal(lines.length, 0);
});

test("only http(s) images reach Stripe (data: URLs are stripped)", () => {
  const { lines } = buildStorefrontLines(CATALOG, [{ id: "tee", qty: 1 }, { id: "dataimg", qty: 1 }]);
  const tee = lines.find((l) => l.name === "Classic Tee");
  const sticker = lines.find((l) => l.name === "Sticker");
  assert.equal(tee.image, "https://cdn.example.com/tee.png");
  assert.equal(sticker.image, "");
});

test("empty / malformed carts yield no lines", () => {
  assert.equal(buildStorefrontLines(CATALOG, []).lines.length, 0);
  assert.equal(buildStorefrontLines(CATALOG, null).lines.length, 0);
  assert.equal(buildStorefrontLines(null, [{ id: "tee", qty: 1 }]).lines.length, 0);
  assert.equal(buildStorefrontLines(CATALOG, [{ id: "tee", qty: 0 }]).lines.length, 0);
});
