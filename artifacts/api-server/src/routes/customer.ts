import { Router } from "express";
import {
  ListMyAdminPanelsResponse, ListMyWhiteLabelRequestsResponse, SubmitWhiteLabelRequestBody, SubmitWhiteLabelRequestResponse,
  ListWhiteLabelRequestsResponse, ReviewWhiteLabelRequestParams, ReviewWhiteLabelRequestBody, ReviewWhiteLabelRequestResponse,
  ProvisionWhiteLabelRequestParams, ProvisionWhiteLabelRequestBody, ProvisionWhiteLabelRequestResponse,
  GetWhiteLabelCatalogResponse, GetMyWhiteLabelRequestParams, GetMyWhiteLabelRequestResponse,
  GetWhiteLabelRequestParams, GetWhiteLabelRequestResponse, AddWhiteLabelNoteParams, AddWhiteLabelNoteBody, AddWhiteLabelNoteResponse,
} from "@workspace/api-zod";
import { requireAuthentication, principalFrom, sameOriginMutation } from "../middlewares/authentication";
import { myAdminPanels, listRequests, submitRequest, reviewRequest, deliverRequest, orderDetail, appendNote } from "../modules/customer/service";
import { whiteLabelCatalog } from "../modules/customer/order-catalog";
import { getProvisioning, retryProvisioning } from "../modules/customer/provisioning";
import { GetWhiteLabelProvisioningResponse, RetryWhiteLabelProvisioningResponse } from "@workspace/api-zod";
import { GetCustomerNotificationsResponse, MarkCustomerNotificationsReadBody, MarkCustomerNotificationsReadResponse } from "@workspace/api-zod";
import { customerNotifications, markNotificationsRead } from "../modules/customer/notifications";
const router = Router();
router.use(["/customer", "/operator"], requireAuthentication, sameOriginMutation);
router.get("/customer/notifications", async (_req, res) => {
  res.set("Cache-Control", "no-store");
  res.json(GetCustomerNotificationsResponse.parse(await customerNotifications(principalFrom(res))));
});
router.put("/customer/notifications/read", async (req, res) => {
  res.json(MarkCustomerNotificationsReadResponse.parse(await markNotificationsRead(principalFrom(res), MarkCustomerNotificationsReadBody.parse(req.body).ids)));
});
router.get("/operator/white-label-requests/:requestId/provisioning", async (req, res) => {
  res.set("Cache-Control", "no-store");
  res.json(GetWhiteLabelProvisioningResponse.parse(await getProvisioning(principalFrom(res), GetWhiteLabelRequestParams.parse(req.params).requestId)));
});
router.post("/operator/white-label-requests/:requestId/provisioning", async (req, res) => {
  res.json(RetryWhiteLabelProvisioningResponse.parse(await retryProvisioning(principalFrom(res), GetWhiteLabelRequestParams.parse(req.params).requestId)));
});
router.get("/customer/admin-panels", async (_req, res) => res.json(ListMyAdminPanelsResponse.parse(await myAdminPanels(principalFrom(res)))));
router.get("/customer/white-label-catalog", async (_req, res) => res.json(GetWhiteLabelCatalogResponse.parse(await whiteLabelCatalog(principalFrom(res)))));
router.get("/customer/white-label-requests/:requestId", async (req, res) => res.json(GetMyWhiteLabelRequestResponse.parse(await orderDetail(principalFrom(res), GetMyWhiteLabelRequestParams.parse(req.params).requestId))));
router.get("/operator/white-label-requests/:requestId", async (req, res) => res.json(GetWhiteLabelRequestResponse.parse(await orderDetail(principalFrom(res), GetWhiteLabelRequestParams.parse(req.params).requestId, true))));
router.post("/operator/white-label-requests/:requestId/notes", async (req, res) => res.status(201).json(AddWhiteLabelNoteResponse.parse(await appendNote(principalFrom(res), AddWhiteLabelNoteParams.parse(req.params).requestId, AddWhiteLabelNoteBody.parse(req.body)))));
router.get("/customer/white-label-requests", async (_req, res) => res.json(ListMyWhiteLabelRequestsResponse.parse(await listRequests(principalFrom(res)))));
router.post("/customer/white-label-requests", async (req, res) => res.status(201).json(SubmitWhiteLabelRequestResponse.parse(await submitRequest(
  principalFrom(res), SubmitWhiteLabelRequestBody.parse(req.body), res.locals.preparationSandboxWrite === true,
))));
router.get("/operator/white-label-requests", async (_req, res) => res.json(ListWhiteLabelRequestsResponse.parse(await listRequests(principalFrom(res), true))));
router.put("/operator/white-label-requests/:requestId/review", async (req, res) => res.json(ReviewWhiteLabelRequestResponse.parse(await reviewRequest(principalFrom(res), ReviewWhiteLabelRequestParams.parse(req.params).requestId, ReviewWhiteLabelRequestBody.parse(req.body)))));
router.post("/operator/white-label-requests/:requestId/provision", async (req, res) => res.json(ProvisionWhiteLabelRequestResponse.parse(await deliverRequest(principalFrom(res), ProvisionWhiteLabelRequestParams.parse(req.params).requestId, ProvisionWhiteLabelRequestBody.parse(req.body).tenantId))));
export default router;