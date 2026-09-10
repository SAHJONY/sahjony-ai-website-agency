// DESIGN SYSTEM — the token engine behind the house style.
//
// What this replaces: tokens were derived by adding a delta to raw RGB channels
// (with an unexplained x0.65 on green). That is not a hue rotation — it clipped,
// desaturated, and swung hue unpredictably: #1b2430 produced a near-black
// secondary (#000906) and a purple "accent" (#413d56) at 1.9:1 on the house
// background, which the quality engine correctly refuses to ship. The generator
// was manufacturing its own audit failures.
//
// Principles:
//   1. Work in HSL. Hue rotation rotates hue; lightness changes lightness.
//   2. A palette is not finished until it MEASURES as readable. createPalette
//      lifts colours until they clear WCAG AA against the surface they sit on,
//      so what the design system emits cannot fail the delivery audit.
//   3. Type, space, elevation and motion are scales, not magic numbers. Apple
//      and Tesla read as precise because every value is a step on a ratio.

import { contrastRatio, parseHex } from "./quality-engine.js";

/* ------------------------------- colour space ------------------------------- */

/** #rrggbb -> {h:0-360, s:0-100, l:0-100}. Null for invalid input. */
export function hexToHsl(hex) {
  const rgb = parseHex(hex);
  if (!rgb) return null;
  const [r, g, b] = rgb.map((v) => v / 255);
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const d = max - min;
  const l = (max + min) / 2;
  let h = 0;
  let s = 0;
  if (d !== 0) {
    s = d / (1 - Math.abs(2 * l - 1));
    if (max === r) h = ((g - b) / d) % 6;
    else if (max === g) h = (b - r) / d + 2;
    else h = (r - g) / d + 4;
    h *= 60;
    if (h < 0) h += 360;
  }
  return { h, s: s * 100, l: l * 100 };
}

/** {h,s,l} -> #rrggbb. Values are clamped, so callers can do open arithmetic. */
export function hslToHex(h, s, l) {
  const hue = ((h % 360) + 360) % 360;
  const sat = Math.min(100, Math.max(0, s)) / 100;
  const lum = Math.min(100, Math.max(0, l)) / 100;
  const c = (1 - Math.abs(2 * lum - 1)) * sat;
  const x = c * (1 - Math.abs(((hue / 60) % 2) - 1));
  const m = lum - c / 2;
  const seg = Math.floor(hue / 60) % 6;
  const rgb = [[c, x, 0], [x, c, 0], [0, c, x], [0, x, c], [x, 0, c], [c, 0, x]][seg];
  return "#" + rgb.map((v) => Math.round((v + m) * 255).toString(16).padStart(2, "0")).join("");
}

const withHsl = (hex, fn) => {
  const hsl = hexToHsl(hex);
  if (!hsl) return hex;
  const next = fn(hsl);
  return hslToHex(next.h, next.s, next.l);
};

/** Rotate hue by `deg`, preserving saturation and lightness. */
export const rotate = (hex, deg) => withHsl(hex, (c) => ({ ...c, h: c.h + deg }));
/** Move lightness by `amt` percentage points. */
export const lighten = (hex, amt) => withHsl(hex, (c) => ({ ...c, l: c.l + amt }));
/** Move saturation by `amt` percentage points. */
export const saturate = (hex, amt) => withHsl(hex, (c) => ({ ...c, s: c.s + amt }));

/**
 * Lift (or lower) a colour's lightness until it clears `target` contrast
 * against `bg`, keeping its hue and saturation. This is the guarantee that lets
 * the design system promise an accent that is always legible on the surface.
 */
