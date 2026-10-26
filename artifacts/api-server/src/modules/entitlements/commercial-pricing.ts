import { HttpError } from "../../lib/errors";

export function discountBasisPoints(value = "0"): bigint {
  if (!/^\d{1,3}(?:\.\d{1,2})?$/.test(value)) throw new HttpError(400, "Discount must be a percentage from 0 to 100, with at most two decimal places.");
  const [whole, fraction = ""] = value.split(".");
  const points = BigInt(whole) * 100n + BigInt(fraction.padEnd(2, "0"));
  if (points > 10000n) throw new HttpError(400, "Discount cannot exceed 100%.");
  return points;
}
export function discountedRecurring(value: string, percent = "0") {
  if (!/^\d+(?:\.\d{1,2})?$/.test(value)) throw new HttpError(400, "Invalid recurring price.");
  const [whole, fraction = ""] = value.split(".");
  const cents = BigInt(whole) * 100n + BigInt(fraction.padEnd(2, "0"));
  const net = (cents * (10000n - discountBasisPoints(percent)) + 5000n) / 10000n;
  return `${net / 100n}.${String(net % 100n).padStart(2, "0")}`;
}
type PromoProfile = { fixedDiscountAmount?: string | null; promoPrice?: string | null; promoStartsAt?: string | Date | null; promoEndsAt?: string | Date | null } | null | undefined;
export type PricedItem = { monthlyPrice: string | null | undefined; yearlyPrice: string | null | undefined; discountPercent?: string | null; profile?: PromoProfile };
const toCents = (v: string) => { if (!/^\d+(?:\.\d{1,2})?$/.test(v)) throw new HttpError(400, "Invalid price."); const [w, f = ""] = v.split("."); return BigInt(w) * 100n + BigInt(f.padEnd(2, "0")); };
const fromCents = (c: bigint) => `${c / 100n}.${String(c % 100n).padStart(2, "0")}`;
/** Promotion window is half-open [start, end). */
export function promotionActive(profile: PromoProfile, at: Date) {
  return !!profile?.promoPrice && !!profile.promoStartsAt && !!profile.promoEndsAt && new Date(profile.promoStartsAt) <= at && at < new Date(profile.promoEndsAt);
}
/**
 * The single recurring-price rule used by quotes, invoices, estimates and public cards:
 * an active monthly promotion replaces the monthly price (no stacking); otherwise a fixed
 * discount is subtracted; otherwise the percentage discount applies.
 */
export function effectiveRecurring(item: PricedItem, period: "monthly" | "yearly", at: Date = new Date()): string | null {
  const base = period === "monthly" ? item.monthlyPrice : item.yearlyPrice;
  if (base == null) return null;
  const p = item.profile;
  if (period === "monthly" && promotionActive(p, at)) return fromCents(toCents(p!.promoPrice!) < toCents(base) ? toCents(p!.promoPrice!) : toCents(base));
  if (p?.fixedDiscountAmount && toCents(p.fixedDiscountAmount) > 0n) { const net = toCents(base) - toCents(p.fixedDiscountAmount); return fromCents(net > 0n ? net : 0n); }
  return discountedRecurring(base, item.discountPercent ?? "0");
}
export function pricingTriple(values: (string | null | undefined)[]) {
  if (values.every(v => v == null)) return false;
  if (values.some(v => v == null)) throw new HttpError(400, "Set all three prices, or leave all three unconfigured. A blank price is not zero.");
  return true;
}
export function recurringEstimate(items: (PricedItem & { currency: string })[], period: "monthly" | "yearly", percent: string, at: Date = new Date()) {
  if (!items.length || new Set(items.map(i => i.currency)).size !== 1) return null;
  let total = 0n;
  for (const item of items) {
    const net = effectiveRecurring(item, period, at);
    if (net == null) return null;
    total += BigInt(net.replace(".", ""));
  }
  return discountedRecurring(`${total / 100n}.${String(total % 100n).padStart(2, "0")}`, percent);
}
