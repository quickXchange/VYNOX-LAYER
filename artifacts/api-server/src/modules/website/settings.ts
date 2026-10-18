import { UpdateTenantWebsiteSettingsBody } from "@workspace/api-zod";
import type { z } from "zod";
import { HttpError } from "../../lib/errors";

export type WebsiteSettings = z.infer<typeof UpdateTenantWebsiteSettingsBody>;
export function safeHttps(value: string | null) {
  if (!value) return;
  // Only the curated, order-linked branding files can be same-origin URLs.
  if (/^\/api\/public\/sites\/[a-z0-9]+(?:-[a-z0-9]+)*\/branding\/(?:logo|favicon)$/.test(value)) return;
  if (/^\/api\/tenants\/[a-f0-9-]{36}\/release-assets\/[a-f0-9-]{36}$/.test(value) ||
    /^\/api\/public\/release-assets\/[a-f0-9-]{36}\/[a-f0-9]{64}\.(png|jpg|svg|webp|gif|ico)$/.test(value)) return;
  try {
    const u = new URL(value);
    if (u.protocol !== "https:" || u.username || u.password) throw new Error();
  } catch { throw new HttpError(400, "Image, support, social and webhook URLs must use HTTPS without embedded credentials."); }
}
export function validateSettings(input: WebsiteSettings) {
  if (input.navigation && new Set(input.navigation.map((n) => n.key)).size !== input.navigation.length) throw new HttpError(400, "Navigation keys must be unique.");
  if (input.navigation?.some((n) => !n.label.trim())) throw new HttpError(400, "Navigation labels must contain text.");
  if (input.heroTitle.trim().length < 2) throw new HttpError(400, "Hero title must contain at least two non-whitespace characters.");
  if (input.faq?.some((item) => item.question.trim().length < 2 || item.answer.trim().length < 2)) throw new HttpError(400, "FAQ questions and answers must contain text.");
  [input.faviconUrl, input.supportUrl, ...input.socialLinks.map((s) => s.url)].forEach(safeHttps);
  for (const link of input.reviewLinks ?? []) {
    if (!link.label.trim()) throw new HttpError(400, "Review links need a label.");
    // Review destinations are external HTTPS URLs, not branding-file paths.
    let url: URL;
    try { url = new URL(link.url); } catch { throw new HttpError(400, "Review links must use HTTPS."); }
    if (url.protocol !== "https:" || url.username || url.password) throw new HttpError(400, "Review links must use HTTPS without credentials.");
  }
  if (input.supportEmail && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(input.supportEmail)) throw new HttpError(400, "Provide a valid support email or leave it empty.");
  return input;
}
export function websiteSettings(brandName: string, raw: Record<string, unknown>): WebsiteSettings {
  return UpdateTenantWebsiteSettingsBody.parse({
    websiteName: brandName, sandboxLabel: "Sandbox", templateKey: "standard-exchange",
    secondaryColor: "#102C36", faviconUrl: null, fontKey: "system",
    surfaceStyle: "solid", borderRadius: "soft", faq: [], navigation: [],
    heroTitle: `Welcome to ${brandName}`, heroSubtitle: "Explore the capabilities configured for this sandbox website.",
    supportEmail: null, supportUrl: null, supportDetails: "", socialLinks: [],
    footerText: "Sandbox only. No financial execution, real deposits or wallet connections.",
    privacyContent: "", termsContent: "", ...raw,
  });
}