export function ensureContrast(hex, bg, target = 4.5) {
  const hsl = hexToHsl(hex);
  if (!hsl) return hex;
  const bgLum = hexToHsl(bg);
  // On a dark surface we brighten; on a light surface we darken.
  const step = !bgLum || bgLum.l < 50 ? 2 : -2;
  let candidate = hex;
  for (let i = 0; i < 50; i++) {
    const ratio = contrastRatio(candidate, bg);
    if (ratio !== null && ratio >= target) return candidate;
    const next = hexToHsl(candidate);
    // Saturation is nudged up as we brighten so the colour keeps its identity
    // instead of washing out to a pale tint.
    candidate = hslToHex(next.h, Math.min(100, next.s + (step > 0 ? 0.6 : 0)), next.l + step);
    if (next.l + step >= 100 || next.l + step <= 0) break;
  }
  return candidate;
}

/* -------------------------------- palettes -------------------------------- */

export const HARMONIES = Object.freeze({
  // A single hue, separated by lightness. The most restrained, most "Apple".
  monochrome: [0, 0],
  // Neighbouring hues: rich but calm. The default for premium brands.
  analogous: [-28, 28],
  // Opposite hue for the secondary: high energy, used sparingly.
  complementary: [180, 30],
  // Even thirds: the most expressive option.
  triadic: [120, 240],
});

/**
 * Build a full, measured palette from one brand colour.
 * Every returned colour is guaranteed readable on `surface`, so a palette from
 * here cannot produce the "accent vanishes on near-black" audit failure.
 */
export function createPalette(brandHex, options = {}) {
  const surface = options.surface || "#0a0b0e";
  const harmony = HARMONIES[options.harmony] ? options.harmony : "analogous";
  const [shiftA, shiftB] = HARMONIES[harmony];
  const dark = (hexToHsl(surface) || { l: 5 }).l < 50;

  // A near-black or washed-out brand colour cannot serve as an accent on a dark
  // surface. Give it a usable floor BEFORE deriving anything from it, so the
  // whole palette is built on a colour that works.
  const seed = hexToHsl(brandHex) || hexToHsl("#2dd4bf");
  const viable = hslToHex(seed.h, Math.max(seed.s, 45), dark ? Math.max(seed.l, 55) : Math.min(seed.l, 45));

  const primary = ensureContrast(viable, surface, 4.5);
  const secondary = ensureContrast(harmony === "monochrome" ? lighten(primary, dark ? -18 : 18) : rotate(primary, shiftA), surface, 4.5);
  const tertiary = ensureContrast(harmony === "monochrome" ? lighten(primary, dark ? 16 : -16) : rotate(primary, shiftB), surface, 4.5);

  // Neutral ramp: tinted with a trace of the brand hue so greys feel designed
  // rather than default. Apple and Tesla both tint their greys.
  const h = (hexToHsl(primary) || { h: 180 }).h;
  const ramp = (dark ? [4, 9, 16, 28, 46, 66, 82, 94] : [98, 94, 88, 74, 56, 38, 20, 9]).map((l) => hslToHex(h, l > 70 ? 8 : 14, l));

  return {
    primary,
    secondary,
    tertiary,
    surface,
    // Text colours are lifted to AA against the surface by construction.
    text: ensureContrast(ramp[dark ? 7 : 0], surface, 7),
    textMuted: ensureContrast(ramp[dark ? 5 : 2], surface, 4.5),
    line: dark ? "rgba(255,255,255,.10)" : "rgba(0,0,0,.10)",
    glass: dark ? "rgba(255,255,255,.045)" : "rgba(255,255,255,.72)",
    onPrimary: contrastRatio("#000000", primary) >= contrastRatio("#ffffff", primary) ? "#000000" : "#ffffff",
    ramp,
    harmony,
  };
}

/* ---------------------------------- scales ---------------------------------- */

/**
 * A fluid modular type scale. Each step is a clamp() that interpolates between
 * a phone and a desktop viewport, so type scales continuously instead of
 * snapping at breakpoints.
 *
 * Optical tracking is the detail that reads as "Apple": letter-spacing tightens
 * as size grows (large text needs negative tracking; small text needs positive).
 */
