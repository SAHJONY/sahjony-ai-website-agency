// verticals.js — the per-industry back-office registry.
//
// This is the SINGLE SOURCE OF TRUTH for what a business's Owner Dashboard
// contains. Each vertical maps to a set of operational MODULES; each module is
// a live, editable table backed by Upstash (via /api/data, key
// fda:bo:<slug>:<moduleId>). Adding a new industry is a DATA edit here — no new
// code, no new serverless function (the app is at Vercel's 12-function limit).
//
// Loaded two ways from the same file:
//   • browser  — <script type="module"> import { VERTICALS } from "/verticals.js"
//   • node/api — import { VERTICALS } from "../public/verticals.js"  (if ever needed)
//
// ---- Module shape --------------------------------------------------------
// { id, title, icon, kind, statusField?, statuses?,
//   columns: [{ key, label, type }],   // type: text|num|money|date|select|status
//   options?: { <colKey>: [..] },       // choices for type:"select"
//   kpis: [{ label, agg, field?, field2?, value? }] }
//
// kpis.agg ∈ count | sum | sumProduct | countStatus
//   count        → number of rows
//   sum          → Σ row[field]
//   sumProduct   → Σ row[field] * row[field2]     (e.g. hours × rate)
//   countStatus  → rows where row[statusField] === value
//
// `kind` is cosmetic (icon + intent). The table engine is universal.

