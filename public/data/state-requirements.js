/* =============================================================================
 * state-requirements.js  —  Nationwide compliance / disclosure engine
 * -----------------------------------------------------------------------------
 * Powers the "State Requirements" section that gets embedded into generated
 * websites (auto-sales / auto-finance first, but structured to cover ANY
 * industry that has state-specific rules) and the dealer-facing editor.
 *
 * IMPORTANT — READ THE DISCLAIMER.  The data below is an organized, commonly
 * cited BASELINE assembled to give a business a strong starting point. Laws,
 * fee caps, and licensing rules change frequently and vary by transaction. It
 * is NOT legal advice and is NOT a substitute for review by a licensed
 * attorney or the state regulator. Every per-state record carries
 * `verified:false` until your counsel signs off; the dealer dashboard lets you
 * edit any field and flip `verified:true` once reviewed.
 *
 * Shape:
 *   window.STATE_REQUIREMENTS = {
 *     meta, federal: { autoFinance:[...], general:[...] },
 *     states: { CA:{...}, ... }   // 50 states + DC
 *   }
 *   window.StateReq = { get(code,industry), states(), render(code,industry,opts) }
 * ============================================================================= */
(function () {
  "use strict";

  var META = {
    version: "1.0",
    updated: "2026-06-26",
    disclaimer:
      "This information is a general, commonly cited baseline for educational " +
      "purposes only. It is NOT legal advice and may be out of date or " +
      "incomplete. Auto-sale, finance, and refinance laws — including fee caps, " +
      "licensing, and required disclosures — change often and vary by " +
      "transaction and locality. Verify everything with a licensed attorney and " +
      "your state regulator before relying on it.",
  };

  /* ---------------------------------------------------------------------------
   * FEDERAL — applies in ALL 50 states + DC. This block is the most stable and
   * the most important: federal consumer-finance law governs every auto loan
   * and retail-installment contract in the country.
   * ------------------------------------------------------------------------- */
  var FEDERAL = {
    autoFinance: [
      {
        title: "Truth in Lending Act (TILA / Regulation Z)",
        body:
          "Every retail-installment sale or auto loan must clearly disclose, " +
          "before signing: the Annual Percentage Rate (APR), finance charge, " +
          "amount financed, total of payments, total sale price, and the " +
          "payment schedule. These are the boxed federal disclosures on the " +
          "contract.",
        agency: "Consumer Financial Protection Bureau (CFPB)",
      },
      {
        title: "FTC Used Car Rule — Buyers Guide",
        body:
          "Used-vehicle dealers must post a Buyers Guide window sticker on each " +
          "used car stating whether it is sold 'AS IS' or with a warranty, and " +
          "the percentage of repair costs the dealer will cover. A Spanish " +
          "Buyers Guide is required if the sale is negotiated in Spanish.",
        agency: "Federal Trade Commission (FTC)",
      },
      {
        title: "Equal Credit Opportunity Act (ECOA / Regulation B)",
        body:
          "Credit cannot be denied or priced based on race, color, religion, " +
          "national origin, sex, marital status, age, or receipt of public " +
          "assistance. Applicants denied or given less-favorable terms must " +
          "receive an adverse-action notice.",
        agency: "CFPB",
      },
      {
        title: "Risk-Based Pricing & Credit-Score Disclosure (FCRA)",
        body:
          "If a customer's credit report leads to less-favorable financing " +
          "terms, the dealer/lender must provide a risk-based pricing notice " +
          "or a credit-score disclosure exception notice.",
        agency: "FTC / CFPB",
      },
      {
        title: "Gramm-Leach-Bliley Act (GLBA) — Privacy & Safeguards",
        body:
          "Dealers that arrange financing are financial institutions under " +
          "GLBA: they must give customers a privacy notice and maintain a " +
          "written information-security program (Safeguards Rule) to protect " +
          "nonpublic personal financial information (NPI).",
        agency: "FTC",
      },
      {
        title: "FTC Red Flags Rule (Identity Theft Prevention)",
        body:
          "Dealers extending or arranging credit must maintain a written " +
          "Identity Theft Prevention Program to detect and respond to red " +
          "flags of identity theft.",
        agency: "FTC",
      },
      {
        title: "Magnuson-Moss Warranty Act",
        body:
          "Governs how written warranties are offered and disclosed. Warranty " +
          "terms must be available to the buyer before sale and cannot be " +
          "misrepresented.",
        agency: "FTC",
      },
      {
        title: "OFAC & Cash Reporting (IRS Form 8300)",
        body:
          "Cash payments over $10,000 must be reported to the IRS on Form 8300. " +
          "Dealers must also screen against OFAC's specially designated " +
          "nationals list.",
        agency: "IRS / U.S. Treasury (OFAC)",
      },
    ],
    general: [
      {
        title: "Business Registration & EIN",
        body:
          "Register the entity (LLC/Corp/DBA) with the Secretary of State and " +
          "obtain a federal EIN from the IRS.",
        agency: "IRS / Secretary of State",
      },
      {
        title: "ADA — Website & Premises Accessibility",
        body:
          "Public-facing businesses should make their website and physical " +
          "location accessible to people with disabilities (WCAG is the de " +
          "facto web standard).",
        agency: "U.S. Department of Justice",
      },
      {
        title: "Privacy Policy & Data Handling",
        body:
          "If you collect personal information online you should publish a " +
          "privacy policy and honor applicable state privacy rights.",
        agency: "FTC / State AGs",
      },
    ],
  };

  /* ---------------------------------------------------------------------------
   * PER-STATE.  Each record:
   *   name, regulator (who licenses dealers / oversees auto finance),
   *   dealerLicense, salesTax, docFee, coolingOff, retailInstallment,
   *   usury, gap, refinance, keyDisclosures[], sources[], verified:false
   * Values are baseline/commonly-cited and MUST be verified.
   * ------------------------------------------------------------------------- */
  function st(o) {
    o.verified = false;
    o.keyDisclosures = o.keyDisclosures || [];
    o.sources = o.sources || [];
    return o;
  }

  var NO_COOLING =
    "No statutory right to cancel a vehicle purchase once signed. The federal " +
    "3-day 'cooling-off' rule does NOT apply to vehicles bought at a dealership.";
  var DMV_SRC = "State DMV / motor-vehicle dealer regulator";

  var STATES = {
    AL: st({ name: "Alabama", regulator: "AL Dept. of Revenue – Motor Vehicle Division; AL Auto Dealers", dealerLicense: "State dealer license + bond required.", salesTax: "State + local sales tax due at titling.", docFee: "No statutory cap; must be disclosed.", coolingOff: NO_COOLING, retailInstallment: "Mini-Code / Retail Installment Sales governs finance charges.", usury: "Statutory limits apply; many auto contracts fall under the Mini-Code.", gap: "GAP waivers permitted; must be disclosed and refundable on early payoff.", refinance: "Refinancing a balance must re-disclose TILA terms; check for prepayment treatment.", sources: [DMV_SRC] }),
    AK: st({ name: "Alaska", regulator: "AK Division of Motor Vehicles", dealerLicense: "Dealer license + bond required.", salesTax: "No state sales tax; some boroughs/cities levy local tax.", docFee: "No statutory cap; must be disclosed.", coolingOff: NO_COOLING, retailInstallment: "Retail installment contracts regulated by state statute.", usury: "Statutory usury limits with exceptions for licensed lenders.", gap: "GAP permitted; disclose and refund unearned portion on payoff.", refinance: "Re-disclose TILA terms on refinance.", sources: [DMV_SRC] }),
    AZ: st({ name: "Arizona", regulator: "AZ Dept. of Transportation (ADOT) MVD – Dealer Licensing", dealerLicense: "Motor vehicle dealer license + bond required.", salesTax: "Transaction privilege tax (TPT) applies.", docFee: "No statutory cap; commonly itemized as a 'doc fee' and must be disclosed.", coolingOff: NO_COOLING, retailInstallment: "Motor Vehicle Time Sales Disclosure Act governs installment sales.", usury: "Parties may generally agree to a rate; licensed-lender exceptions.", gap: "GAP permitted; refundable.", refinance: "Re-disclose under TILA; watch doc-fee re-charge rules.", sources: [DMV_SRC] }),
    AR: st({ name: "Arkansas", regulator: "AR DFA – Motor Vehicle; AR Motor Vehicle Commission", dealerLicense: "Dealer license + bond required.", salesTax: "State + local sales tax due at registration.", docFee: "Must be disclosed; historically capped/limited — verify current amount.", coolingOff: NO_COOLING, retailInstallment: "Retail installment statute governs charges.", usury: "Arkansas has a constitutional usury cap (consumer loans) — important; verify applicability to auto sales finance.", gap: "GAP permitted; refundable.", refinance: "Usury cap makes refinance rate review especially important.", sources: [DMV_SRC] }),
    CA: st({ name: "California", regulator: "CA DMV Occupational Licensing; financing oversight by DFPI", dealerLicense: "Dealer license, bond, and seller-finance considerations.", salesTax: "Sales/use tax due; rate varies by district.", docFee: "Document processing fee is statutorily capped (commonly cited around $85 — verify current cap).", coolingOff: "Used cars under a price threshold: dealer must OFFER a 2-day cancellation option for an additional fee (the 'Car Buyer's Bill of Rights'). No automatic free cancellation.", retailInstallment: "Automobile Sales Finance Act (Rees-Levering) — strict single-document contract & disclosure rules.", usury: "Constitutional usury cap with broad licensed-lender exemptions.", gap: "GAP permitted; refundable; specific disclosure rules.", refinance: "Rees-Levering re-disclosure; single-document rule applies.", keyDisclosures: ["2-day cancellation option offer (used)", "Rees-Levering itemized contract"], sources: [DMV_SRC, "CA DFPI"] }),
    CO: st({ name: "Colorado", regulator: "CO Dept. of Revenue – Auto Industry Division", dealerLicense: "Dealer license + bond required.", salesTax: "State + local/home-rule sales tax.", docFee: "Capped by statute (a 'dealer handling/doc fee' limit) — verify current amount.", coolingOff: NO_COOLING, retailInstallment: "Uniform Consumer Credit Code (UCCC) governs consumer auto finance.", usury: "UCCC sets finance-charge limits for consumer credit.", gap: "GAP permitted under UCCC; refundable.", refinance: "UCCC refinancing rules and re-disclosure apply.", sources: [DMV_SRC] }),
    CT: st({ name: "Connecticut", regulator: "CT DMV – Dealers & Repairers", dealerLicense: "Dealer/repairer license + bond required.", salesTax: "State sales tax (higher luxury rate above a price threshold).", docFee: "'Conveyance/processing fee' is capped by statute — verify current amount.", coolingOff: NO_COOLING, retailInstallment: "Retail Installment Sales Financing Act governs charges & disclosures.", usury: "Statutory caps with licensed-lender exceptions.", gap: "GAP permitted; refundable.", refinance: "Re-disclose under state RISFA + TILA.", sources: [DMV_SRC] }),
    DE: st({ name: "Delaware", regulator: "DE Division of Motor Vehicles", dealerLicense: "Dealer license + bond required.", salesTax: "No sales tax, but a documentary fee (a percentage of price) applies in lieu of sales tax at titling.", docFee: "State document fee is a set percentage of vehicle price (separate from any dealer doc fee).", coolingOff: NO_COOLING, retailInstallment: "Retail installment contracts regulated by statute.", usury: "Delaware is lender-friendly; many rate limits are waivable for licensed lenders.", gap: "GAP permitted; refundable.", refinance: "Re-disclose TILA terms.", sources: [DMV_SRC] }),
    FL: st({ name: "Florida", regulator: "FL Dept. of Highway Safety & Motor Vehicles (DHSMV)", dealerLicense: "Motor vehicle dealer license + garage liability insurance + bond.", salesTax: "6% state + discretionary county surtax (capped portion).", docFee: "No statutory cap on dealer fee, but it MUST be disclosed and a state-mandated notice that the fee is not a government charge is required.", coolingOff: NO_COOLING, retailInstallment: "Motor Vehicle Retail Sales Finance Act governs installment contracts.", usury: "Statutory usury caps with finance-company exceptions.", gap: "GAP permitted; refundable.", refinance: "Re-disclose; dealer-fee notice rules apply.", keyDisclosures: ["Dealer fee 'not a government charge' notice"], sources: [DMV_SRC] }),
    GA: st({ name: "Georgia", regulator: "GA Board of Registration of Used Motor Vehicle Dealers; GA DOR", dealerLicense: "Used-car dealer license + bond required.", salesTax: "Title Ad Valorem Tax (TAVT) one-time at titling instead of annual sales tax.", docFee: "No statutory cap; must be disclosed.", coolingOff: NO_COOLING, retailInstallment: "Georgia Motor Vehicle Sales Finance Act governs charges.", usury: "Statutory caps; finance-charge limits under the MVSFA.", gap: "GAP permitted; refundable.", refinance: "Re-disclose under MVSFA + TILA.", sources: [DMV_SRC] }),
    HI: st({ name: "Hawaii", regulator: "HI DCCA; county vehicle registration", dealerLicense: "Dealer license + bond required.", salesTax: "General Excise Tax (GET) applies (passed through to buyer).", docFee: "No statutory cap; must be disclosed.", coolingOff: NO_COOLING, retailInstallment: "Retail installment statute governs disclosures.", usury: "Statutory caps with exceptions.", gap: "GAP permitted; refundable.", refinance: "Re-disclose TILA terms.", sources: [DMV_SRC] }),
    ID: st({ name: "Idaho", regulator: "Idaho Transportation Dept. – Dealer Licensing", dealerLicense: "Dealer license + bond required.", salesTax: "State + local sales tax.", docFee: "No statutory cap; must be disclosed.", coolingOff: NO_COOLING, retailInstallment: "Retail installment sales act governs charges.", usury: "Largely freedom-of-contract for licensed credit.", gap: "GAP permitted; refundable.", refinance: "Re-disclose TILA terms.", sources: [DMV_SRC] }),
    IL: st({ name: "Illinois", regulator: "IL Secretary of State – Vehicle Services", dealerLicense: "Dealer license + bond required.", salesTax: "State + local; trade-in credit partially capped.", docFee: "Documentary fee is statutorily capped and adjusted annually for inflation — verify the current year's amount.", coolingOff: NO_COOLING, retailInstallment: "Motor Vehicle Retail Installment Sales Act governs charges & disclosures.", usury: "Caps with licensed-lender exceptions.", gap: "GAP permitted; refundable.", refinance: "Re-disclose under MVRISA + TILA.", sources: [DMV_SRC] }),
    IN: st({ name: "Indiana", regulator: "IN Bureau of Motor Vehicles – Dealer Services", dealerLicense: "Dealer license + bond required.", salesTax: "7% state sales tax.", docFee: "Document preparation fee is capped by statute — verify current amount.", coolingOff: NO_COOLING, retailInstallment: "Uniform Consumer Credit Code (UCCC) governs consumer auto finance.", usury: "UCCC finance-charge limits.", gap: "GAP permitted; refundable.", refinance: "UCCC refinancing & re-disclosure rules.", sources: [DMV_SRC] }),
    IA: st({ name: "Iowa", regulator: "Iowa DOT – Motor Vehicle Division", dealerLicense: "Dealer license + bond required.", salesTax: "One-time registration fee/'fee for new registration' instead of standard sales tax.", docFee: "Documentary fee is capped by statute — verify current amount.", coolingOff: NO_COOLING, retailInstallment: "Iowa consumer credit code governs installment sales.", usury: "Statutory caps with exceptions.", gap: "GAP permitted; refundable.", refinance: "Re-disclose terms.", sources: [DMV_SRC] }),
    KS: st({ name: "Kansas", regulator: "KS Dept. of Revenue – Division of Vehicles", dealerLicense: "Dealer license + bond required.", salesTax: "State + local sales tax.", docFee: "No statutory cap; must be disclosed.", coolingOff: NO_COOLING, retailInstallment: "Uniform Consumer Credit Code (UCCC) governs.", usury: "UCCC finance-charge limits.", gap: "GAP permitted; refundable.", refinance: "UCCC refinancing rules.", sources: [DMV_SRC] }),
    KY: st({ name: "Kentucky", regulator: "KY Motor Vehicle Commission", dealerLicense: "Dealer license + bond required.", salesTax: "Motor vehicle usage tax at titling.", docFee: "No statutory cap; must be disclosed.", coolingOff: NO_COOLING, retailInstallment: "Retail installment statute governs charges.", usury: "Statutory caps with exceptions.", gap: "GAP permitted; refundable.", refinance: "Re-disclose TILA terms.", sources: [DMV_SRC] }),
    LA: st({ name: "Louisiana", regulator: "LA Motor Vehicle Commission; Used Motor Vehicle Commission", dealerLicense: "Dealer license + bond required.", salesTax: "State + local/parish sales tax.", docFee: "Documentary/'service' fee is capped by commission rule — verify current amount.", coolingOff: NO_COOLING, retailInstallment: "Motor Vehicle Sales Finance Act governs charges.", usury: "Statutory caps; finance-charge limits under MVSFA.", gap: "GAP permitted; refundable.", refinance: "Re-disclose under MVSFA + TILA.", sources: [DMV_SRC] }),
    ME: st({ name: "Maine", regulator: "ME Bureau of Motor Vehicles", dealerLicense: "Dealer license + bond required.", salesTax: "5.5% sales tax + annual excise to municipality.", docFee: "No statutory cap; must be disclosed.", coolingOff: NO_COOLING, retailInstallment: "Maine Consumer Credit Code governs auto finance.", usury: "Consumer Credit Code finance-charge limits.", gap: "GAP permitted; refundable.", refinance: "Consumer Credit Code refinancing rules.", sources: [DMV_SRC] }),
    MD: st({ name: "Maryland", regulator: "MD MVA – Dealer Licensing", dealerLicense: "Dealer license + bond required.", salesTax: "Vehicle excise tax (titling) instead of standard sales tax.", docFee: "Processing/'dealer processing charge' is capped by statute — verify current amount.", coolingOff: NO_COOLING, retailInstallment: "Maryland Credit Grantor / retail installment statutes govern.", usury: "Statutory caps; several elective credit-grantor subtitles.", gap: "GAP permitted; refundable.", refinance: "Re-disclose under elected credit subtitle + TILA.", sources: [DMV_SRC] }),
    MA: st({ name: "Massachusetts", regulator: "MA RMV; local licensing authority (Class 1/2/3 dealer license)", dealerLicense: "Municipal dealer license (Class 1/2/3) + bond.", salesTax: "6.25% sales tax (on greater of price or NADA value for some sales).", docFee: "'Documentary preparation fee' must be disclosed; cap rules — verify.", coolingOff: NO_COOLING, retailInstallment: "Retail Installment Sales Act governs charges.", usury: "Criminal usury cap (with notice exceptions) and Lemon laws are strong.", gap: "GAP permitted; refundable.", refinance: "Re-disclose under RISA + TILA.", sources: [DMV_SRC] }),
    MI: st({ name: "Michigan", regulator: "MI Secretary of State – Dealer Licensing", dealerLicense: "Dealer license + bond required.", salesTax: "6% sales tax; trade-in credit phased/capped.", docFee: "Documentary/'doc prep' fee capped by statute (a fixed amount or a percentage, adjusted) — verify current amount.", coolingOff: NO_COOLING, retailInstallment: "Motor Vehicle Sales Finance Act governs charges.", usury: "Statutory caps with finance-company exceptions.", gap: "GAP permitted; refundable.", refinance: "Re-disclose under MVSFA + TILA.", sources: [DMV_SRC] }),
    MN: st({ name: "Minnesota", regulator: "MN Driver & Vehicle Services (DVS) – Dealer Unit", dealerLicense: "Dealer license + bond required.", salesTax: "Motor vehicle sales tax at titling.", docFee: "Documentary/'administrative' fee is capped by statute — verify current amount.", coolingOff: NO_COOLING, retailInstallment: "Motor Vehicle Retail Installment Sales Act governs charges.", usury: "Statutory caps with exceptions.", gap: "GAP permitted; refundable.", refinance: "Re-disclose under MVRISA + TILA.", sources: [DMV_SRC] }),
    MS: st({ name: "Mississippi", regulator: "MS Motor Vehicle Commission; MS DOR", dealerLicense: "Dealer license + bond required.", salesTax: "Reduced motor-vehicle sales/use tax rate applies.", docFee: "No statutory cap; must be disclosed.", coolingOff: NO_COOLING, retailInstallment: "Motor Vehicle Sales Finance Law governs charges.", usury: "Statutory caps with exceptions.", gap: "GAP permitted; refundable.", refinance: "Re-disclose under state law + TILA.", sources: [DMV_SRC] }),
    MO: st({ name: "Missouri", regulator: "MO Dept. of Revenue – Motor Vehicle Bureau", dealerLicense: "Dealer license + bond required.", salesTax: "State + local; titled at license office.", docFee: "Administrative/'doc' fee capped by statute (adjusted) — verify current amount.", coolingOff: NO_COOLING, retailInstallment: "Retail installment statute governs charges.", usury: "Statutory caps with exceptions.", gap: "GAP permitted; refundable.", refinance: "Re-disclose TILA terms.", sources: [DMV_SRC] }),
    MT: st({ name: "Montana", regulator: "MT Motor Vehicle Division", dealerLicense: "Dealer license + bond required.", salesTax: "No general state sales tax (luxury/'light vehicle' fees may apply).", docFee: "No statutory cap; must be disclosed.", coolingOff: NO_COOLING, retailInstallment: "Retail installment statute governs charges.", usury: "Statutory caps with exceptions.", gap: "GAP permitted; refundable.", refinance: "Re-disclose TILA terms.", sources: [DMV_SRC] }),
    NE: st({ name: "Nebraska", regulator: "NE Motor Vehicle Industry Licensing Board", dealerLicense: "Dealer license + bond required.", salesTax: "State + local sales tax.", docFee: "Documentary fee is capped by statute — verify current amount.", coolingOff: NO_COOLING, retailInstallment: "Installment Sales Act governs charges.", usury: "Statutory caps with exceptions.", gap: "GAP permitted; refundable.", refinance: "Re-disclose TILA terms.", sources: [DMV_SRC] }),
    NV: st({ name: "Nevada", regulator: "NV DMV – Occupational & Business Licensing", dealerLicense: "Dealer license + bond required.", salesTax: "State + local sales tax.", docFee: "Documentary fee is capped by statute (adjusted) — verify current amount.", coolingOff: NO_COOLING, retailInstallment: "Retail installment statute governs charges.", usury: "Largely freedom-of-contract for licensed credit.", gap: "GAP permitted; refundable.", refinance: "Re-disclose TILA terms.", sources: [DMV_SRC] }),
    NH: st({ name: "New Hampshire", regulator: "NH DMV – Dealer Licensing", dealerLicense: "Dealer license + bond required.", salesTax: "No state sales tax.", docFee: "No statutory cap; must be disclosed.", coolingOff: NO_COOLING, retailInstallment: "Retail installment statute governs charges.", usury: "Statutory caps with exceptions.", gap: "GAP permitted; refundable.", refinance: "Re-disclose TILA terms.", sources: [DMV_SRC] }),
    NJ: st({ name: "New Jersey", regulator: "NJ Motor Vehicle Commission", dealerLicense: "Dealer license + bond required.", salesTax: "6.625% sales tax (luxury surcharge above a threshold).", docFee: "Documentary service fee must be disclosed; advertised/quoted-price rules are strict — verify cap.", coolingOff: NO_COOLING, retailInstallment: "Retail Installment Sales Act governs charges.", usury: "Statutory caps; strong consumer-fraud act.", gap: "GAP permitted; refundable.", refinance: "Re-disclose under RISA + TILA.", sources: [DMV_SRC] }),
    NM: st({ name: "New Mexico", regulator: "NM Motor Vehicle Division (TRD)", dealerLicense: "Dealer license + bond required.", salesTax: "Motor vehicle excise tax at titling.", docFee: "No statutory cap; must be disclosed.", coolingOff: NO_COOLING, retailInstallment: "Retail installment statute governs charges.", usury: "Statutory caps with exceptions.", gap: "GAP permitted; refundable.", refinance: "Re-disclose TILA terms.", sources: [DMV_SRC] }),
    NY: st({ name: "New York", regulator: "NY DMV – Vehicle Safety / Dealer Registration", dealerLicense: "Dealer registration + bond required.", salesTax: "State + local sales tax.", docFee: "Document preparation fee is statutorily capped (commonly cited at $175 — verify current cap).", coolingOff: NO_COOLING, retailInstallment: "Motor Vehicle Retail Instalment Sales Act governs charges & disclosures.", usury: "Civil & criminal usury caps (with licensed-lender exceptions).", gap: "GAP permitted; refundable.", refinance: "Re-disclose under MVRISA + TILA.", keyDisclosures: ["Doc-fee cap notice"], sources: [DMV_SRC] }),
    NC: st({ name: "North Carolina", regulator: "NC DMV – License & Theft Bureau", dealerLicense: "Dealer license + bond required.", salesTax: "Highway-use tax at titling (instead of standard sales tax).", docFee: "Documentary/'administrative' fee is capped by statute — verify current amount.", coolingOff: NO_COOLING, retailInstallment: "Retail Installment Sales Act governs charges.", usury: "Statutory caps with exceptions.", gap: "GAP permitted; refundable.", refinance: "Re-disclose under RISA + TILA.", sources: [DMV_SRC] }),
    ND: st({ name: "North Dakota", regulator: "ND Dept. of Transportation – Dealer Licensing", dealerLicense: "Dealer license + bond required.", salesTax: "Motor vehicle excise tax at titling.", docFee: "No statutory cap; must be disclosed.", coolingOff: NO_COOLING, retailInstallment: "Retail installment statute governs charges.", usury: "Statutory caps with exceptions.", gap: "GAP permitted; refundable.", refinance: "Re-disclose TILA terms.", sources: [DMV_SRC] }),
    OH: st({ name: "Ohio", regulator: "OH BMV – Dealer Licensing", dealerLicense: "Dealer license + bond required.", salesTax: "State + county/transit sales tax.", docFee: "Documentary fee is capped (commonly the lesser of a percentage of price or a fixed amount, adjusted) — verify current cap.", coolingOff: NO_COOLING, retailInstallment: "Retail Installment Sales Act governs charges.", usury: "Statutory caps with exceptions.", gap: "GAP permitted; refundable.", refinance: "Re-disclose under RISA + TILA.", sources: [DMV_SRC] }),
    OK: st({ name: "Oklahoma", regulator: "OK Used Motor Vehicle & Parts Commission; Service OK", dealerLicense: "Dealer license + bond required.", salesTax: "Excise tax + applicable sales tax at registration.", docFee: "Documentary fee is capped by statute — verify current amount.", coolingOff: NO_COOLING, retailInstallment: "Uniform Consumer Credit Code (UCCC) governs.", usury: "UCCC finance-charge limits.", gap: "GAP permitted; refundable.", refinance: "UCCC refinancing rules.", sources: [DMV_SRC] }),
    OR: st({ name: "Oregon", regulator: "OR DMV – Dealer Program", dealerLicense: "Dealer license + bond required.", salesTax: "No general sales tax (privilege/use tax on some new-vehicle sales).", docFee: "Documentary/'integrator' fee is capped by statute (different caps for electronic vs paper title work) — verify current amounts.", coolingOff: NO_COOLING, retailInstallment: "Retail installment statute governs charges.", usury: "Statutory caps with exceptions.", gap: "GAP permitted; refundable.", refinance: "Re-disclose TILA terms.", sources: [DMV_SRC] }),
    PA: st({ name: "Pennsylvania", regulator: "PA State Board of Vehicle Manufacturers, Dealers & Salespersons", dealerLicense: "Dealer license + bond required.", salesTax: "6% state (+1% Allegheny, +2% Philadelphia).", docFee: "Documentary fee is capped by statute (adjusted) — verify current amount.", coolingOff: NO_COOLING, retailInstallment: "Motor Vehicle Sales Finance Act governs charges & licensing of installment sellers.", usury: "Statutory caps; MVSFA finance-charge limits.", gap: "GAP permitted; refundable.", refinance: "Re-disclose under MVSFA + TILA.", sources: [DMV_SRC] }),
    RI: st({ name: "Rhode Island", regulator: "RI DMV – Dealers' License & Regulations Office", dealerLicense: "Dealer license + bond required.", salesTax: "7% sales tax.", docFee: "Documentary/'preparation' fee must be disclosed; cap rules — verify.", coolingOff: NO_COOLING, retailInstallment: "Retail Installment Sales Act governs charges.", usury: "Statutory caps with exceptions.", gap: "GAP permitted; refundable.", refinance: "Re-disclose under RISA + TILA.", sources: [DMV_SRC] }),
    SC: st({ name: "South Carolina", regulator: "SC DMV – Dealer Licensing", dealerLicense: "Dealer license + bond required.", salesTax: "Capped infrastructure-maintenance fee (max amount) instead of standard sales tax.", docFee: "Closing/'documentary' fee must be filed with the state and disclosed — verify current rules.", coolingOff: NO_COOLING, retailInstallment: "Consumer Protection Code governs auto finance.", usury: "Consumer Protection Code; max-rate filing for licensed lenders.", gap: "GAP permitted; refundable.", refinance: "Re-disclose under Consumer Protection Code + TILA.", keyDisclosures: ["Closing-fee filing/disclosure"], sources: [DMV_SRC] }),
    SD: st({ name: "South Dakota", regulator: "SD Dept. of Revenue – Motor Vehicle Division", dealerLicense: "Dealer license + bond required.", salesTax: "Motor vehicle excise tax at titling.", docFee: "No statutory cap; must be disclosed.", coolingOff: NO_COOLING, retailInstallment: "Retail installment statute governs charges.", usury: "Largely freedom-of-contract for licensed credit.", gap: "GAP permitted; refundable.", refinance: "Re-disclose TILA terms.", sources: [DMV_SRC] }),
    TN: st({ name: "Tennessee", regulator: "TN Motor Vehicle Commission", dealerLicense: "Dealer license + bond required.", salesTax: "State + local sales tax (single-article local cap).", docFee: "Documentary/'customer service' fee must be disclosed; cap rules — verify.", coolingOff: NO_COOLING, retailInstallment: "Retail installment statute governs charges.", usury: "Statutory caps tied to a formula rate.", gap: "GAP permitted; refundable.", refinance: "Re-disclose TILA terms.", sources: [DMV_SRC] }),
    TX: st({ name: "Texas", regulator: "TX DMV – Motor Vehicle Dealers; finance by OCCC", dealerLicense: "Dealer (GDN) license + bond required.", salesTax: "6.25% motor-vehicle sales/use tax.", docFee: "Documentary fee has no fixed statutory dollar cap but must be reasonable and FILED with the Office of Consumer Credit Commissioner (OCCC); amounts above the safe-harbor require justification.", coolingOff: NO_COOLING, retailInstallment: "Texas Finance Code Ch. 348 (Motor Vehicle Installment Sales) governs charges & the documentary-fee rules.", usury: "Finance Code rate ceilings; Ch. 348 add-on/scheduled-rate options.", gap: "GAP/debt-cancellation agreements permitted; refundable; specific TX disclosure rules.", refinance: "Re-disclose under Ch. 348 + TILA; doc-fee re-charge limited.", keyDisclosures: ["Documentary fee filed with OCCC", "Ch. 348 contract terms"], sources: [DMV_SRC, "TX OCCC"] }),
    UT: st({ name: "Utah", regulator: "UT State Tax Commission – Motor Vehicle Enforcement Division", dealerLicense: "Dealer license + bond required.", salesTax: "State + local sales tax.", docFee: "Documentary/'administrative' fee must be disclosed; cap rules — verify.", coolingOff: NO_COOLING, retailInstallment: "Retail installment statute governs charges.", usury: "Largely freedom-of-contract for licensed credit.", gap: "GAP permitted; refundable.", refinance: "Re-disclose TILA terms.", sources: [DMV_SRC] }),
    VT: st({ name: "Vermont", regulator: "VT DMV", dealerLicense: "Dealer license + bond required.", salesTax: "Purchase & use tax at titling.", docFee: "Documentary fee must be disclosed; cap rules — verify.", coolingOff: NO_COOLING, retailInstallment: "Retail installment statute governs charges.", usury: "Statutory caps with exceptions.", gap: "GAP permitted; refundable.", refinance: "Re-disclose TILA terms.", sources: [DMV_SRC] }),
    VA: st({ name: "Virginia", regulator: "VA Motor Vehicle Dealer Board (MVDB)", dealerLicense: "Dealer license (MVDB) + bond required.", salesTax: "Motor vehicle sales/use tax (SUT) at titling.", docFee: "Processing fee is capped by statute and must be disclosed (a maximum dollar amount) — verify current cap.", coolingOff: NO_COOLING, retailInstallment: "Retail installment statute governs charges.", usury: "Statutory caps with finance-company exceptions.", gap: "GAP permitted; refundable.", refinance: "Re-disclose TILA terms; processing-fee re-charge limited.", keyDisclosures: ["Processing-fee cap disclosure"], sources: [DMV_SRC] }),
    WA: st({ name: "Washington", regulator: "WA Dept. of Licensing – Dealer & Manufacturer Services", dealerLicense: "Dealer license + bond required.", salesTax: "State + local sales tax (motor-vehicle rate adds a small surtax).", docFee: "Documentary service ('negotiable doc') fee is capped by statute (adjusted) and must be disclosed as negotiable — verify current cap.", coolingOff: NO_COOLING, retailInstallment: "Retail Installment Sales of Goods / RCW governs charges.", usury: "Statutory caps with exceptions.", gap: "GAP permitted; refundable.", refinance: "Re-disclose under RCW + TILA.", keyDisclosures: ["Doc fee disclosed as negotiable"], sources: [DMV_SRC] }),
    WV: st({ name: "West Virginia", regulator: "WV DMV – Dealer Services", dealerLicense: "Dealer license + bond required.", salesTax: "Privilege/title tax at titling.", docFee: "Documentary fee must be disclosed; cap rules — verify.", coolingOff: NO_COOLING, retailInstallment: "Consumer Credit & Protection Act governs auto finance.", usury: "Consumer Credit & Protection Act finance-charge limits.", gap: "GAP permitted; refundable.", refinance: "Re-disclose under CCPA + TILA.", sources: [DMV_SRC] }),
    WI: st({ name: "Wisconsin", regulator: "WI Dept. of Transportation – Dealer & Agent Section", dealerLicense: "Dealer license + bond required.", salesTax: "5% state + county/stadium sales tax.", docFee: "'Service fee' must be disclosed; not a government fee — verify cap rules.", coolingOff: NO_COOLING, retailInstallment: "Wisconsin Consumer Act governs consumer auto finance (strong consumer protections).", usury: "Wisconsin Consumer Act finance-charge limits & remedies.", gap: "GAP permitted; refundable.", refinance: "WI Consumer Act refinancing & re-disclosure rules.", sources: [DMV_SRC] }),
    WY: st({ name: "Wyoming", regulator: "WY Dept. of Transportation – Motor Vehicle Services", dealerLicense: "Dealer license + bond required.", salesTax: "State + county sales/use tax at registration.", docFee: "No statutory cap; must be disclosed.", coolingOff: NO_COOLING, retailInstallment: "Uniform Consumer Credit Code (UCCC) governs.", usury: "UCCC finance-charge limits.", gap: "GAP permitted; refundable.", refinance: "UCCC refinancing rules.", sources: [DMV_SRC] }),
    DC: st({ name: "District of Columbia", regulator: "DC DMV – Vehicle Dealer Licensing; DC DLCP", dealerLicense: "Dealer license + bond required.", salesTax: "Vehicle excise tax (by weight/efficiency) at titling.", docFee: "Documentary fee must be disclosed; cap rules — verify.", coolingOff: NO_COOLING, retailInstallment: "Retail installment statute governs charges.", usury: "Statutory caps with exceptions.", gap: "GAP permitted; refundable.", refinance: "Re-disclose TILA terms.", sources: [DMV_SRC] }),
  };

  /* ---------------------------------------------------------------------------
   * API
   * ------------------------------------------------------------------------- */
  function esc(s) {
    return String(s == null ? "" : s)
      .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  function listStates() {
    return Object.keys(STATES)
      .map(function (c) { return { code: c, name: STATES[c].name }; })
      .sort(function (a, b) { return a.name < b.name ? -1 : 1; });
  }

  // Merge any dealer-saved overrides (from the dashboard) onto the baseline.
  function withOverrides(rec, code, overrides) {
    if (!overrides || !overrides[code]) return rec;
    var o = overrides[code], out = {};
    for (var k in rec) out[k] = rec[k];
    for (var j in o) out[j] = o[j];
    return out;
  }

  function get(code, industry, overrides) {
    code = String(code || "").toUpperCase();
    var rec = STATES[code];
    if (!rec) return null;
    rec = withOverrides(rec, code, overrides);
    return {
      code: code,
      industry: industry || "autoSales",
      state: rec,
      federal: industry === "general" ? FEDERAL.general : FEDERAL.autoFinance,
      meta: META,
    };
  }

  var STATE_FIELDS = [
    ["dealerLicense", "Dealer licensing"],
    ["salesTax", "Sales / titling tax"],
    ["docFee", "Documentary / processing fee"],
    ["coolingOff", "Right to cancel (cooling-off)"],
    ["retailInstallment", "Retail-installment / finance law"],
    ["usury", "Interest-rate (usury) limits"],
    ["gap", "GAP / debt-cancellation"],
    ["refinance", "Refinancing"],
  ];

  // Render a self-contained HTML block. opts: { heading, light }
  function render(code, industry, opts) {
    opts = opts || {};
    var data = get(code, industry, opts.overrides);
    if (!data) return '<div class="sr-box">State requirements unavailable.</div>';
    var s = data.state, parts = [];
    var head = opts.heading || (s.name + " — Auto Sales & Financing Requirements");

    parts.push('<section class="sr-box" data-state="' + esc(code) + '">');
    parts.push('<h3 class="sr-h">' + esc(head) + '</h3>');
    if (s.regulator)
      parts.push('<p class="sr-reg"><strong>State regulator:</strong> ' + esc(s.regulator) + '</p>');

    parts.push('<div class="sr-grid">');
    STATE_FIELDS.forEach(function (f) {
      var v = s[f[0]];
      if (!v) return;
      parts.push(
        '<div class="sr-item"><div class="sr-k">' + esc(f[1]) +
        '</div><div class="sr-v">' + esc(v) + "</div></div>"
      );
    });
    parts.push("</div>");

    if (s.keyDisclosures && s.keyDisclosures.length) {
      parts.push('<div class="sr-tags">');
      s.keyDisclosures.forEach(function (d) {
        parts.push('<span class="sr-tag">' + esc(d) + "</span>");
      });
      parts.push("</div>");
    }

    parts.push('<h4 class="sr-h4">Federal requirements (apply nationwide)</h4>');
    parts.push('<div class="sr-fed">');
    data.federal.forEach(function (f) {
      parts.push(
        '<details class="sr-fitem"><summary>' + esc(f.title) +
        (f.agency ? ' <em>· ' + esc(f.agency) + "</em>" : "") +
        '</summary><p>' + esc(f.body) + "</p></details>"
      );
    });
    parts.push("</div>");

    parts.push(
      '<p class="sr-disc"><strong>Disclaimer:</strong> ' + esc(META.disclaimer) +
      ' Last organized ' + esc(META.updated) +
      '. This baseline has not been verified by counsel.</p>'
    );
    parts.push("</section>");
    return parts.join("");
  }

  // Self-contained CSS for the rendered block. Exposed as a string so generated
  // standalone sites can inline it (no external stylesheet dependency).
  var SR_CSS =
    ".sr-box{--sr-fg:#e9e7ef;--sr-mut:#a7a4b3;--sr-acc:#ff8366;--sr-bd:rgba(255,255,255,.12);" +
    "max-width:1000px;margin:0 auto;padding:28px 20px;color:var(--sr-fg);font:15px/1.6 system-ui,sans-serif}" +
    ".sr-h{font-size:clamp(22px,4vw,30px);margin:0 0 6px}.sr-reg{color:var(--sr-mut);margin:0 0 18px}" +
    ".sr-grid{display:grid;gap:14px;grid-template-columns:repeat(auto-fit,minmax(260px,1fr))}" +
    ".sr-item{border:1px solid var(--sr-bd);border-radius:12px;padding:14px 16px;background:rgba(255,255,255,.03)}" +
    ".sr-k{font-weight:700;color:var(--sr-acc);font-size:13px;text-transform:uppercase;letter-spacing:.04em;margin-bottom:6px}" +
    ".sr-v{color:var(--sr-fg)}.sr-tags{margin:16px 0 0;display:flex;flex-wrap:wrap;gap:8px}" +
    ".sr-tag{border:1px solid var(--sr-acc);color:var(--sr-acc);border-radius:999px;padding:4px 12px;font-size:12px}" +
    ".sr-h4{margin:26px 0 10px;font-size:18px}.sr-fitem{border:1px solid var(--sr-bd);border-radius:10px;margin:8px 0;padding:10px 14px}" +
    ".sr-fitem summary{cursor:pointer;font-weight:600}.sr-fitem em{color:var(--sr-mut);font-style:normal;font-weight:400}" +
    ".sr-fitem p{color:var(--sr-mut);margin:8px 0 0}" +
    ".sr-disc{margin-top:22px;padding:14px 16px;border:1px dashed var(--sr-acc);border-radius:12px;color:var(--sr-mut);font-size:13px}";

  // Minimal default CSS injected once (generated sites can override via vars).
  function injectCSS() {
    if (typeof document === "undefined") return;
    if (document.getElementById("sr-css")) return;
    var css = document.createElement("style");
    css.id = "sr-css";
    css.textContent = SR_CSS;
    document.head.appendChild(css);
  }

  // Best-effort: pull a 2-letter state code from a free-text address/city string
  // ("Katy, TX 77450" -> "TX"; "Miami, Florida" -> "FL"). Returns "" if unsure.
  var NAME_TO_CODE = {};
  Object.keys(STATES).forEach(function (c) { NAME_TO_CODE[STATES[c].name.toLowerCase()] = c; });
  function codeFromText(text) {
    if (!text) return "";
    var t = String(text);
    var m = t.match(/,\s*([A-Za-z]{2})\b(?:\s+\d{5})?/);
    if (m && STATES[m[1].toUpperCase()]) return m[1].toUpperCase();
    var low = t.toLowerCase();
    for (var name in NAME_TO_CODE) {
      if (low.indexOf(name) !== -1) return NAME_TO_CODE[name];
    }
    var any = t.match(/\b([A-Za-z]{2})\b/g);
    if (any) for (var i = 0; i < any.length; i++) {
      var cc = any[i].toUpperCase();
      if (STATES[cc]) return cc;
    }
    return "";
  }

  var API = {
    meta: META,
    federal: FEDERAL,
    css: SR_CSS,
    get: get,
    states: listStates,
    render: render,
    injectCSS: injectCSS,
    codeFromText: codeFromText,
  };

  if (typeof window !== "undefined") {
    window.STATE_REQUIREMENTS = { meta: META, federal: FEDERAL, states: STATES };
    window.StateReq = API;
  }
  if (typeof module !== "undefined" && module.exports) module.exports = API;
})();
