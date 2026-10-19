import { withDatabase } from "@workspace/db";
import { requireSuperAdmin, type Principal } from "../authentication/service";
import { requestContext } from "../customer/order-model";
import { HttpError } from "../../lib/errors";
import { audit } from "../../lib/catalog-audit";
import { catalogTable } from "../../lib/catalog-scope";
import { catalogLock } from "../entitlements/catalog";
import { freezePricingBeforeEdit } from "./pricing-publication";
const planIds = ["a4000000-0000-4000-8000-000000000001", "a4000000-0000-4000-8000-000000000002", "a4000000-0000-4000-8000-000000000003"];
const addonIds = ["a4000000-0000-4000-8000-000000000101", "a4000000-0000-4000-8000-000000000102"];
export function proposals(p: Principal) {
  requireSuperAdmin(p);
  return withDatabase(requestContext(p), async c => (await c.query(`SELECT id,name,'plan' AS kind,currency,monthly_price::text AS "monthlyPrice",
    yearly_price::text AS "yearlyPrice",setup_fee::text AS "setupFee",pricing_configured AS approved FROM ${catalogTable("plans")} WHERE id=ANY($1::uuid[])
    UNION ALL SELECT id,name,'addon',currency,monthly_price::text,yearly_price::text,setup_fee::text,pricing_confirmed FROM ${catalogTable("addons")} WHERE id=ANY($2::uuid[]) ORDER BY kind,name`, [planIds, addonIds])).rows);
}
export function approveProposal(p: Principal, kind: "plan" | "addon", id: string, expected: { monthlyPrice: string; yearlyPrice: string; setupFee: string; currency: string }) {
  requireSuperAdmin(p);
  if (!(kind === "plan" ? planIds : addonIds).includes(id)) throw new HttpError(404, "Default proposal not found.");
  return withDatabase(requestContext(p, true), async c => {
    await freezePricingBeforeEdit(c);
    const result = kind === "plan" ?
      await c.query(`UPDATE ${catalogTable("plans")} SET pricing_configured=true,status='enabled',updated_at=now() WHERE id=$1 AND NOT pricing_configured AND monthly_price=$2 AND yearly_price=$3 AND setup_fee=$4 AND currency=$5 RETURNING id`, [id, expected.monthlyPrice, expected.yearlyPrice, expected.setupFee, expected.currency]) :
      await c.query(`UPDATE ${catalogTable("addons")} SET pricing_configured=true,pricing_confirmed=true,enabled=true WHERE id=$1 AND NOT pricing_confirmed AND monthly_price=$2 AND yearly_price=$3 AND setup_fee=$4 AND currency=$5 RETURNING id`, [id, expected.monthlyPrice, expected.yearlyPrice, expected.setupFee, expected.currency]);
    if (!result.rowCount) throw new HttpError(409, "This proposal changed, was approved or was deleted. Refresh and review its exact prices again.");
    await audit(c, p, null, "commerce.proposal.approved", "Explicitly approved current EUR proposal prices", { id, kind });
    return { approved: true };
  });
}
export function periods(p: Principal, id: string, input?: { monthly: boolean; yearly: boolean }) {
  requireSuperAdmin(p);
  return withDatabase(requestContext(p, !!input), async c => {
    if (input) await freezePricingBeforeEdit(c);
    await catalogLock(c, `plan:${id}`, !!input);
    if (!(await c.query(`SELECT id FROM ${catalogTable("plans")} WHERE id=$1`, [id])).rowCount) throw new HttpError(404, "Plan not found.");
    if (input) {
      await c.query(`INSERT INTO ${catalogTable("offer_settings")}(plan_id,monthly,yearly) VALUES($1,$2,$3)
        ON CONFLICT(plan_id) DO UPDATE SET monthly=$2,yearly=$3`, [id, input.monthly, input.yearly]);
      await audit(c, p, null, "commerce.periods.saved", "Updated enabled plan billing periods", { id, ...input });
    }
    return (await c.query(`SELECT monthly,yearly FROM ${catalogTable("offer_settings")} WHERE plan_id=$1`, [id])).rows[0] ?? { monthly: true, yearly: true };
  });
}
