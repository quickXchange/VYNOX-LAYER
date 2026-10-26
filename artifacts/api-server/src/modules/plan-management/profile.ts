import { CreatePlanBody } from "@workspace/api-zod";
import type { z } from "zod";
import type { DatabaseClient } from "@workspace/db";
import { HttpError } from "../../lib/errors";
import { catalogTable } from "../../lib/catalog-scope";
import { UNSUPPORTED_CAPABILITIES } from "./effective-policy";

export type PlanProfile = NonNullable<z.infer<typeof CreatePlanBody>["profile"]>;
export type Capability = NonNullable<PlanProfile["capabilities"]>[number];
export type PricingMode = NonNullable<PlanProfile["pricingMode"]>;

/** Safe local CTA: a single-origin absolute path, no scheme, no protocol-relative, no traversal. */
export function safeLocalUrl(url: string) {
  return /^\/(?!\/)[A-Za-z0-9/_#?=&.-]*$/.test(url) && !url.includes("..") && !/\\/.test(url) && !/^\/[^/]*:/.test(url);
}
/** Media: local path or plain https URL without credentials, fragments-only tricks or whitespace. */
export function safeMediaUrl(url: string) {
  if (url.startsWith("/")) return safeLocalUrl(url);
  try {
    const u = new URL(url);
    return u.protocol === "https:" && !u.username && !u.password && !/\s/.test(url) && u.hostname.includes(".");
  } catch { return false; }
}
const TEXT = ["internalName", "publicName", "tagline", "shortDescription", "fullDescription", "badgeLabel", "footerText", "promoText", "terms", "contactSalesLabel", "customPriceText", "ctaLabel", "slaTerms", "internalNotes", "iconUrl", "imageUrl"] as const;

function normalizeCapabilities(list: Capability[]): Capability[] {
  const seen = new Set<string>();
  const caps = list.map(c => {
    if (seen.has(c.key)) throw new HttpError(400, `Duplicate capability key ${c.key}.`);
    seen.add(c.key);
    const out: Capability = { ...c, label: c.label.trim(), description: (c.description ?? "").trim(), group: (c.group ?? "").trim(), unit: (c.unit ?? "").trim(),
      tooltip: (c.tooltip ?? "").trim(), badge: (c.badge ?? "").trim(), note: (c.note ?? "").trim(), highlight: !!c.highlight, publicVisible: c.publicVisible !== false,
      dependsOn: [...new Set(c.dependsOn ?? [])], limitValue: c.limitValue ?? null };
    if (!out.label) throw new HttpError(400, "Every capability needs a label.");
    if (out.state === "limited" && out.limitValue == null) throw new HttpError(400, `${out.label}: a limited feature needs a numeric limit.`);
    if (out.state !== "limited" && out.limitValue != null) throw new HttpError(400, `${out.label}: only limited features carry a numeric limit.`);
    if (out.unit && out.limitValue == null) throw new HttpError(400, `${out.label}: a unit needs a numeric limit.`);
    if (out.state === "unavailable" && out.availability === "available") throw new HttpError(400, `${out.label}: an unavailable feature cannot be marked available.`);
    return out;
  });
  const byKey = new Map(caps.map(c => [c.key, c]));
  const granted = (c: Capability) => !["excluded", "unavailable"].includes(c.state);
  for (const c of caps) for (const dep of c.dependsOn ?? []) {
    const d = byKey.get(dep);
    if (dep === c.key || !d) throw new HttpError(400, `${c.label}: dependency '${dep}' must be another capability of this plan.`);
    if (granted(c) && !granted(d)) throw new HttpError(400, `${c.label} requires ${d.label}, which this plan does not grant.`);
  }
  // Reject dependency cycles.
  const visit = (k: string, path: Set<string>) => { if (path.has(k)) throw new HttpError(400, "Capability dependencies contain a cycle."); path.add(k); for (const d of byKey.get(k)?.dependsOn ?? []) visit(d, new Set(path)); };
  for (const c of caps) visit(c.key, new Set());
  return caps;
}

/** Validate a profile from any caller (HTTP or direct service) and normalize text. */
export function normalizeProfile(raw: unknown): PlanProfile {
  const parsed = CreatePlanBody.shape.profile.parse(raw ?? {}) ?? {};
  const p: PlanProfile = { ...parsed };
  for (const k of TEXT) if (typeof p[k] === "string") p[k] = (p[k] as string).trim();
  if (p.ctaUrl !== undefined && p.ctaUrl !== "" && !safeLocalUrl(p.ctaUrl)) throw new HttpError(400, "CTA URL must be a local path such as /contact.");
  for (const k of ["iconUrl", "imageUrl"] as const) if (p[k] && !safeMediaUrl(p[k]!)) throw new HttpError(400, `${k === "iconUrl" ? "Icon" : "Image"} URL must be a local path or an https URL without credentials.`);
  if (p.badgeType === "custom" && !p.badgeLabel) throw new HttpError(400, "A custom badge needs a label.");
  if (p.badgeType === "recommended" && !p.badgeLabel) p.badgeLabel = "Recommended";
  if (p.requestedProviders) p.requestedProviders = [...new Set(p.requestedProviders.map(x => x.trim()).filter(Boolean))];
  if (p.capabilities) p.capabilities = normalizeCapabilities(p.capabilities);
  if (p.themeModes) p.themeModes = [...new Set(p.themeModes)];
  return p;
}

type Prices = { monthlyPrice: string | null; yearlyPrice: string | null; setupFee: string | null; discountPercent?: string | null };
const n = (v: string | null | undefined) => (v == null ? null : Number(v));
export function effectiveMode(profile: PlanProfile | undefined, configured: boolean): PricingMode {
  return profile?.pricingMode ?? (configured ? "paid" : "contact_sales");
}
/** Coherent billing: mode, prices, discounts, promotion and billing availability must agree. */
export function billingError(profile: PlanProfile, configured: boolean, prices: Prices, periods: { monthly: boolean; yearly: boolean }): string | null {
  const mode = effectiveMode(profile, configured);
  const m = n(prices.monthlyPrice), y = n(prices.yearlyPrice);
  const fixed = n(profile.fixedDiscountAmount), promo = n(profile.promoPrice), pct = Number(prices.discountPercent ?? 0);
  if (!Number.isInteger(profile.trialDays ?? 0) || (profile.trialDays ?? 0) < 0 || (profile.trialDays ?? 0) > 365) return "Trial duration must be a whole number from 0 to 365 days.";
  if (mode === "paid" && !configured) return "Paid plans need monthly, yearly and setup prices.";
  if (mode === "free" && (!configured || m !== 0 || y !== 0)) return "Free plans need configured recurring prices of exactly 0.";
  if ((mode === "custom" || mode === "contact_sales") && configured) return "Custom and contact-sales plans must leave prices unconfigured.";
  if (mode === "custom" && !profile.customPriceText) return "Custom pricing needs the public custom price text.";
  if (mode !== "paid" && (fixed || promo != null || pct > 0 || (profile.trialDays ?? 0) > 0)) return "Discounts, promotions and trials apply only to paid plans.";
  if (fixed != null && fixed > 0) {
    if (pct > 0) return "Use either a percentage or a fixed discount, not both.";
    if (m == null || y == null || fixed >= m || fixed >= y) return "Fixed discount must be lower than the monthly and yearly price.";
  }
  if (promo != null || profile.promoStartsAt || profile.promoEndsAt) {
    if (promo == null || !profile.promoStartsAt || !profile.promoEndsAt) return "A promotion needs a price, start date and end date.";
    if (new Date(profile.promoStartsAt) >= new Date(profile.promoEndsAt)) return "Promotion must end after it starts.";
    if (m == null || promo >= m) return "Promotional price must be lower than the monthly price.";
  }
  const iv = profile.billingInterval;
  if (iv === "custom" && mode === "paid") return "Paid plans need a monthly and/or yearly interval.";
  if ((iv === "monthly" || iv === "monthly_and_yearly") && !periods.monthly) return "Monthly billing is selected but the monthly period is disabled.";
  if ((iv === "yearly" || iv === "monthly_and_yearly") && !periods.yearly) return "Yearly billing is selected but the yearly period is disabled.";
  if (iv === "monthly" && periods.yearly) return "Billing interval is monthly only; disable the yearly period.";
  if (iv === "yearly" && periods.monthly) return "Billing interval is yearly only; disable the monthly period.";
  return null;
}

/** Public projection: never includes internal name/notes or non-public capabilities. */
export function publicProfile(profile: unknown): Omit<PlanProfile, "internalNotes" | "internalName"> {
  const { internalNotes: _a, internalName: _b, ...rest } = (profile ?? {}) as PlanProfile;
  // Same allowlist as enforcement: unimplemented services are always shown as unavailable,
  // whatever the editable availability says, so the public never sees a false claim.
  return rest.capabilities ? { ...rest, capabilities: rest.capabilities.filter(c => c.publicVisible !== false)
    .map(c => UNSUPPORTED_CAPABILITIES.includes(c.key) && c.availability !== "unavailable" ? { ...c, availability: "unavailable" as const } : c) } : rest;
}

export async function assertSlugAvailable(c: DatabaseClient, slug: string | undefined, status: string, planId?: string) {
  if (!slug || status === "archived") return;
  const r = await c.query(`SELECT id FROM ${catalogTable("plans")} WHERE profile->>'slug'=$1 AND status<>'archived' AND ($2::uuid IS NULL OR id<>$2::uuid) LIMIT 1`, [slug, planId ?? null]);
  if (r.rowCount) throw new HttpError(409, `Slug '${slug}' is already used by another active plan.`);
}
export async function assertRevision(c: DatabaseClient, planId: string, expected: number | undefined) {
  if (expected === undefined) throw new HttpError(428, "expectedRevision is required. Reload the plan and retry.");
  const cur = (await c.query(`SELECT revision FROM ${catalogTable("plans")} WHERE id=$1`, [planId])).rows[0];
  if (!cur) throw new HttpError(404, "Plan not found.");
  if ((cur.revision ?? 0) !== expected) throw new HttpError(409, "This plan was changed by another administrator. Reload to review their edits.");
}
