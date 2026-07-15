import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { VERTICAL_ORDER } from "../public/verticals.js";
import {
  OWNER_EXPERIENCES,
  getOwnerExperience,
  ownerModuleSummaries,
  ownerReadiness,
} from "../public/owner-dashboard.js";

test("every supported industry has a complete owner-console experience", () => {
  for (const id of VERTICAL_ORDER) {
    assert.ok(OWNER_EXPERIENCES[id], `${id}: missing owner experience`);
    const experience = getOwnerExperience(id);
    assert.equal(experience.id, id);
    assert.ok(experience.title && experience.operationsLabel && experience.leadsLabel);
    assert.ok(experience.modules.some((module) => module.id === experience.primaryModule), `${id}: primary module is invalid`);
    assert.match(experience.accent, /^#[0-9a-f]{6}$/i);
  }
});

test("real-world business descriptions receive different command centers", () => {
  assert.equal(getOwnerExperience("dental clinic").title, "Practice Command Center");
  assert.equal(getOwnerExperience("roofing contractor").title, "Field Service Command Center");
  assert.equal(getOwnerExperience("boutique hotel").operationsLabel, "Rooms & Guests");
  assert.equal(getOwnerExperience("freight trucking").primaryModule, "dispatch");
  assert.equal(getOwnerExperience("clothing boutique").commerce, true);
  assert.equal(getOwnerExperience("personal injury law firm").commerce, false);
});

test("module summaries calculate industry KPIs from private operating data", () => {
  const experience = getOwnerExperience("restaurant");
  const summaries = ownerModuleSummaries(experience, {
    modules: {
      reservations: [
        { party: "Lee", size: 4, status: "Booked" },
        { party: "Garcia", size: 2, status: "Seated" },
      ],
      tickets: [{ table: "4", total: 82, status: "Open" }],
    },
  });
  const reservations = summaries.find((item) => item.id === "reservations");
  const tickets = summaries.find((item) => item.id === "tickets");
  assert.equal(reservations.records, 2);
  assert.equal(reservations.metricLabel, "Reservations");
  assert.equal(reservations.metricValue, 2);
  assert.equal(tickets.metricValue, 1);
});

test("owner readiness makes incomplete setup visible and rewards a complete workspace", () => {
  const incomplete = ownerReadiness({ site: { status: "active", ava: true } });
  assert.equal(incomplete.score, 40);
  assert.equal(incomplete.ready, false);

  const complete = ownerReadiness({
    site: { status: "active", ava: true, delivery: { ready: true } },
    ava: { services: "Consultations", hours: "Mon–Fri", address: "100 Main St" },
    ops: { modules: { appointments: [{ customer: "A" }] } },
  });
  assert.equal(complete.score, 100);
  assert.equal(complete.ready, true);
});

test("the business portal mounts the proprietary industry command center", () => {
  const html = readFileSync(new URL("../public/business.html", import.meta.url), "utf8");
  assert.match(html, /FrontDeskOS™ Owner Console/);
  assert.match(html, /id="ownerTitle"/);
  assert.match(html, /id="ownerModules"/);
  assert.match(html, /id="ownerReadyBar"/);
  assert.match(html, /from "\/owner-dashboard\.js"/);
  assert.match(html, /storeTab\.style\.display=OWNERX\.commerce/);
});

