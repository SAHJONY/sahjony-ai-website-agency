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

  restaurant: {
    id: "restaurant",
    label: "Restaurant / Food",
    accent: "#ff5a5f",
    blurb: "Reservations, Tickets & the 86 Board",
    modules: [
      {
        id: "reservations",
        title: "Reservations",
        icon: "🍽️",
        kind: "queue",
        statusField: "status",
        statuses: ["Booked", "Seated", "Done", "No-show"],
        columns: [
          { key: "party", label: "Party", type: "text" },
          { key: "size", label: "Guests", type: "num" },
          { key: "time", label: "Time", type: "date" },
          { key: "phone", label: "Phone", type: "text" },
          { key: "status", label: "Status", type: "status" },
        ],
        kpis: [
          { label: "Reservations", agg: "count" },
          { label: "Covers", agg: "sum", field: "size" },
          { label: "Seated", agg: "countStatus", value: "Seated" },
        ],
      },
      {
        id: "tickets",
        title: "Open Tickets",
        icon: "🧾",
        kind: "queue",
        statusField: "status",
        statuses: ["Open", "Fired", "Served", "Paid"],
        columns: [
          { key: "table", label: "Table", type: "text" },
          { key: "server", label: "Server", type: "text" },
          { key: "items", label: "Items", type: "text" },
          { key: "total", label: "Total", type: "money" },
          { key: "status", label: "Status", type: "status" },
        ],
        kpis: [
          { label: "Tickets", agg: "count" },
          { label: "Sales", agg: "sum", field: "total" },
          { label: "Open", agg: "countStatus", value: "Open" },
        ],
      },
      {
        id: "eightysix",
        title: "86 Board",
        icon: "🚫",
        kind: "table",
        statusField: "status",
        statuses: ["Available", "86'd"],
        columns: [
          { key: "item", label: "Item", type: "text" },
          { key: "station", label: "Station", type: "select" },
          { key: "status", label: "Status", type: "status" },
        ],
        options: { station: ["Kitchen", "Bar", "Grill", "Pastry", "Prep"] },
        kpis: [
          { label: "Tracked Items", agg: "count" },
          { label: "86'd Now", agg: "countStatus", value: "86'd" },
        ],
      },
    ],
  },

  salon: {
    id: "salon",
    label: "Salon / Beauty / Barber",
    accent: "#e879c9",
    blurb: "Chair Schedule, Clients & Services",
    modules: [
      {
        id: "appointments",
        title: "Appointments",
        icon: "💇",
        kind: "queue",
        statusField: "status",
        statuses: ["Booked", "In Chair", "Done", "No-show"],
        columns: [
          { key: "client", label: "Client", type: "text" },
          { key: "service", label: "Service", type: "text" },
          { key: "stylist", label: "Stylist", type: "text" },
          { key: "time", label: "Time", type: "date" },
          { key: "price", label: "Price", type: "money" },
          { key: "status", label: "Status", type: "status" },
        ],
        kpis: [
          { label: "Appointments", agg: "count" },
          { label: "Booked Value", agg: "sum", field: "price" },
          { label: "No-shows", agg: "countStatus", value: "No-show" },
        ],
      },
      {
        id: "clients",
        title: "Clients",
        icon: "👤",
        kind: "table",
        columns: [
          { key: "name", label: "Name", type: "text" },
          { key: "phone", label: "Phone", type: "text" },
          { key: "lastVisit", label: "Last Visit", type: "date" },
          { key: "notes", label: "Notes / Formula", type: "text" },
        ],
        kpis: [{ label: "Clients", agg: "count" }],
      },
      {
        id: "services",
        title: "Service Menu",
        icon: "✂️",
        kind: "table",
        columns: [
          { key: "service", label: "Service", type: "text" },
          { key: "category", label: "Category", type: "select" },
          { key: "price", label: "Price", type: "money" },
          { key: "duration", label: "Min", type: "num" },
        ],
        options: { category: ["Cut", "Color", "Style", "Nails", "Spa", "Barber", "Add-on"] },
        kpis: [{ label: "Services", agg: "count" }],
      },
    ],
  },

  "home-services": {
    id: "home-services",
    label: "Home Services / Trades",
    accent: "#ffb400",
    blurb: "Work Orders, Estimates & Invoices",
    modules: [
      {
        id: "jobs",
        title: "Work Orders",
        icon: "🔧",
        kind: "dispatch",
        statusField: "status",
        statuses: ["Quoted", "Scheduled", "In Progress", "Done", "Invoiced"],
        columns: [
          { key: "customer", label: "Customer", type: "text" },
          { key: "address", label: "Address", type: "text" },
          { key: "service", label: "Service", type: "text" },
          { key: "crew", label: "Crew", type: "text" },
          { key: "date", label: "Date", type: "date" },
          { key: "status", label: "Status", type: "status" },
        ],
        kpis: [
          { label: "Jobs", agg: "count" },
          { label: "In Progress", agg: "countStatus", value: "In Progress" },
          { label: "Scheduled", agg: "countStatus", value: "Scheduled" },
        ],
      },
      {
        id: "estimates",
        title: "Estimate Pipeline",
        icon: "📝",
        kind: "pipeline",
        statusField: "stage",
        statuses: ["Lead", "Estimated", "Won", "Lost"],
        columns: [
          { key: "customer", label: "Customer", type: "text" },
          { key: "scope", label: "Scope", type: "text" },
          { key: "amount", label: "Amount", type: "money" },
          { key: "stage", label: "Stage", type: "status" },
        ],
        kpis: [
          { label: "Estimates", agg: "count" },
          { label: "Pipeline Value", agg: "sum", field: "amount" },
          { label: "Won", agg: "countStatus", value: "Won" },
        ],
      },
      {
        id: "invoices",
        title: "Invoices",
        icon: "💵",
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
          { label: "Overdue", agg: "countStatus", value: "Overdue" },
        ],
      },
    ],
  },

  fitness: {
    id: "fitness",
    label: "Gym / Fitness Studio",
    accent: "#4ade80",
    blurb: "Members, Classes & Billing",
    modules: [
      {
        id: "members",
        title: "Members",
        icon: "🏋️",
        kind: "table",
        statusField: "status",
        statuses: ["Active", "Frozen", "Cancelled"],
        columns: [
          { key: "name", label: "Name", type: "text" },
          { key: "plan", label: "Plan", type: "select" },
          { key: "phone", label: "Phone", type: "text" },
          { key: "joined", label: "Joined", type: "date" },
          { key: "status", label: "Status", type: "status" },
        ],
        options: { plan: ["Drop-in", "Monthly", "Annual", "Class Pack", "Personal Training"] },
        kpis: [
          { label: "Members", agg: "count" },
          { label: "Active", agg: "countStatus", value: "Active" },
        ],
      },
      {
        id: "classes",
        title: "Class Schedule",
        icon: "🧘",
        kind: "queue",
        statusField: "status",
        statuses: ["Scheduled", "Full", "Done", "Cancelled"],
        columns: [
          { key: "className", label: "Class", type: "text" },
          { key: "coach", label: "Coach", type: "text" },
          { key: "when", label: "When", type: "date" },
          { key: "capacity", label: "Capacity", type: "num" },
          { key: "booked", label: "Booked", type: "num" },
          { key: "status", label: "Status", type: "status" },
        ],
        kpis: [
          { label: "Classes", agg: "count" },
          { label: "Full", agg: "countStatus", value: "Full" },
        ],
      },
      {
        id: "billing",
        title: "Membership Billing",
        icon: "💳",
        kind: "ledger",
        statusField: "status",
        statuses: ["Current", "Due", "Overdue"],
        columns: [
          { key: "member", label: "Member", type: "text" },
          { key: "plan", label: "Plan", type: "select" },
          { key: "amount", label: "Amount", type: "money" },
          { key: "due", label: "Due", type: "date" },
          { key: "status", label: "Status", type: "status" },
        ],
        options: { plan: ["Monthly", "Annual", "Class Pack", "Personal Training"] },
        kpis: [
          { label: "Recurring Revenue", agg: "sum", field: "amount" },
          { label: "Overdue", agg: "countStatus", value: "Overdue" },
        ],
      },
    ],
  },

  retail: {
    id: "retail",
    label: "Retail / Store",
    accent: "#38bdf8",
    blurb: "Inventory, Orders & Restock",
    modules: [
      {
        id: "products",
        title: "Inventory",
        icon: "🛍️",
        kind: "table",
        statusField: "status",
        statuses: ["In Stock", "Low", "Out"],
        columns: [
          { key: "product", label: "Product", type: "text" },
          { key: "sku", label: "SKU", type: "text" },
          { key: "category", label: "Category", type: "select" },
          { key: "price", label: "Price", type: "money" },
          { key: "stock", label: "Stock", type: "num" },
          { key: "status", label: "Status", type: "status" },
        ],
        options: { category: ["Apparel", "Accessories", "Home", "Electronics", "Beauty", "Other"] },
        kpis: [
          { label: "SKUs", agg: "count" },
          { label: "Inventory Value", agg: "sumProduct", field: "price", field2: "stock" },
          { label: "Out of Stock", agg: "countStatus", value: "Out" },
        ],
      },
      {
        id: "orders",
        title: "Orders",
        icon: "📦",
        kind: "queue",
        statusField: "status",
        statuses: ["New", "Packed", "Shipped", "Delivered"],
        columns: [
          { key: "customer", label: "Customer", type: "text" },
          { key: "items", label: "Items", type: "text" },
          { key: "total", label: "Total", type: "money" },
          { key: "date", label: "Date", type: "date" },
          { key: "status", label: "Status", type: "status" },
        ],
        kpis: [
          { label: "Orders", agg: "count" },
          { label: "Sales", agg: "sum", field: "total" },
          { label: "To Ship", agg: "countStatus", value: "New" },
        ],
      },
      {
        id: "restock",
        title: "Restock",
        icon: "🔄",
        kind: "table",
        statusField: "status",
        statuses: ["Ordered", "In Transit", "Received"],
        columns: [
          { key: "product", label: "Product", type: "text" },
          { key: "supplier", label: "Supplier", type: "text" },
          { key: "qty", label: "Qty", type: "num" },
          { key: "eta", label: "ETA", type: "date" },
          { key: "status", label: "Status", type: "status" },
        ],
        kpis: [
          { label: "Restock Orders", agg: "count" },
          { label: "Received", agg: "countStatus", value: "Received" },
        ],
      },
    ],
  },

  // Fallback for anything not matched above (hotels, events, professional
  // services…). A tight, universal ops core.
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
export const VERTICAL_ORDER = [
  "real-estate", "medical", "legal", "logistics",
  "restaurant", "salon", "home-services", "fitness", "retail", "general",
];

