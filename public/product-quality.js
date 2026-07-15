export const DELIVERY_STANDARD_VERSION = "1.0";
export const DELIVERY_READY_SCORE = 90;

function text(value) {
  return String(value == null ? "" : value).trim();
}

function list(value) {
  return Array.isArray(value) ? value : [];
}

function check(id, label, weight, pass, detail, blocking = false) {
  return { id, label, weight, pass: !!pass, detail, blocking: !!blocking };
}

/**
 * FrontDeskOS Delivery Standard.
 *
 * This deliberately audits only facts the builder can prove locally. It does
 * not claim that a Lighthouse run, a real phone call, or a payment succeeded;
 * those remain launch-verification tasks after deployment.
 */
export function assessProduct(input = {}) {
  const content = input.content || {};
  const media = input.media || {};
  const services = list(content.services).filter((item) => text(item && item.name));
  const photos = list(media.photos).filter((url) => text(url));
  const identityReady = !!text(input.name) && !!text(input.type);
  const copyReady = !!text(content.tagline) && !!text(content.heroSub)
    && !!text(content.about1) && !!text(content.about2);
  const servicesReady = services.length >= 3
    && services.every((item) => !!text(item.desc));
  const mediaReady = photos.length >= 1;
  const contactReady = !!text(input.phone) || !!text(input.email);
  const seoReady = text(content.heroSub).length >= 40
    && text(content.heroSub).length <= 180;
  const structureReady = list(content.faqs).length >= 3
    && list(content.labels && content.labels.nav).length >= 5;
  const factsReady = input.factsConfirmed === true;
  const originalReady = input.usedFallback !== true;

  const checks = [
    check("identity", "Brand identity", 10, identityReady,
      identityReady ? "Business name and industry are defined." : "Add the business name and industry.", true),
    check("copy", "Premium brand copy", 15, copyReady,
      copyReady ? "Hero and company story are complete." : "Regenerate or complete the hero and company story.", true),
    check("offerings", "Customer-ready offerings", 15, servicesReady,
      servicesReady ? `${services.length} clear offerings are included.` : "Add at least three named offerings with descriptions.", true),
    check("media", "Licensed or generated media", 15, mediaReady,
      mediaReady ? `${photos.length} source image${photos.length === 1 ? "" : "s"} attached.` : "Add or generate at least one approved hero image.", true),
    check("contact", "Working contact path", 15, contactReady,
      contactReady ? "A real phone number or email is present." : "Add a real phone number or email.", true),
    check("seo", "Search and social metadata", 10, seoReady,
      seoReady ? "The search description is complete." : "Use a specific 40–180 character hero description."),
    check("structure", "Complete customer journey", 10, structureReady,
      structureReady ? "Navigation, services, FAQ, and contact journey are present." : "Complete navigation and at least three FAQs."),
    check("facts", "Business facts verified", 10, factsReady,
      factsReady ? "Prices, hours, claims, and contact details were reviewed." : "Review and confirm all business facts before delivery.", true),
    check("original", "Full design-engine result", 0, originalReady,
      originalReady ? "The full design engine completed." : "This is starter fallback content. Regenerate before delivery.", true),
  ];

  const score = checks.reduce((sum, item) => sum + (item.pass ? item.weight : 0), 0);
  const blockers = checks.filter((item) => item.blocking && !item.pass);
  const advisories = [];
  if (photos.length > 0 && photos.length < 3) {
    advisories.push("Add two or more business-specific images for a richer gallery.");
  }
  if (!text(input.city)) advisories.push("Add a service area when local SEO matters.");
  if (!list(content.reviews).length) {
    advisories.push("No testimonials were published—add only verified customer reviews.");
  }
  if (!list(content.hours).length) {
    advisories.push("No hours were published—add only confirmed business hours.");
  }

  return {
    version: DELIVERY_STANDARD_VERSION,
    score,
    ready: blockers.length === 0 && score >= DELIVERY_READY_SCORE,
    checks,
    blockers,
    advisories,
  };
}

if (typeof window !== "undefined") {
  window.ProductQuality = { assessProduct, DELIVERY_STANDARD_VERSION, DELIVERY_READY_SCORE };
}
