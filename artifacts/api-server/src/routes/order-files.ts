import { Router, raw } from "express";
import { pipeline } from "node:stream/promises";
import { z } from "zod";
import { HttpError } from "../lib/errors";
import { principalFrom, requireAuthentication, sameOriginMutation } from "../middlewares/authentication";
import { uploadAttachment, attachmentFor } from "../modules/customer/order-files";
const router = Router();
router.use("/customer/order-attachments", requireAuthentication, sameOriginMutation);
const metadata = z.object({
  fileName: z.string().min(1).max(200),
  contentType: z.string().max(120),
  category: z.enum(["logo", "favicon", "design_reference", "requirement"]),
});
router.post("/customer/order-attachments", raw({ type: "application/octet-stream", limit: "8mb" }), async (req, res) => {
  const m = metadata.parse(req.query);
  if (!Buffer.isBuffer(req.body)) throw new HttpError(400, "Upload binary file bytes with Content-Type application/octet-stream.");
  res.status(201).json(await uploadAttachment(principalFrom(res), m.fileName, m.contentType, m.category, req.body));
});
router.get("/customer/order-attachments/:id/content", async (req, res) => {
  const id = z.guid().parse(req.params.id);
  const { row, file } = await attachmentFor(principalFrom(res), id);
  const inline = row.content_type.startsWith("image/") && req.query.download !== "1";
  res.setHeader("Content-Type", row.content_type);
  res.setHeader("Content-Disposition", `${inline ? "inline" : "attachment"}; filename*=UTF-8''${encodeURIComponent(row.file_name)}`);
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("Cache-Control", "private, no-store");
  res.setHeader("Content-Security-Policy", "default-src 'none'; sandbox");
  await pipeline(file.createReadStream(), res);
});
export default router;