// Best-effort mapping from a free-text business type → a vertical id, so the
// builder / client console can pick the right dashboard from what was typed.
// ORDER MATTERS: more specific / higher-precedence checks come first. Notably
// salon is tested before restaurant so "barber" isn't caught by "bar".
export function inferVertical(typeText) {
  const t = String(typeText || "").toLowerCase();
  const has = (...w) => w.some((x) => t.includes(x));
  if (has("real estate", "realtor", "realty", "broker", "property", "properties", "homes")) return "real-estate";
  if (has("med spa", "medical", "clinic", "doctor", "dental", "dentist", "physician", "chiro", "therap", "wellness", "vet", "optom", "physio")) return "medical";
  if (has("law", "legal", "attorney", "lawyer", "counsel", "paralegal", "accountant", "accounting", "bookkeep", "notary", "insurance", "tax", "consult")) return "legal";
  if (has("logistic", "freight", "trucking", "fleet", "shipping", "courier", "haul")) return "logistics";
  // Hotels / lodging + events have no dedicated ops vertical yet → catch-all,
  // but guard them BEFORE retail so "boutique hotel" isn't read as a store.
  if (has("hotel", "motel", "hostel", "resort", "lodge", "airbnb", "bnb", "guesthouse")) return "general";
  if (has("salon", "barber", "spa", "beauty", "nail", "hair", "lash", "makeup", "wax", "tattoo", "brow", "esthet")) return "salon";
  if (has("restaurant", "cafe", "coffee", "bakery", "bread", "cake", "pizza", "taco", "grill", "bar", "diner", "deli", "cater", "kitchen", "eatery", "bbq", "sushi", "juice", "food")) return "restaurant";
  if (has("gym", "fitness", "yoga", "pilates", "crossfit", "martial", "dance", "bootcamp", "personal train")) return "fitness";
  if (has("repair", "mechanic", "plumb", "electric", "hvac", "contractor", "construction", "handyman", "roof", "landscap", "clean", "pest", "moving", "paint", "garage")) return "home-services";
  if (has("shop", "store", "retail", "boutique", "market", "goods", "product", "florist", "flower", "jewel", "furniture", "bike", "pet", "dealer", "dealership", "vehicle", "motors", "used car")) return "retail";
  return "general";
}

