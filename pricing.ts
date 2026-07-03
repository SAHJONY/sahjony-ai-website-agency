// lib/pricing.ts
// Multi-currency pricing for frontdeskagents.com.
//
// Strategy:
//   1. Base prices are USD (The Corner Shop / The Neighborhood / The Cornerstone).
//   2. Major markets get FIXED, psychologically-rounded local prices (never
//      jittery FX conversions — clean numbers build trust).
//   3. Every other country falls back to FX conversion from an editable rates
//      table, rounded to clean price points.
//   4. Formatting uses Intl.NumberFormat, so symbols/decimals are always right.
//
// Country detection: pass the visitor's ISO country code (on Vercel, read the
// `x-vercel-ip-country` request header — see app/api/pricing/route.ts).

export type PlanId = "corner_shop" | "neighborhood" | "cornerstone";

export type Plan = {
  id: PlanId;
  name: string;
  kind: "one_time" | "monthly";
  usd: number;
};

export const PLANS: Plan[] = [
  { id: "corner_shop", name: "The Corner Shop", kind: "one_time", usd: 899 },
  { id: "neighborhood", name: "The Neighborhood", kind: "one_time", usd: 1299 },
  { id: "cornerstone", name: "The Cornerstone", kind: "monthly", usd: 89 },
];

// ---------------------------------------------------------------------------
// Country → currency (ISO 3166-1 alpha-2 → ISO 4217). Covers major markets;
// anything missing falls back to USD.
// ---------------------------------------------------------------------------
export const COUNTRY_CURRENCY: Record<string, string> = {
  US: "USD", PR: "USD", EC: "USD", SV: "USD", PA: "USD",
  MX: "MXN", CA: "CAD", GB: "GBP",
  // Eurozone
  DE: "EUR", FR: "EUR", ES: "EUR", IT: "EUR", NL: "EUR", BE: "EUR", AT: "EUR",
  PT: "EUR", IE: "EUR", FI: "EUR", GR: "EUR", SK: "EUR", SI: "EUR", LV: "EUR",
  LT: "EUR", EE: "EUR", LU: "EUR", CY: "EUR", MT: "EUR", HR: "EUR",
  // Latin America
  BR: "BRL", AR: "ARS", CL: "CLP", CO: "COP", PE: "PEN", UY: "UYU",
  GT: "GTQ", DO: "DOP", CR: "CRC", HN: "HNL", NI: "NIO", BO: "BOB", PY: "PYG",
  // Rest of world
  JP: "JPY", CN: "CNY", KR: "KRW", IN: "INR", AU: "AUD", NZ: "NZD",
  CH: "CHF", SE: "SEK", NO: "NOK", DK: "DKK", PL: "PLN", CZ: "CZK",
  HU: "HUF", RO: "RON", BG: "BGN", TR: "TRY", ZA: "ZAR", NG: "NGN",
  KE: "KES", EG: "EGP", MA: "MAD", SA: "SAR", AE: "AED", IL: "ILS",
  SG: "SGD", HK: "HKD", TW: "TWD", TH: "THB", VN: "VND", PH: "PHP",
  ID: "IDR", MY: "MYR",
};

// ---------------------------------------------------------------------------
// FIXED prices for priority markets (clean, market-friendly numbers).
// Keyed by currency, then plan. Review these when you enter a market for real.
// ---------------------------------------------------------------------------
export const FIXED_PRICES: Record<string, Partial<Record<PlanId, number>>> = {
  USD: { corner_shop: 899, neighborhood: 1299, cornerstone: 89 },
  MXN: { corner_shop: 15999, neighborhood: 22999, cornerstone: 1599 },
  CAD: { corner_shop: 1199, neighborhood: 1749, cornerstone: 119 },
  EUR: { corner_shop: 849, neighborhood: 1199, cornerstone: 85 },
  GBP: { corner_shop: 749, neighborhood: 1049, cornerstone: 75 },
  BRL: { corner_shop: 4599, neighborhood: 6599, cornerstone: 449 },
  COP: { corner_shop: 3599000, neighborhood: 5199000, cornerstone: 359000 },
  AUD: { corner_shop: 1349, neighborhood: 1949, cornerstone: 135 },
  INR: { corner_shop: 74999, neighborhood: 107999, cornerstone: 7499 },
  JPY: { corner_shop: 129800, neighborhood: 189800, cornerstone: 12800 },
};

