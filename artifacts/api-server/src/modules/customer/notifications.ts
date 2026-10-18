import { withDatabase } from "@workspace/db";
import type { Principal } from "../authentication/service";
import { requestContext } from "./order-model";
import { mailConfigured } from "../commerce/email";

export function customerNotifications(p: Principal) {
  return withDatabase(requestContext(p), async c => {
    const result = await c.query(`SELECT e.id,e.request_id AS "requestId",
      'WL-'||lpad(w.order_number::text,6,'0') AS "orderReference",
      e.message,e.status,e.created_at AS "createdAt",r.read_at AS "readAt"
      FROM white_label_events e JOIN white_label_requests w ON w.id=e.request_id
      LEFT JOIN customer_notification_reads r ON r.event_id=e.id AND r.customer_user_id=$1
      WHERE w.customer_user_id=$1 AND w.configuration->>'sandboxOnly' IS DISTINCT FROM 'true' AND e.visibility='customer'
      ORDER BY (r.event_id IS NOT NULL),e.created_at DESC,e.id DESC LIMIT 100`, [p.userId]);
    const unread = await c.query(`SELECT count(*)::integer AS total FROM white_label_events e
      JOIN white_label_requests w ON w.id=e.request_id
      WHERE w.customer_user_id=$1 AND w.configuration->>'sandboxOnly' IS DISTINCT FROM 'true' AND e.visibility='customer'
      AND NOT EXISTS(SELECT 1 FROM customer_notification_reads r WHERE r.event_id=e.id AND r.customer_user_id=$1)`, [p.userId]);
    return { items: result.rows, unreadCount: unread.rows[0].total as number, outboundConnected: mailConfigured() };
  });
}
export function markNotificationsRead(p: Principal, ids: string[]) {
  return withDatabase(requestContext(p, true), async c => {
    if (ids.length) await c.query(`INSERT INTO customer_notification_reads(customer_user_id,event_id)
      SELECT $1,e.id FROM white_label_events e JOIN white_label_requests w ON w.id=e.request_id
      WHERE e.id=ANY($2::uuid[]) AND w.customer_user_id=$1
        AND w.configuration->>'sandboxOnly' IS DISTINCT FROM 'true' AND e.visibility='customer'
      ON CONFLICT DO NOTHING`, [p.userId, ids]);
    return { ok: true };
  });
}