export function typeScale(options = {}) {
  const ratio = options.ratio || 1.25;
  const base = options.base || 17;
  const steps = options.steps || [-1, 0, 1, 2, 3, 4, 5, 6];
  const minVw = 380;
  const maxVw = 1440;
  return steps.map((step) => {
    const max = base * Math.pow(ratio, step);
    // Small text shrinks little between viewports; display text shrinks a lot.
    const min = base * Math.pow(ratio, step * (step > 2 ? 0.58 : 0.86));
    const slope = ((max - min) / (maxVw - minVw)) * 100;
    const intercept = min - (slope * minVw) / 100;
    const tracking = max >= 48 ? -0.03 : max >= 28 ? -0.02 : max >= 20 ? -0.01 : max <= 13 ? 0.02 : 0;
    return {
      step,
      px: Math.round(max * 100) / 100,
      css: `clamp(${round(min)}px, ${round(intercept)}px + ${round(slope)}vw, ${round(max)}px)`,
      tracking: `${tracking}em`,
      leading: max >= 40 ? 1.02 : max >= 24 ? 1.15 : 1.6,
    };
  });
}

const round = (n) => Math.round(n * 100) / 100;

/** 8pt rhythm with a 4pt sub-step. Everything in the UI lands on this grid. */
export function spacingScale() {
  return [0, 4, 8, 12, 16, 24, 32, 48, 64, 96, 128, 192];
}

/**
 * Layered elevation. A single large blur reads as a cheap drop shadow; real
 * depth comes from stacking a tight contact shadow under a wide ambient one.
 */
export function elevation(level) {
  const specs = [
    "none",
    "0 1px 2px rgba(0,0,0,.28)",
    "0 2px 4px rgba(0,0,0,.24), 0 8px 16px -4px rgba(0,0,0,.32)",
    "0 4px 8px rgba(0,0,0,.22), 0 16px 32px -8px rgba(0,0,0,.38)",
    "0 8px 16px rgba(0,0,0,.20), 0 32px 64px -16px rgba(0,0,0,.46)",
  ];
  return specs[Math.min(specs.length - 1, Math.max(0, level))];
}

/** Physical easing. Nothing here bounces — premium motion decelerates. */
export const EASING = Object.freeze({
  standard: "cubic-bezier(.4,0,.2,1)",
  decelerate: "cubic-bezier(.16,1,.3,1)",
  accelerate: "cubic-bezier(.4,0,1,1)",
  spring: "cubic-bezier(.34,1.26,.64,1)",
});

export function motionScale(tempo = 1) {
  return {
    instant: Math.round(90 * tempo),
    fast: Math.round(180 * tempo),
    standard: Math.round(320 * tempo),
    slow: Math.round(620 * tempo),
    reveal: Math.round(900 * tempo),
    easing: EASING,
  };
}

/* -------------------------------- archetypes -------------------------------- */

/**
 * Layout archetypes. These are genuinely different page systems, not the same
 * layout with a different corner radius — they change section height, type
 * ratio, alignment, CTA placement, scroll behaviour and density.
 */
export const ARCHETYPES = Object.freeze({
  // APPLE: product-first editorial. Enormous centred type, vast whitespace, one
  // idea per full-viewport section, restrained monochrome with a single accent.
  editorial: {
    id: "editorial",
    label: "Editorial Product",
    inspiration: "Apple",
    headingFont: "Fraunces",
    bodyFont: "Inter",
    typeRatio: 1.33,
    baseSize: 17,
    harmony: "monochrome",
    radius: 18,
    tempo: 1.15,
    density: "airy",
    sectionMinHeight: "100vh",
    align: "center",
    ctaPlacement: "inline",
    scrollSnap: false,
    heroTreatment: "product-spotlight",
    maxWidth: 1180,
  },
  // TESLA: full-bleed monolithic panels. Image fills the viewport, a few words
  // sit low, a pair of pill CTAs anchors the bottom, sections snap as you scroll.
  monolith: {
    id: "monolith",
    label: "Monolith Panels",
    inspiration: "Tesla",
    headingFont: "Manrope",
    bodyFont: "DM Sans",
    typeRatio: 1.22,
    baseSize: 16,
    harmony: "monochrome",
    radius: 4,
    tempo: 0.8,
    density: "spare",
    sectionMinHeight: "100vh",
    align: "center-bottom",
    ctaPlacement: "anchored-pair",
    scrollSnap: true,
    heroTreatment: "full-bleed",
    maxWidth: 1440,
  },
  // The house cinematic style: immersive, saturated, high motion.
  cinematic: {
    id: "cinematic",
    label: "Cinematic Immersion",
    inspiration: "Obsidian-Vacuum",
    headingFont: "Syne",
    bodyFont: "Figtree",
    typeRatio: 1.28,
    baseSize: 16,
    harmony: "analogous",
    radius: 22,
    tempo: 1.3,
    density: "rich",
    sectionMinHeight: "88vh",
    align: "left",
    ctaPlacement: "inline",
    scrollSnap: false,
    heroTreatment: "gradient-immersion",
    maxWidth: 1280,
  },
});

