import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const html = readFileSync(new URL("../public/index.html", import.meta.url), "utf8");
const vercel = JSON.parse(readFileSync(new URL("../vercel.json", import.meta.url), "utf8"));

test("landing page has a focused conversion path", () => {
  assert.match(html, /href="\/request\.html\?plan=professional"/);
  assert.match(html, /Get my free website concept/);
  assert.match(html, /No commitment · Clear pricing/);
  assert.match(html, /href="\/pricing\.html"/);
  assert.doesNotMatch(
    html.match(/<header>[\s\S]*?<\/header>/)?.[0] || "",
    /dashboard\.html/,
    "the public header must not advertise the internal team dashboard",
  );
});

test("landing page ships essential SEO and social metadata", () => {
  assert.match(html, /<link rel="canonical" href="https:\/\/www\.frontdeskagents\.com\/">/);
  assert.match(html, /<meta name="description" content="[^"]{80,}">/);
  assert.match(html, /<meta property="og:image:width" content="1640">/);
  assert.match(html, /<meta name="twitter:card" content="summary_large_image">/);

  const jsonLd = html.match(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/);
  assert.ok(jsonLd, "Organization JSON-LD must be present");
  const entity = JSON.parse(jsonLd[1]);
  assert.equal(entity["@type"], "Organization");
  assert.equal(entity.url, "https://www.frontdeskagents.com/");
});

test("landing page keeps the primary experience accessible", () => {
  assert.match(html, /class="skip" href="#main"/);
  assert.match(html, /<main id="main">/);
  assert.match(html, /<nav[^>]+aria-label="Primary"/);
  assert.match(html, /@media\(prefers-reduced-motion:reduce\)/);
  assert.match(html, /aria-label="Request a free website concept"/);
});

test("production headers protect transport and API responses", () => {
  const allHeaders = vercel.headers.flatMap((entry) => entry.headers);
  const header = (key) => allHeaders.find((item) => item.key === key)?.value;
  assert.match(header("Strict-Transport-Security") || "", /includeSubDomains/);
  assert.equal(header("X-Content-Type-Options"), "nosniff");
  assert.equal(header("X-Robots-Tag"), "noindex, nofollow");
  assert.match(header("Cache-Control") || "", /no-store/);
});