export const VERTICALS = {
  "real-estate": {
    id: "real-estate",
    label: "Real Estate Brokerage",
    accent: "#37e0c4",
    blurb: "Property Portfolio & Deal Pipeline",
    modules: [
      {
        id: "pipeline",
        title: "Deal Pipeline",
        icon: "🏷️",
        kind: "pipeline",
        statusField: "stage",
        statuses: ["Lead", "Showing", "Offer", "Escrow", "Closed"],
        columns: [
          { key: "property", label: "Property", type: "text" },
          { key: "client", label: "Client", type: "text" },
          { key: "price", label: "Price", type: "money" },
          { key: "stage", label: "Stage", type: "status" },
          { key: "commissionPct", label: "Comm %", type: "num" },
          { key: "closeDate", label: "Target Close", type: "date" },
        ],
        kpis: [
          { label: "Active Deals", agg: "count" },
          { label: "Pipeline Value", agg: "sum", field: "price" },
          { label: "In Escrow", agg: "countStatus", value: "Escrow" },
          { label: "Closed", agg: "countStatus", value: "Closed" },
        ],
      },
      {
        id: "portfolio",
        title: "Property Portfolio",
        icon: "🏠",
        kind: "table",
        statusField: "status",
        statuses: ["Active", "Pending", "Sold"],
        columns: [
          { key: "address", label: "Address", type: "text" },
          { key: "kind", label: "Type", type: "select" },
          { key: "listPrice", label: "List Price", type: "money" },
          { key: "beds", label: "Beds", type: "num" },
          { key: "baths", label: "Baths", type: "num" },
          { key: "status", label: "Status", type: "status" },
        ],
        options: { kind: ["House", "Condo", "Townhome", "Land", "Commercial"] },
        kpis: [
          { label: "Listings", agg: "count" },
          { label: "Portfolio Value", agg: "sum", field: "listPrice" },
          { label: "Active", agg: "countStatus", value: "Active" },
        ],
      },
      {
        id: "escrow",
        title: "Escrow Milestones",
        icon: "📑",
        kind: "table",
        statusField: "status",
        statuses: ["Pending", "In Progress", "Done"],
        columns: [
          { key: "property", label: "Property", type: "text" },
          { key: "milestone", label: "Milestone", type: "text" },
          { key: "dueDate", label: "Due", type: "date" },
          { key: "status", label: "Status", type: "status" },
        ],
        kpis: [
          { label: "Open Milestones", agg: "count" },
          { label: "Completed", agg: "countStatus", value: "Done" },
        ],
      },
    ],
  },

  medical: {
    id: "medical",
    label: "Medical / Clinical Practice",
    accent: "#4ea8ff",
    blurb: "Patient EHR & Clinical Flow Engine",
    modules: [
      {
        id: "intake",
        title: "Intake Queue",
        icon: "🩺",
        kind: "queue",
        statusField: "status",
        statuses: ["Waiting", "In Room", "With Provider", "Done"],
        columns: [
          { key: "patient", label: "Patient", type: "text" },
          { key: "reason", label: "Reason", type: "text" },
          { key: "provider", label: "Provider", type: "text" },
          { key: "time", label: "Appt", type: "date" },
          { key: "status", label: "Status", type: "status" },
        ],
        kpis: [
          { label: "In Queue", agg: "count" },
          { label: "Waiting", agg: "countStatus", value: "Waiting" },
          { label: "With Provider", agg: "countStatus", value: "With Provider" },
        ],
      },
      {
        id: "charts",
        title: "Treatment Charts",
        icon: "📋",
        kind: "table",
        statusField: "status",
        statuses: ["Open", "Pending Review", "Signed"],
        columns: [
          { key: "patient", label: "Patient", type: "text" },
          { key: "chart", label: "Chart / Note", type: "text" },
          { key: "provider", label: "Provider", type: "text" },
          { key: "updated", label: "Updated", type: "date" },
          { key: "status", label: "Status", type: "status" },
        ],
        kpis: [
          { label: "Charts", agg: "count" },
          { label: "Unsigned", agg: "countStatus", value: "Open" },
        ],
      },
      {
        id: "billing",
        title: "Billing Tracker",
        icon: "💳",
        kind: "ledger",
        statusField: "status",
        statuses: ["Unbilled", "Submitted", "Paid", "Denied"],
        columns: [
          { key: "patient", label: "Patient", type: "text" },
          { key: "code", label: "CPT/Code", type: "text" },
          { key: "amount", label: "Amount", type: "money" },
          { key: "payer", label: "Payer", type: "text" },
          { key: "status", label: "Status", type: "status" },
        ],
        kpis: [
          { label: "Claims", agg: "count" },
          { label: "Billed Total", agg: "sum", field: "amount" },
          { label: "Awaiting Payment", agg: "countStatus", value: "Submitted" },
        ],
      },
    ],
  },

  legal: {
    id: "legal",
    label: "Legal / Law Firm",
    accent: "#c7a24a",
    blurb: "Case Ledger & Billable Hour Tracker",
    modules: [
      {
        id: "cases",
        title: "Case Ledger",
        icon: "⚖️",
        kind: "table",
        statusField: "status",
        statuses: ["Intake", "Active", "On Hold", "Closed"],
        columns: [
          { key: "matter", label: "Matter", type: "text" },
          { key: "client", label: "Client", type: "text" },
          { key: "practice", label: "Practice", type: "select" },
          { key: "opened", label: "Opened", type: "date" },
          { key: "status", label: "Status", type: "status" },
        ],
        options: { practice: ["Litigation", "Corporate", "Family", "Real Estate", "Criminal", "Estate"] },
        kpis: [
          { label: "Matters", agg: "count" },
          { label: "Active", agg: "countStatus", value: "Active" },
        ],
      },
      {
        id: "hours",
        title: "Billable Hours",
        icon: "⏱️",
        kind: "ledger",
        statusField: "status",
        statuses: ["Unbilled", "Invoiced", "Paid"],
        columns: [
          { key: "matter", label: "Matter", type: "text" },
          { key: "attorney", label: "Attorney", type: "text" },
          { key: "hours", label: "Hours", type: "num" },
          { key: "rate", label: "Rate/hr", type: "money" },
          { key: "date", label: "Date", type: "date" },
          { key: "status", label: "Status", type: "status" },
        ],
        kpis: [
          { label: "Entries", agg: "count" },
          { label: "Billable Value", agg: "sumProduct", field: "hours", field2: "rate" },
          { label: "Unbilled", agg: "countStatus", value: "Unbilled" },
        ],
      },
      {
        id: "retainers",
        title: "Retainer Balances",
        icon: "🏦",
        kind: "table",
        columns: [
          { key: "client", label: "Client", type: "text" },
          { key: "retainer", label: "Retainer", type: "money" },
          { key: "used", label: "Used", type: "money" },
          { key: "remaining", label: "Remaining", type: "money" },
        ],
        kpis: [
          { label: "Clients", agg: "count" },
          { label: "Funds Remaining", agg: "sum", field: "remaining" },
        ],
      },
      {
        id: "calendar",
        title: "Court Calendar",
        icon: "📅",
        kind: "table",
        statusField: "status",
        statuses: ["Scheduled", "Prep", "Done"],
        columns: [
          { key: "matter", label: "Matter", type: "text" },
          { key: "event", label: "Event", type: "text" },
          { key: "date", label: "Date", type: "date" },
          { key: "court", label: "Court", type: "text" },
          { key: "status", label: "Status", type: "status" },
        ],
        kpis: [
          { label: "Upcoming", agg: "count" },
          { label: "Needs Prep", agg: "countStatus", value: "Prep" },
        ],
      },
    ],
  },

  logistics: {
    id: "logistics",
    label: "Logistics / Fleet Ops",
    accent: "#ff8a3d",
    blurb: "Dispatch Control & Route Telemetry",
    modules: [
      {
        id: "dispatch",
        title: "Dispatch Board",
        icon: "🚚",
        kind: "dispatch",
        statusField: "status",
        statuses: ["Unassigned", "Assigned", "In Transit", "Delivered"],
        columns: [
          { key: "load", label: "Load #", type: "text" },
          { key: "driver", label: "Driver", type: "text" },
          { key: "origin", label: "Origin", type: "text" },
          { key: "destination", label: "Destination", type: "text" },
          { key: "status", label: "Status", type: "status" },
        ],
        kpis: [
          { label: "Loads", agg: "count" },
          { label: "In Transit", agg: "countStatus", value: "In Transit" },
          { label: "Unassigned", agg: "countStatus", value: "Unassigned" },
        ],
      },
      {
        id: "fleet",
        title: "Fleet Roster",
        icon: "🛻",
        kind: "table",
        statusField: "status",
        statuses: ["Active", "Maintenance", "Idle"],
        columns: [
          { key: "unit", label: "Unit", type: "text" },
          { key: "driver", label: "Driver", type: "text" },
          { key: "vtype", label: "Type", type: "select" },
          { key: "mpg", label: "MPG", type: "num" },
          { key: "status", label: "Status", type: "status" },
        ],
        options: { vtype: ["Van", "Box Truck", "Semi", "Flatbed", "Reefer"] },
        kpis: [
          { label: "Units", agg: "count" },
          { label: "Active", agg: "countStatus", value: "Active" },
          { label: "In Maintenance", agg: "countStatus", value: "Maintenance" },
        ],
      },
      {
        id: "manifests",
        title: "Manifests & Margin",
        icon: "📦",
        kind: "ledger",
        columns: [
          { key: "load", label: "Load #", type: "text" },
          { key: "shipper", label: "Shipper", type: "text" },
          { key: "weight", label: "Weight (lb)", type: "num" },
          { key: "rate", label: "Rate", type: "money" },
          { key: "fuelCost", label: "Fuel Cost", type: "money" },
        ],
        kpis: [
          { label: "Manifests", agg: "count" },
          { label: "Gross Revenue", agg: "sum", field: "rate" },
          { label: "Fuel Spend", agg: "sum", field: "fuelCost" },
        ],
      },
    ],
  },

  // Fallback for the long tail the factory actually sells to most: restaurants,
  // salons, roofers, gyms, auto shops, cleaners… A tight, universal ops core.
  general: {
    id: "general",
    label: "Local Business (General)",
    accent: "#e8c476",
    blurb: "Bookings, Customers & Invoices",
    modules: [
      {
        id: "jobs",
        title: "Appointments & Jobs",
        icon: "🗓️",
        kind: "queue",
        statusField: "status",
        statuses: ["Booked", "In Progress", "Done", "Cancelled"],
        columns: [
          { key: "customer", label: "Customer", type: "text" },
          { key: "service", label: "Service", type: "text" },
          { key: "when", label: "When", type: "date" },
          { key: "price", label: "Price", type: "money" },
          { key: "status", label: "Status", type: "status" },
        ],
        kpis: [
          { label: "Jobs", agg: "count" },
          { label: "Booked Value", agg: "sum", field: "price" },
          { label: "In Progress", agg: "countStatus", value: "In Progress" },
        ],
      },
      {
        id: "customers",
        title: "Customers",
        icon: "👥",
        kind: "table",
        columns: [
          { key: "name", label: "Name", type: "text" },
          { key: "phone", label: "Phone", type: "text" },
          { key: "email", label: "Email", type: "text" },
          { key: "notes", label: "Notes", type: "text" },
        ],
        kpis: [{ label: "Customers", agg: "count" }],
      },
      {
        id: "invoices",
        title: "Invoices",
        icon: "🧾",
        kind: "ledger",
        statusField: "status",
        statuses: ["Draft", "Sent", "Paid", "Overdue"],
        columns: [
          { key: "customer", label: "Customer", type: "text" },
          { key: "amount", label: "Amount", type: "money" },
          { key: "due", label: "Due", type: "date" },
          { key: "status", label: "Status", type: "status" },
        ],
        kpis: [
          { label: "Invoices", agg: "count" },
          { label: "Invoiced", agg: "sum", field: "amount" },
          { label: "Unpaid", agg: "countStatus", value: "Sent" },
        ],
      },
    ],
  },
};

// Ordered list for building selectors (general last — it's the catch-all).
export const VERTICAL_ORDER = ["real-estate", "medical", "legal", "logistics", "general"];

// Best-effort mapping from a free-text business type → a vertical id, so the
// builder can pre-select the right dashboard from what the owner already typed.
export function inferVertical(typeText) {
  const t = String(typeText || "").toLowerCase();
  const has = (...w) => w.some((x) => t.includes(x));
  if (has("real estate", "realtor", "realty", "broker", "property", "properties", "homes")) return "real-estate";
  if (has("clinic", "medical", "doctor", "dental", "dentist", "health", "physician", "therapy", "chiro", "med spa", "wellness")) return "medical";
  if (has("law", "legal", "attorney", "lawyer", "firm", "counsel", "paralegal")) return "legal";
  if (has("logistic", "freight", "trucking", "fleet", "dispatch", "shipping", "courier", "delivery", "haul")) return "logistics";
  return "general";
}

// Convenience for non-module consumers.
export function getVertical(id) {
  return VERTICALS[id] || VERTICALS.general;
}
