import { withDatabase } from "@workspace/db";
import { requireSuperAdmin, type Principal } from "../authentication/service";
import { requestContext } from "../customer/order-model";
import { supabaseDirectory } from "../supabase-auth/directory";
import { HttpError } from "../../lib/errors";
import { CAPTURE_MARKER, captureDevelopmentMail, developmentMailCapture } from "./development-mail";

const system = { actorId: "system:commerce-mail", isSuperAdmin: true, canWrite: true };
export function mailConfigured() {
  if (developmentMailCapture()) return true;
  return !!(mailKey() && process.env.QXLAYER_ORDER_EMAIL_FROM);
}
function mailKey() {
  return process.env.QXLAYER_ORDER_EMAIL_API_KEY ??
    (process.env.QXLAYER_EXTERNAL_ENVIRONMENT === "production" ? process.env.QXLAYER_PRODUCTION_RESEND_SMTP_KEY : process.env.QXLAYER_DEVELOPMENT_RESEND_SMTP_KEY);
}
export function emailStatus(p: Principal) {
  requireSuperAdmin(p);
  return withDatabase(requestContext(p), async c => (await c.query(`SELECT id,subject,status,attempts,last_error AS "lastError",created_at AS "createdAt",sent_at AS "sentAt",
    CASE WHEN last_error='Captured by Development mail sink; not externally delivered.' THEN 'development_capture' ELSE 'provider' END AS "deliveryMode"
    FROM qxlayer_commerce.email_outbox ORDER BY created_at DESC,id LIMIT 100`)).rows);
}
export function retryEmail(p: Principal, id: string) {
  requireSuperAdmin(p);
  return withDatabase(requestContext(p, true), async c => {
    if (!(await c.query("UPDATE qxlayer_commerce.email_outbox SET status='pending',claimed_at=NULL,last_error=NULL WHERE id=$1 AND status='failed' RETURNING id", [id])).rowCount)
      throw new HttpError(409, "Only failed messages can be retried.");
    return { queued: true };
  });
}
let running = false;
export async function flushEmail() {
  if (running || !mailConfigured()) return;
  running = true;
  try {
    const claimed = await withDatabase(system, async c => (await c.query(`UPDATE qxlayer_commerce.email_outbox SET claimed_at=now(),attempts=attempts+1
      WHERE id IN (SELECT id FROM qxlayer_commerce.email_outbox WHERE status='pending' AND (claimed_at IS NULL OR claimed_at<now()-interval '2 minutes')
      ORDER BY created_at LIMIT 10 FOR UPDATE SKIP LOCKED) RETURNING *`)).rows);
    if (!claimed.length) return;
    if (developmentMailCapture()) {
      for (const row of claimed) {
        try {
          await captureDevelopmentMail(String(row.event_id), { customerId: row.customer_user_id, subject: row.subject, message: row.message });
          await withDatabase(system, c => c.query(
            "UPDATE qxlayer_commerce.email_outbox SET status='sent',sent_at=now(),last_error=$2 WHERE id=$1", [row.id, CAPTURE_MARKER]));
        } catch {
          await withDatabase(system, c => c.query(
            "UPDATE qxlayer_commerce.email_outbox SET status='failed',last_error='Development capture failed; no external delivery attempted.' WHERE id=$1", [row.id]));
        }
      }
      return;
    }
    // Provider directory maps original Owner IDs as well as native customer IDs.
    let users: Awaited<ReturnType<typeof supabaseDirectory>>;
    try { users = await supabaseDirectory(); } catch {
      for (const row of claimed) await withDatabase(system, c => c.query(
        "UPDATE qxlayer_commerce.email_outbox SET status='failed',last_error='Account directory is unavailable.' WHERE id=$1", [row.id]));
      return;
    }
    for (const row of claimed) {
      try {
        const user = users.find(u => u.id === row.customer_user_id);
        const recipient = user?.emailAddresses.find(e => e.id === user.primaryEmailAddressId)?.emailAddress;
        if (!recipient || recipient.endsWith(".invalid") || user?.banned || user?.locked) throw new Error("Recipient unavailable or a non-deliverable test identity.");
        const response = await fetch("https://api.resend.com/emails", { method: "POST",
          headers: { Authorization: `Bearer ${mailKey()}`, "Content-Type": "application/json", "Idempotency-Key": `vynox-order-event-${row.event_id}` },
          body: JSON.stringify({ from: process.env.QXLAYER_ORDER_EMAIL_FROM, to: [recipient],
            subject: row.subject, text: `${row.message}\n\nSign in to your VYNOX LAYER account to view your order. Never send passwords, verification codes or private keys by email.` }),
          redirect: "error", signal: AbortSignal.timeout(20000) });
        if (!response.ok) throw new Error(`Email provider rejected delivery (HTTP ${response.status}).`);
        await withDatabase(system, c => c.query("UPDATE qxlayer_commerce.email_outbox SET status='sent',sent_at=now(),last_error=NULL WHERE id=$1", [row.id]));
      } catch (error) {
        const safe = error instanceof Error && /^(Recipient unavailable|Email provider rejected)/.test(error.message) ? error.message : "Email delivery failed; retry after checking provider connectivity.";
        await withDatabase(system, c => c.query("UPDATE qxlayer_commerce.email_outbox SET status='failed',last_error=$2 WHERE id=$1", [row.id, safe]));
      }
    }
  } finally { running = false; }
}
let timer: ReturnType<typeof setInterval> | undefined;
export function startCommerceMail() {
  if (timer) return;
  timer = setInterval(() => { void flushEmail().catch(() => { /* Outbox stays durable on transient directory/database failure. */ }); }, 10000);
  timer.unref();
}
