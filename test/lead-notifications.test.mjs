import { test } from "node:test";
import assert from "node:assert/strict";
import { deliverLeadNotifications } from "../lib/lead-notifications.js";

const lead = { id: 42, name: "Test Lead", type: "Roofing", contact: "lead@example.com", plan: "Professional", at: "2026-07-22T03:00:00Z", attribution: { source: "homepage", utm_medium: "paid", utm_campaign: "launch" } };
const emailEnv = { RESEND_API_KEY: "re_test", NOTIFY_EMAIL: "owner@example.com", OUTREACH_FROM: "alerts@example.com" };
const quiet = () => {};

test("successful email notification includes full lead context", async () => {
  let request;
  const result = await deliverLeadNotifications(lead, { env: emailEnv, fetchFn: async (url, opts) => { request = { url, opts }; return { ok: true, status: 200 }; }, sleepFn: async () => {}, logger: quiet });
  assert.equal(result.state, "sent");
  assert.equal(result.channels.email.status, "sent");
  const body = JSON.parse(request.opts.body);
  assert.equal(request.opts.headers["user-agent"], "frontdeskagents-lead-notifier/1.0");
  assert.match(body.text, /Test Lead/);
  assert.match(body.text, /Professional/);
  assert.match(body.text, /homepage/);
  assert.match(body.text, /paid/);
  assert.match(body.text, /launch/);
  assert.match(body.text, /dashboard\.html#inbox/);
});

test("missing credentials are visible as skipped", async () => {
  const result = await deliverLeadNotifications(lead, { env: {}, fetchFn: async () => { throw new Error("should not call"); }, logger: quiet });
  assert.equal(result.state, "skipped");
  assert.equal(result.channels.email.status, "skipped");
  assert.equal(result.channels.telegram.status, "skipped");
  assert.equal(result.channels.sms.status, "skipped");
});

test("temporary provider failures retry and recover", async () => {
  let calls = 0;
  const result = await deliverLeadNotifications(lead, { env: emailEnv, fetchFn: async () => { calls++; return { ok: calls === 3, status: calls === 3 ? 200 : 503 }; }, sleepFn: async () => {}, logger: quiet });
  assert.equal(calls, 3);
  assert.equal(result.state, "sent");
  assert.equal(result.channels.email.attempts, 3);
});

test("permanent provider failure is recorded without throwing", async () => {
  const result = await deliverLeadNotifications(lead, { env: emailEnv, fetchFn: async () => ({ ok: false, status: 400, json: async () => ({ name: "validation_error" }) }), sleepFn: async () => {}, logger: quiet });
  assert.equal(result.state, "failed");
  assert.equal(result.channels.email.status, "failed");
  assert.equal(result.channels.email.attempts, 1);
  assert.equal(result.channels.email.error, "provider_http_400_validation_error");
});

test("network failure retries and returns failed status", async () => {
  let calls = 0;
  const result = await deliverLeadNotifications(lead, { env: emailEnv, fetchFn: async () => { calls++; throw new Error("timeout"); }, sleepFn: async () => {}, logger: quiet });
  assert.equal(calls, 3);
  assert.equal(result.state, "failed");
  assert.equal(result.channels.email.error, "network_error");
});