// Convenience for non-module consumers.
export function getVertical(id) {
  return VERTICALS[id] || VERTICALS.general;
}

// ============================ CUSTOMER PORTAL ==============================
// The per-industry CUSTOMER portal (account.html) mirrors the owner back-office:
// registry-driven and industry-tailored. Customers of the business sign in and
// submit an industry-appropriate request; every request lands as a row in the
// owner's back-office under this ONE shared, customer-writable module — the only
// module a customer may ever append to (enforced server-side in api/site.js).
export const REQUESTS_MODULE_ID = "requests";
const REQUESTS_MODULE = {
  id: REQUESTS_MODULE_ID,
  title: "Customer Requests",
  icon: "📥",
  kind: "queue",
  statusField: "status",
  statuses: ["New", "In Progress", "Handled", "Closed"],
  columns: [
    { key: "customer", label: "Customer", type: "text" },
    { key: "detail", label: "Request", type: "text" },
    { key: "contact", label: "Contact", type: "text" },
    { key: "date", label: "Received", type: "date" },
    { key: "status", label: "Status", type: "status" },
  ],
  kpis: [
    { label: "Requests", agg: "count" },
    { label: "New", agg: "countStatus", value: "New" },
    { label: "Handled", agg: "countStatus", value: "Handled" },
  ],
  customerWritable: true, // the ONLY module the public portal can append to
};

