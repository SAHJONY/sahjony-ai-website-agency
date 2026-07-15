// FrontDeskOS™ Owner Console — industry-specific presentation and health model.
// Operational schemas remain in verticals.js; this layer controls how each
// business owner experiences those schemas in their private command center.
import { VERTICALS, getVertical, inferVertical } from "./verticals.js";

export const OWNER_EXPERIENCES = {
  "real-estate": { title: "Brokerage Command Center", operationsLabel: "Deals & Listings", leadsLabel: "Buyer & Seller Leads", primaryModule: "pipeline", primaryAction: "Open deal pipeline", commerce: false },
  medical: { title: "Practice Command Center", operationsLabel: "Practice Operations", leadsLabel: "Patient Requests", primaryModule: "intake", primaryAction: "Open intake queue", commerce: false },
  legal: { title: "Firm Command Center", operationsLabel: "Matters & Billing", leadsLabel: "Consultation Requests", primaryModule: "cases", primaryAction: "Open case ledger", commerce: false },
  logistics: { title: "Fleet Command Center", operationsLabel: "Dispatch & Fleet", leadsLabel: "Shipment Requests", primaryModule: "dispatch", primaryAction: "Open dispatch board", commerce: false },
  restaurant: { title: "Restaurant Command Center", operationsLabel: "Service Operations", leadsLabel: "Reservations & Guests", primaryModule: "reservations", primaryAction: "Open reservations", commerce: true },
  salon: { title: "Studio Command Center", operationsLabel: "Appointments & Chairs", leadsLabel: "Booking Requests", primaryModule: "appointments", primaryAction: "Open appointments", commerce: false },
  "home-services": { title: "Field Service Command Center", operationsLabel: "Jobs & Estimates", leadsLabel: "Service Requests", primaryModule: "jobs", primaryAction: "Open work orders", commerce: false },
  fitness: { title: "Fitness Command Center", operationsLabel: "Members & Classes", leadsLabel: "Membership Leads", primaryModule: "members", primaryAction: "Open member roster", commerce: false },
  retail: { title: "Retail Command Center", operationsLabel: "Inventory & Orders", leadsLabel: "Customer Inquiries", primaryModule: "products", primaryAction: "Open inventory", commerce: true },
  hotel: { title: "Property Command Center", operationsLabel: "Rooms & Guests", leadsLabel: "Booking Requests", primaryModule: "bookings", primaryAction: "Open reservations", commerce: false },
  events: { title: "Event Command Center", operationsLabel: "Events & Production", leadsLabel: "Event Inquiries", primaryModule: "pipeline", primaryAction: "Open event pipeline", commerce: false },
  freelancer: { title: "Studio Command Center", operationsLabel: "Projects & Billing", leadsLabel: "Project Inquiries", primaryModule: "pipeline", primaryAction: "Open project pipeline", commerce: false },
  creative: { title: "Creator Command Center", operationsLabel: "Bookings & Catalog", leadsLabel: "Bookings & Commissions", primaryModule: "gigs", primaryAction: "Open bookings", commerce: true },
  rei: { title: "Investment Command Center", operationsLabel: "Portfolio Operations", leadsLabel: "Property Inquiries", primaryModule: "deals", primaryAction: "Open deal pipeline", commerce: false },
  general: { title: "Business Command Center", operationsLabel: "Business Operations", leadsLabel: "Leads & Requests", primaryModule: "pipeline", primaryAction: "Open operations", commerce: false },
};

function resolveVertical(typeOrId) {
  const raw = String(typeOrId || "");
  const id = VERTICALS[raw] ? raw : inferVertical(raw);
  return { id, vertical: getVertical(id) };
}

export function getOwnerExperience(typeOrId) {
  const { id, vertical } = resolveVertical(typeOrId);
  const base = OWNER_EXPERIENCES[id] || OWNER_EXPERIENCES.general;
  const modules = vertical.modules || [];
  const primaryExists = modules.some((module) => module.id === base.primaryModule);
  return {
    ...base,
    id,
    label: vertical.label,
    accent: vertical.accent,
    blurb: vertical.blurb,
    primaryModule: primaryExists ? base.primaryModule : (modules[0] && modules[0].id) || "",
    modules,
  };
}

function rowsFor(ops, moduleId) {
  const rows = ops && ops.modules && ops.modules[moduleId];
  return Array.isArray(rows) ? rows : [];
}

function aggregate(module, rows, kpi) {
  if (!kpi || kpi.agg === "count") return rows.length;
  if (kpi.agg === "countStatus") return rows.filter((row) => row && row[module.statusField] === kpi.value).length;
  if (kpi.agg === "sum") return rows.reduce((sum, row) => sum + (Number(row && row[kpi.field]) || 0), 0);
  if (kpi.agg === "sumProduct") {
    return rows.reduce((sum, row) => sum + (Number(row && row[kpi.field]) || 0) * (Number(row && row[kpi.field2]) || 0), 0);
  }
  return rows.length;
}

export function ownerModuleSummaries(experience, ops) {
  return (experience.modules || []).map((module) => {
    const rows = rowsFor(ops, module.id);
    const kpi = (module.kpis || [])[0] || { label: "Records", agg: "count" };
    return {
      id: module.id,
      title: module.title,
      icon: module.icon || "•",
      records: rows.length,
      metricLabel: kpi.label || "Records",
      metricValue: aggregate(module, rows, kpi),
      monetary: kpi.agg === "sum" || kpi.agg === "sumProduct",
    };
  });
}

export function ownerReadiness({ site = {}, ava = {}, ops = {} } = {}) {
  const modules = ops && ops.modules && typeof ops.modules === "object" ? ops.modules : {};
  const operationsStarted = Object.values(modules).some((rows) => Array.isArray(rows) && rows.length > 0);
  const factsConfigured = [ava.services, ava.hours, ava.address, ava.pricing].filter((value) => String(value || "").trim()).length >= 2;
  const checks = [
    { id: "website", label: "Website online", pass: (site.status || "active") === "active" },
    { id: "delivery", label: "Delivery quality approved", pass: !!(site.delivery && site.delivery.ready) },
    { id: "response", label: "FrontDesk response active", pass: site.ava !== false },
    { id: "facts", label: "Business facts configured", pass: factsConfigured },
    { id: "operations", label: "Operating workspace started", pass: operationsStarted },
  ];
  const passed = checks.filter((check) => check.pass).length;
  return { score: passed * 20, ready: passed === checks.length, checks };
}