/** Build the complete token set for an archetype from one brand colour. */
export function buildTokens(brandHex, archetypeId, options = {}) {
  const archetype = ARCHETYPES[archetypeId] || ARCHETYPES.cinematic;
  const palette = createPalette(brandHex, { surface: options.surface || "#0a0b0e", harmony: archetype.harmony });
  const type = typeScale({ ratio: archetype.typeRatio, base: archetype.baseSize });
  return {
    archetype: archetype.id,
    inspiration: archetype.inspiration,
    palette,
    type,
    spacing: spacingScale(),
    motion: motionScale(archetype.tempo),
    radius: archetype.radius,
    elevation: [0, 1, 2, 3, 4].map(elevation),
    layout: {
      maxWidth: archetype.maxWidth,
      sectionMinHeight: archetype.sectionMinHeight,
      align: archetype.align,
      ctaPlacement: archetype.ctaPlacement,
      scrollSnap: archetype.scrollSnap,
      heroTreatment: archetype.heroTreatment,
      density: archetype.density,
    },
    headingFont: archetype.headingFont,
    bodyFont: archetype.bodyFont,
    breakpoints: { mobile: 600, tablet: 820, desktop: 1180 },
  };
}

/** Emit the archetype's CSS custom properties — one block, no magic numbers. */
export function tokensToCss(tokens, selector = ".genroot") {
  const p = tokens.palette;
  const t = tokens.type;
  const vars = [
    `--surface:${p.surface}`, `--text:${p.text}`, `--muted:${p.textMuted}`,
    `--primary:${p.primary}`, `--secondary:${p.secondary}`, `--tertiary:${p.tertiary}`,
    `--on-primary:${p.onPrimary}`, `--line:${p.line}`, `--glass:${p.glass}`,
    `--radius:${tokens.radius}px`, `--max-w:${tokens.layout.maxWidth}px`,
    `--section-h:${tokens.layout.sectionMinHeight}`,
    `--ease:${tokens.motion.easing.decelerate}`,
    `--dur-fast:${tokens.motion.fast}ms`, `--dur:${tokens.motion.standard}ms`, `--dur-reveal:${tokens.motion.reveal}ms`,
    ...tokens.spacing.map((v, i) => `--space-${i}:${v}px`),
    ...t.map((s, i) => `--fs-${i}:${s.css}`),
    ...t.map((s, i) => `--tr-${i}:${s.tracking}`),
    ...t.map((s, i) => `--lh-${i}:${s.leading}`),
    ...tokens.elevation.map((v, i) => `--elev-${i}:${v}`),
  ];
  return `${selector}{${vars.join(";")}}`;
}

/* ------------------------------ archetype CSS ------------------------------ */

/**
 * Emit the stylesheet that makes an archetype look like itself.
 *
 * These rules override the shared cinematic markup (.cine-hero, .ccard, .gsec,
 * .cnav …), which is why they are written as overrides rather than a fresh
 * stylesheet: one HTML structure, three genuinely different design systems on
 * top of it. Scoped under `.arch-<id>` so concepts can be swapped live.
 */
