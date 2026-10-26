import { HttpError } from "../../lib/errors";
import { effectiveRecurring } from "../entitlements/commercial-pricing";
export function cents(value: unknown): bigint {
  if (typeof value !== "string" || !/^\d{1,20}(\.\d{1,2})?$/.test(value)) throw new HttpError(400, "Use a nonnegative amount with at most two decimals.");
  const [a, b = ""] = value.split(".");
  return BigInt(a) * 100n + BigInt(b.padEnd(2, "0"));
}
export function money(value: bigint) { return `${value / 100n}.${String(value % 100n).padStart(2, "0")}`; }
export function invoicePricing(configuration: any, quotation?: { status: string; customDesignDecision?: string; monthlyPrice: string | null; setupPrice: string | null; customizationPrice?: string | null; currency: string }) {
  const snapshot = configuration.catalogSnapshot;
  const plan = snapshot?.plan;
  const yearly = configuration.billingPeriod === "yearly";
  if (!plan?.pricingConfigured) throw new HttpError(409, "Plan prices are provisional and must be approved before a purchase.");
  const addons = snapshot.addons ?? [];
  if (addons.some((a: any) => !a.pricingConfigured || a.pricingConfirmed === false || a.currency !== plan.currency)) throw new HttpError(409, "Every add-on price must be approved in the same currency.");
  const custom = configuration.design?.type === "custom";
  if (custom && (!quotation || quotation.status !== "quote_ready" || quotation.customDesignDecision !== "approved" || quotation.customizationPrice == null))
    throw new HttpError(409, "Custom design needs an operator-approved quotation before purchase.");
  if (quotation?.status === "quote_ready") {
    if (quotation.currency !== plan.currency || quotation.monthlyPrice == null || quotation.setupPrice == null)
      throw new HttpError(409, "The final quotation must have complete prices in the approved plan currency.");
    const recurring = cents(quotation.monthlyPrice), setup = cents(quotation.setupPrice), customization = cents(quotation.customizationPrice ?? "0");
    return { amount: money(recurring + setup + customization), currency: quotation.currency, recurring: money(recurring), setup: money(setup), customization: money(customization), billingPeriod: yearly ? "yearly" : "monthly" };
  }
  // Promotions are evaluated at the order's immutable pricing instant (submission), not at payment time.
  const at = configuration.pricedAt ? new Date(configuration.pricedAt) : new Date();
  const recurring = [plan, ...addons].reduce((sum, p) => sum + cents(effectiveRecurring(p, yearly ? "yearly" : "monthly", at)), 0n);
  const setup = [plan, ...addons].reduce((sum, p) => sum + cents(p.setupFee), 0n);
  return { amount: money(recurring + setup), currency: plan.currency, recurring: money(recurring), setup: money(setup), customization: "0.00", billingPeriod: yearly ? "yearly" : "monthly" };
}
export function assertSettlement(invoice: { amount: string; currency: string }, input: { receivedAmount: string; currency: string; reference: string; evidence: string }) {
  if (cents(input.receivedAmount) !== cents(invoice.amount) || input.currency !== invoice.currency)
    throw new HttpError(409, "Received amount and currency must exactly match this invoice. Underpayments, overpayments and conversion need reconciliation first.");
  if (input.reference.trim().length < 3 || input.evidence.trim().length < 10)
    throw new HttpError(400, "Record the actual transfer reference and verified settlement evidence.");
}
