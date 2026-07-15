import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { injectOwnerConsole } from "../api/site.js";

const builder = readFileSync(new URL("../public/builder.html", import.meta.url), "utf8");
const business = readFileSync(new URL("../public/business.html", import.meta.url), "utf8");
const client = readFileSync(new URL("../public/site-owner-console.js", import.meta.url), "utf8");

test("every new generated site contains an embedded owner-console entrance", () => {
  assert.match(builder, /data-fd-owner-entry/);
  assert.match(builder, /site-owner-console\.js/);
  assert.match(builder, /data-slug="__SITE_SLUG__"/);
  assert.match(builder, /Owner Console/);
});

test("legacy hosted sites receive the console loader at serve time", () => {
  const legacy = "<!doctype html><html><body><h1>Legacy Site</h1></body></html>";
  const upgraded = injectOwnerConsole(legacy, {
    slug: "northline-studio",
    name: "Northline Studio",
    origin: "https://example.com/",
  });
  assert.match(upgraded, /src="https:\/\/example\.com\/site-owner-console\.js"/);
  assert.match(upgraded, /data-slug="northline-studio"/);
  assert.match(upgraded, /data-business="Northline Studio"/);
  assert.match(upgraded, /site-owner-console\.js[\s\S]*<\/body>/);
});

test("owner-console injection is idempotent and sanitizes server values", () => {
  const once = injectOwnerConsole("<body></body>", {
    slug: "../Bad SLUG!",
    name: "A & <B>",
    origin: "https://example.com/\"><script>",
  });
  const twice = injectOwnerConsole(once, { slug: "different" });
  assert.equal((twice.match(/site-owner-console\.js/g) || []).length, 1);
  assert.match(once, /data-slug="badslug"/);
  assert.match(once, /data-business="A &amp; &lt;B&gt;"/);
  assert.doesNotMatch(once, /<script><script>/);
});

test("the embedded console remains password-gated and never passes credentials in its URL", () => {
  assert.match(client, /business\.html\?slug=/);
  assert.match(client, /&embed=1/);
  assert.doesNotMatch(client, /password=/i);
  assert.doesNotMatch(client, /bizCode=/i);
  assert.match(client, /event\.origin === origin/);
  assert.match(business, /qs\.get\("embed"\)==="1"/);
});