export function archetypeCss(tokens) {
  const t = tokens;
  const p = t.palette;
  const scope = `.arch-${t.archetype}`;
  const display = t.type[t.type.length - 1];
  const h2 = t.type[t.type.length - 3];

  if (t.archetype === "editorial") {
    // APPLE: one idea per viewport, centred, enormous type, vast whitespace,
    // hairline separators, no glass. Restraint is the whole effect.
    return `
${scope} .gsec{padding:18vh 28px!important;max-width:var(--max-w);margin:0 auto}
${scope} .cine-hero{min-height:100vh;align-items:center!important}
${scope} .cine-hero-content{text-align:center!important;max-width:900px!important;margin:0 auto!important;padding:0 28px!important}
${scope} .cine-hero-content h1{font-size:${display.css}!important;letter-spacing:${display.tracking}!important;line-height:${display.leading}!important;font-weight:600!important}
${scope} .cine-hero-content p{font-size:var(--fs-3)!important;line-height:1.5!important;max-width:640px;margin-left:auto!important;margin-right:auto!important;color:rgba(255,255,255,.86)!important}
${scope} .cine-hero-actions{justify-content:center!important;gap:28px!important}
${scope} h2{font-size:${h2.css}!important;letter-spacing:${h2.tracking}!important;font-weight:600!important}
${scope} .ccard{background:transparent!important;border:0!important;border-top:1px solid var(--line)!important;border-radius:0!important;backdrop-filter:none!important;-webkit-backdrop-filter:none!important;padding:var(--space-6) 0!important;box-shadow:none!important}
${scope} .ccard:hover{transform:none!important;box-shadow:none!important;border-color:var(--line)!important}
${scope} .gphoto{border-radius:var(--radius);aspect-ratio:4/3}
${scope} .cbtnA{border-radius:999px;padding:15px 32px;font-weight:500;box-shadow:none}
/* The secondary action is a text link with a chevron, not a second button. */
${scope} .cbtnB{background:transparent!important;border:0!important;padding:15px 4px!important;color:var(--primary)!important;backdrop-filter:none!important}
${scope} .cbtnB::after{content:" ›";font-weight:400}
${scope} .cbtnB:hover{background:transparent!important;text-decoration:underline;text-underline-offset:5px}
${scope} .cnav{backdrop-filter:saturate(180%) blur(20px);-webkit-backdrop-filter:saturate(180%) blur(20px);background:rgba(10,11,14,.72)!important;border-bottom:1px solid var(--line)!important}
${scope} .cnav-link{font-size:13px;font-weight:400;opacity:.86}
${scope} .cine-panel-inner{max-width:820px}
${scope} .reveal{transform:translateY(18px);transition-duration:var(--dur-reveal)!important;transition-timing-function:var(--ease)!important}`;
  }

  if (t.archetype === "monolith") {
    // TESLA: full-viewport panels that snap, a few words low on the image, and
    // the signature pair of pill buttons anchored at the bottom of the hero.
    return `
${scope}{scroll-snap-type:y proximity}
${scope} .gsec,${scope} .cine-hero,${scope} .cine-panel{scroll-snap-align:start}
${scope} .gsec{padding:14vh 28px!important;max-width:var(--max-w);margin:0 auto}
${scope} .cine-hero{min-height:100vh;align-items:flex-end!important}
${scope} .cine-hero-content{text-align:center!important;max-width:1040px!important;margin:0 auto!important;padding:0 28px 16vh!important;background:none!important;border:0!important;backdrop-filter:none!important}
${scope} .cine-hero-content h1{font-size:${display.css}!important;letter-spacing:${display.tracking}!important;line-height:1.04!important;font-weight:600!important;text-shadow:0 2px 30px rgba(0,0,0,.45)}
${scope} .cine-hero-content p{font-size:var(--fs-2)!important;text-decoration:underline;text-underline-offset:4px;text-decoration-thickness:1px;opacity:.94}
/* The Tesla signature: two equal pills, side by side, pinned low. */
${scope} .cine-hero-actions{position:absolute;left:0;right:0;bottom:7vh;display:flex!important;gap:16px!important;justify-content:center!important;padding:0 24px}
${scope} .cine-hero-actions .cbtn{flex:0 1 260px;justify-content:center;text-align:center;border-radius:4px;padding:13px 22px;font-size:12.5px;font-weight:600;letter-spacing:.14em;text-transform:uppercase}
${scope} .cbtnA{background:rgba(255,255,255,.92)!important;color:#0a0b0e!important;box-shadow:none}
${scope} .cbtnB{background:rgba(24,26,32,.7)!important;color:#fff!important;border:0!important;backdrop-filter:blur(6px)}
${scope} .cbtnA:hover{background:#fff!important}
${scope} .cbtnB:hover{background:rgba(24,26,32,.92)!important}
${scope} h2{font-size:${h2.css}!important;letter-spacing:${h2.tracking}!important;font-weight:600!important;text-align:center}
${scope} .ccard{background:var(--glass)!important;border:1px solid var(--line)!important;border-radius:var(--radius)!important;box-shadow:none!important}
${scope} .ccard:hover{transform:none!important;border-color:rgba(255,255,255,.28)!important}
${scope} .gphoto{border-radius:2px;aspect-ratio:16/10}
${scope} .cnav{background:transparent!important;border-bottom:0!important}
${scope} .cnav-link{font-size:12px;font-weight:600;letter-spacing:.1em;text-transform:uppercase}
${scope} .cine-eyebrow{letter-spacing:.34em!important}
${scope} .reveal{transform:translateY(12px);transition-duration:var(--dur)!important}
@media(max-width:820px){
  ${scope} .cine-hero-actions{flex-direction:column;align-items:center;bottom:4vh}
  ${scope} .cine-hero-actions .cbtn{flex:0 0 auto;width:min(360px,100%)}
  ${scope} .cine-hero-content{padding-bottom:24vh!important}
}`;
  }

  // CINEMATIC: the immersive house style — left-anchored, glass, saturated wash.
  return `
${scope} .gsec{padding:14vh 28px!important;max-width:var(--max-w);margin:0 auto}
${scope} .cine-hero{min-height:100vh;align-items:flex-end!important}
${scope} .cine-hero-content{text-align:left!important;max-width:860px!important;margin:0 auto!important;padding:0 28px 13vh!important}
${scope} .cine-hero-content h1{font-size:${display.css}!important;letter-spacing:${display.tracking}!important;line-height:${display.leading}!important}
${scope} .cine-hero-content p{margin-left:0!important}
${scope} .cine-hero-actions{justify-content:flex-start!important}
${scope} h2{font-size:${h2.css}!important;letter-spacing:${h2.tracking}!important}
${scope} .ccard{background:var(--glass)!important;border:1px solid var(--line)!important;border-radius:var(--radius)!important;backdrop-filter:blur(16px);-webkit-backdrop-filter:blur(16px);box-shadow:var(--elev-2)!important}
${scope} .ccard:hover{transform:translateY(-6px)!important;box-shadow:var(--elev-4)!important}
${scope} .cbtnA{border-radius:999px;box-shadow:var(--elev-2)}
${scope} .cbtnB{border-radius:999px}
${scope} .gphoto{border-radius:var(--radius);aspect-ratio:1/1}
${scope} .reveal{transition-duration:var(--dur-reveal)!important;transition-timing-function:var(--ease)!important}`;
}

// Browser global, mirroring premium-factory.js — builder.html reads the system
// from here to emit the token block and the archetype stylesheet.
if (typeof window !== "undefined") {
  window.DesignSystem = { ARCHETYPES, HARMONIES, EASING, hexToHsl, hslToHex, rotate, lighten, saturate, ensureContrast, createPalette, typeScale, spacingScale, elevation, motionScale, buildTokens, tokensToCss, archetypeCss };
}
