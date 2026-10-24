import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { pool } from "@workspace/db";
import { resolvePrincipal } from "../modules/authentication/service";
import { submitRequest, orderDetail } from "../modules/customer/service";
import { attachmentFor, uploadAttachment, deleteFixtureFiles } from "../modules/customer/order-files";
if (process.env.NODE_ENV === "production") throw new Error("Development verification refused in production.");
const s = randomUUID().slice(0, 8), owners = [`user_uploadCustomer${s}`, `user_uploadOther${s}`], opId = `user_uploadOperator${s}`;
try {
  await pool.query("INSERT INTO platform_admins (clerk_user_id) VALUES ($1)", [opId]);
  const owner = await resolvePrincipal(owners[0]), other = await resolvePrincipal(owners[1]), op = await resolvePrincipal(opId);
  const text = Buffer.from("Private requirement document; never publicly served.");
  const file = await uploadAttachment(owner, "requirements.txt", "text/plain", "requirement", text);
  const access = await attachmentFor(owner, file.id);
  assert.deepEqual((await access.file.download())[0], text);
  await assert.rejects(() => attachmentFor(other, file.id), (e: any) => e.status === 404);
  await assert.rejects(() => attachmentFor(op, file.id), (e: any) => e.status === 404);
  await assert.rejects(() => uploadAttachment(owner, "unsafe.svg", "image/svg+xml", "logo", Buffer.from("<svg/>")), (e: any) => e.status === 400);
  await assert.rejects(() => uploadAttachment(owner, "spoofed.png", "image/png", "logo", Buffer.from("<script>alert(1)</script>")), (e: any) => e.status === 400);
  const input = { projectName: "Private attachment verification", brandName: "Private", preferredDomain: "private.example.test", actions: ["swap" as const], details: "Protected upload ownership", attachmentIds: [file.id], idempotencyKey: randomUUID() };
  const [a, b] = await Promise.all([submitRequest(owner, input), submitRequest(owner, input)]);
  assert.equal(a.id, b.id);
  assert.equal(a.attachments.length, 1);
  const superAccess = await attachmentFor(op, file.id);
  assert.deepEqual((await superAccess.file.download())[0], text);
  assert.equal((await orderDetail(owner, a.id)).order.attachments[0].fileName, "requirements.txt");
  await assert.rejects(() => submitRequest(other, { ...input, idempotencyKey: randomUUID() }), (e: any) => e.status === 400);
  console.log("PASS: real private upload/download, draft Super denial, cross-owner denial, submitted Super access, spoofed/active-file rejection, bound metadata, concurrent idempotency.");
} finally {
  await deleteFixtureFiles(pool, owners);
  await pool.query("DELETE FROM white_label_requests WHERE customer_user_id=ANY($1::text[])", [owners]);
  await pool.query("DELETE FROM white_label_attachments WHERE owner_user_id=ANY($1::text[])", [owners]);
  await pool.query("DELETE FROM platform_admins WHERE clerk_user_id=$1", [opId]);
  await pool.end();
}