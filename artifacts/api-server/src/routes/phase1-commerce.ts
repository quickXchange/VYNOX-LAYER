import { Router } from "express";
import { z } from "zod";
import { requireAuthentication, principalFrom, sameOriginMutation } from "../middlewares/authentication";
import { publicOffers, methods, saveMethod, deleteMethod, orderBilling, checkout, reportPayment, settle } from "../modules/commerce/service";
import { emailStatus, retryEmail, startCommerceMail } from "../modules/commerce/email";
import { requireSuperAdmin } from "../modules/authentication/service";
import { proposals, approveProposal, periods } from "../modules/commerce/offers";
import { pricingPublication } from "../modules/commerce/pricing-publication";

const router = Router();
const uuid = z.guid().transform(value => value.toLowerCase());
router.get("/phase1/catalog", async (_req, res) => { res.json(await publicOffers()); });
router.get("/commerce/pricing-publication", requireAuthentication, async (_req, res) => {
  res.set("Cache-Control","no-store"); res.json(await pricingPublication(principalFrom(res)));
});
router.post("/commerce/pricing-publication", requireAuthentication, sameOriginMutation, async (req, res) => {
  const body = z.object({expectedRevision:z.string().regex(/^[a-f0-9]{64}$/),expectedPublishedRevision:z.string().regex(/^[a-f0-9]{64}$/).nullable(),reason:z.string().trim().min(3).max(500)}).strict().parse(req.body);
  res.json(await pricingPublication(principalFrom(res),body));
});
router.use(["/operator/phase1", "/customer/phase1"], requireAuthentication);
router.use("/operator/phase1", (_req, res, next) => { requireSuperAdmin(principalFrom(res)); next(); });
router.get("/operator/phase1/methods", async (_req, res) => { res.json(await methods(principalFrom(res))); });
router.get("/operator/phase1/proposals", async (_req, res) => { res.json(await proposals(principalFrom(res))); });
router.post("/operator/phase1/proposals/:kind/:id/approve", sameOriginMutation, async (req, res) => {
  const body = z.object({ confirmed: z.literal(true), expected: z.object({ monthlyPrice: z.string().regex(/^\d+(\.\d{1,2})?$/), yearlyPrice: z.string().regex(/^\d+(\.\d{1,2})?$/), setupFee: z.string().regex(/^\d+(\.\d{1,2})?$/), currency: z.string().regex(/^[A-Z]{3}$/) }) }).parse(req.body);
  res.json(await approveProposal(principalFrom(res), z.enum(["plan", "addon"]).parse(req.params.kind), uuid.parse(req.params.id), body.expected));
});
router.get("/operator/phase1/plans/:id/periods", async (req, res) => { res.json(await periods(principalFrom(res), uuid.parse(req.params.id))); });
router.put("/operator/phase1/plans/:id/periods", sameOriginMutation, async (req, res) => {
  res.json(await periods(principalFrom(res), uuid.parse(req.params.id), z.object({ monthly: z.boolean(), yearly: z.boolean() }).parse(req.body)));
});
router.post("/operator/phase1/methods", sameOriginMutation, async (req, res) => { res.status(201).json(await saveMethod(principalFrom(res), undefined, req.body)); });
router.put("/operator/phase1/methods/:id", sameOriginMutation, async (req, res) => { res.json(await saveMethod(principalFrom(res), uuid.parse(req.params.id), req.body)); });
router.delete("/operator/phase1/methods/:id", sameOriginMutation, async (req, res) => { res.json(await deleteMethod(principalFrom(res), uuid.parse(req.params.id))); });
for (const prefix of ["operator", "customer"]) {
  router.get(`/${prefix}/phase1/orders/:id`, async (req, res) => { res.json(await orderBilling(principalFrom(res), uuid.parse(req.params.id))); });
}
router.post("/customer/phase1/orders/:id/checkout", sameOriginMutation, async (req, res) => {
  res.status(201).json(await checkout(principalFrom(res), uuid.parse(req.params.id), uuid.parse(req.body?.methodId)));
});
router.post("/customer/phase1/orders/:id/report", sameOriginMutation, async (req, res) => {
  res.json(await reportPayment(principalFrom(res), uuid.parse(req.params.id), z.string().trim().min(3).max(200).parse(req.body?.reference)));
});
for (const action of ["confirm", "reject"]) {
  router.post(`/operator/phase1/invoices/:id/${action}`, sameOriginMutation, async (req, res) => {
    res.json(await settle(principalFrom(res), uuid.parse(req.params.id), req.body, action === "reject"));
  });
}
router.get("/operator/phase1/emails", async (_req, res) => { res.json(await emailStatus(principalFrom(res))); });
router.post("/operator/phase1/emails/:id/retry", sameOriginMutation, async (req, res) => { res.json(await retryEmail(principalFrom(res), uuid.parse(req.params.id))); });
startCommerceMail();
export default router;