// ---------------------------------------------------------------------------
// FX fallback rates (1 USD = X). EDITABLE + STALE BY NATURE.
// Only used for currencies with no FIXED_PRICES entry. Update periodically or
// wire a live-rates fetch. Approximate values — as of RATES_ASOF.
// ---------------------------------------------------------------------------
export const RATES_ASOF = "2026-06 (approximate — update me)";
export const USD_RATES: Record<string, number> = {
  USD: 1, MXN: 18.5, CAD: 1.37, EUR: 0.93, GBP: 0.79, BRL: 5.4, ARS: 1450,
  CLP: 960, COP: 4100, PEN: 3.75, UYU: 42, GTQ: 7.8, DOP: 60, CRC: 520,
  HNL: 25, NIO: 37, BOB: 6.9, PYG: 7600, JPY: 152, CNY: 7.2, KRW: 1380,
  INR: 84, AUD: 1.52, NZD: 1.66, CHF: 0.88, SEK: 10.6, NOK: 10.9, DKK: 6.9,
  PLN: 4.0, CZK: 23.4, HUF: 366, RON: 4.6, BGN: 1.82, TRY: 38, ZAR: 18.4,
  NGN: 1550, KES: 129, EGP: 49, MAD: 10.0, SAR: 3.75, AED: 3.67, ILS: 3.7,
  SGD: 1.34, HKD: 7.8, TWD: 32.4, THB: 34, VND: 25500, PHP: 58, IDR: 16300,
  MYR: 4.4,
};

// Currencies conventionally shown without decimals.
const ZERO_DECIMAL = new Set(["JPY", "KRW", "VND", "CLP", "PYG", "IDR", "HUF", "COP", "CRC"]);

// Round a converted amount to a clean, trustworthy price point.
function psychologicalRound(amount: number, currency: string): number {
  const zero = ZERO_DECIMAL.has(currency);
  if (amount >= 1_000_000) return Math.ceil(amount / 100_000) * 100_000 - (zero ? 1000 : 0);
  if (amount >= 100_000) return Math.ceil(amount / 10_000) * 10_000 - (zero ? 1000 : 0);
  if (amount >= 10_000) return Math.ceil(amount / 1_000) * 1_000 - 1;
  if (amount >= 1_000) return Math.ceil(amount / 100) * 100 - 1;
  if (amount >= 100) return Math.ceil(amount / 10) * 10 - 1;
  return Math.ceil(amount);
}

export function currencyForCountry(countryCode?: string | null): string {
  if (!countryCode) return "USD";
  return COUNTRY_CURRENCY[countryCode.toUpperCase()] || "USD";
}

export function priceFor(planId: PlanId, currency: string): { amount: number; currency: string; source: "fixed" | "fx" } {
  const plan = PLANS.find((p) => p.id === planId);
  if (!plan) throw new Error(`Unknown plan: ${planId}`);

  const fixed = FIXED_PRICES[currency]?.[planId];
  if (typeof fixed === "number") return { amount: fixed, currency, source: "fixed" };

  const rate = USD_RATES[currency];
  if (!rate) return { amount: plan.usd, currency: "USD", source: "fixed" };

  return { amount: psychologicalRound(plan.usd * rate, currency), currency, source: "fx" };
}

export function formatPrice(amount: number, currency: string, locale?: string): string {
  const zero = ZERO_DECIMAL.has(currency);
  try {
    return new Intl.NumberFormat(locale || undefined, {
      style: "currency",
      currency,
      minimumFractionDigits: zero ? 0 : 0,
      maximumFractionDigits: zero ? 0 : 0,
    }).format(amount);
  } catch {
    return `${currency} ${amount.toLocaleString()}`;
  }
}

export type LocalizedPricing = {
  country: string;
  currency: string;
  ratesAsOf: string;
  plans: Array<{
    id: PlanId;
    name: string;
    kind: Plan["kind"];
    usd: number;
    amount: number;
    display: string;
    source: "fixed" | "fx";
  }>;
};

// One call does it all: country code in, full localized price table out.
export function pricingForCountry(countryCode?: string | null, locale?: string): LocalizedPricing {
  const country = (countryCode || "US").toUpperCase();
  const currency = currencyForCountry(country);
  return {
    country,
    currency,
    ratesAsOf: RATES_ASOF,
    plans: PLANS.map((p) => {
      const pr = priceFor(p.id, currency);
      return {
        id: p.id,
        name: p.name,
        kind: p.kind,
        usd: p.usd,
        amount: pr.amount,
        display: formatPrice(pr.amount, pr.currency, locale) + (p.kind === "monthly" ? "/mo" : ""),
        source: pr.source,
      };
    }),
  };
}