// Industry-tailored customer-facing forms. `fields` drive account.html; the
// server composes a request `detail` from the filled fields. type ∈
// text | num | date | textarea | select (select needs `options`).
const PORTALS = {
  "real-estate": {
    headline: "Your home search", blurb: "Request a showing and track your interest.",
    cta: "Request a showing",
    fields: [
      { key: "property", label: "Property or area of interest", type: "text", required: true },
      { key: "budget", label: "Budget", type: "num" },
      { key: "time", label: "Preferred date/time", type: "date" },
      { key: "notes", label: "Anything we should know?", type: "textarea" },
    ],
  },
  medical: {
    headline: "Appointments & requests", blurb: "Request an appointment with our practice.",
    cta: "Request an appointment",
    fields: [
      { key: "reason", label: "Reason for visit", type: "text", required: true },
      { key: "provider", label: "Preferred provider (optional)", type: "text" },
      { key: "time", label: "Preferred date/time", type: "date" },
      { key: "notes", label: "Notes", type: "textarea" },
    ],
  },
  legal: {
    headline: "Your matters", blurb: "Request a consultation with our firm.",
    cta: "Request a consultation",
    fields: [
      { key: "matter", label: "What do you need help with?", type: "text", required: true },
      { key: "practice", label: "Practice area", type: "select", options: ["Litigation", "Corporate", "Family", "Real Estate", "Criminal", "Estate", "Other"] },
      { key: "time", label: "Preferred date/time", type: "date" },
      { key: "notes", label: "Details", type: "textarea" },
    ],
  },
  logistics: {
    headline: "Shipments & quotes", blurb: "Request a freight quote or track a shipment.",
    cta: "Request a quote",
    fields: [
      { key: "origin", label: "Origin", type: "text", required: true },
      { key: "destination", label: "Destination", type: "text", required: true },
      { key: "weight", label: "Weight (lb)", type: "num" },
      { key: "notes", label: "Freight details", type: "textarea" },
    ],
  },
  restaurant: {
    headline: "Reservations", blurb: "Request a table and see your bookings.",
    cta: "Request a reservation",
    fields: [
      { key: "size", label: "Party size", type: "num", required: true },
      { key: "time", label: "Date & time", type: "date", required: true },
      { key: "notes", label: "Special requests (allergies, occasion…)", type: "textarea" },
    ],
  },
  salon: {
    headline: "Appointments", blurb: "Book an appointment and manage your visits.",
    cta: "Book an appointment",
    fields: [
      { key: "service", label: "Service", type: "text", required: true },
      { key: "stylist", label: "Preferred stylist (optional)", type: "text" },
      { key: "time", label: "Preferred date/time", type: "date" },
      { key: "notes", label: "Notes", type: "textarea" },
    ],
  },
  "home-services": {
    headline: "Service requests", blurb: "Request service or a free estimate.",
    cta: "Request service / estimate",
    fields: [
      { key: "service", label: "What do you need done?", type: "text", required: true },
      { key: "address", label: "Service address", type: "text" },
      { key: "time", label: "Preferred date", type: "date" },
      { key: "notes", label: "Details", type: "textarea" },
    ],
  },
  fitness: {
    headline: "Classes & membership", blurb: "Book a class, join, or ask about membership.",
    cta: "Send request",
    fields: [
      { key: "interest", label: "I'd like to…", type: "select", required: true, options: ["Join / membership", "Book a class", "Personal training", "Tour the gym"] },
      { key: "time", label: "Preferred date/time", type: "date" },
      { key: "notes", label: "Notes", type: "textarea" },
    ],
  },
  retail: {
    headline: "Orders & inquiries", blurb: "Ask about products, stock, or an order.",
    cta: "Send inquiry",
    fields: [
      { key: "product", label: "Product / item", type: "text", required: true },
      { key: "notes", label: "Your question", type: "textarea" },
    ],
  },
  general: {
    headline: "Requests", blurb: "Send us a request — we'll get back to you.",
    cta: "Send request",
    fields: [
      { key: "subject", label: "Subject", type: "text", required: true },
      { key: "notes", label: "Message", type: "textarea" },
    ],
  },
};

// Attach the shared Requests module (owner-visible) + the portal spec to every
// vertical. Runs once at import, in both browser and node. Deep-clone the module
// so verticals don't share a single row-less reference.
(function attachPortalLayer() {
  const clone = (o) => JSON.parse(JSON.stringify(o));
  for (const id of VERTICAL_ORDER) {
    const v = VERTICALS[id];
    if (!v) continue;
    if (!v.modules.some((m) => m.id === REQUESTS_MODULE_ID)) v.modules.push(clone(REQUESTS_MODULE));
    v.portal = PORTALS[id] || PORTALS.general;
  }
})();
