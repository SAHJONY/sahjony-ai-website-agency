// app/api/pricing/route.ts
// GET /api/pricing            -> prices localized to the visitor's country
// GET /api/pricing?country=MX -> prices for a specific country (testing/override)
//
// Country detection uses Vercel's built-in geo header (x-vercel-ip-country),
// which is present on every request in production — no extra service needed.

import { NextRequest, NextResponse } from "next/server";
import { pricingForCountry } from "@/lib/pricing";

export const runtime = "nodejs";

export async function GET(req: NextRequest) {
  const override = req.nextUrl.searchParams.get("country");
  const geo = req.headers.get("x-vercel-ip-country");
  const country = (override || geo || "US").slice(0, 2);

  // Best-effort locale from the browser for correct number formatting.
  const accept = req.headers.get("accept-language") || "";
  const locale = accept.split(",")[0]?.trim() || undefined;

  const pricing = pricingForCountry(country, locale);

  return NextResponse.json(pricing, {
    headers: {
      // Cache per country at the edge; localized but still fast.
      "Cache-Control": "public, s-maxage=3600, stale-while-revalidate=86400",
      Vary: "x-vercel-ip-country, accept-language",
    },
  });
}
