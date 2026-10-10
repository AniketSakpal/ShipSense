
import type { Pool, PoolClient } from "pg";
import { randomUUID } from "node:crypto";

export type NotificationStatus =
  | "PENDING"
  | "PROCESSING"
  | "SENT"
  | "FAILED"
  | "DEAD_LETTER"
  | "DROPPED";

export type NotificationChannel = "WHATSAPP" | "SMS";

export interface OutboxMessage {
  id: string;
  shipment_id: string;
  shipment_event_id: string;
  notification_type: string;
  recipient: string;
  payload: Record<string, unknown>;
  status: NotificationStatus;
  attempts: number;
  attempt_no: number;
  channel: NotificationChannel;
  whatsapp_attempts: number;
  sms_attempts: number;
  idempotency_key: string | null;
}

export async function createNotificationIntent(
  client: PoolClient,
  input: {
    shipmentId: string;
    shipmentEventId: string;
    notificationType:
      | "SHIPPED"
      | "OUT_FOR_DELIVERY"
      | "DELIVERY_FAILED"
      | "DELIVERED";
    recipient: string;
    attemptNo: number;
    payload: Record<string, unknown>;
    availableAt: Date;
  }
): Promise<void> {
  const idempotencyKey = [
    input.shipmentId,
    input.notificationType,
    input.attemptNo,
  ].join(":");

  // This function must be called using the SAME PoolClient and transaction
  // that inserted the shipment event.
  await client.query(
    `INSERT INTO notification_outbox (
       shipment_id,
       shipment_event_id,
       notification_type,
       recipient,
       payload,
       status,
       attempts,
       attempt_no,
       channel,
       idempotency_key,
       available_at,
       next_retry_at,
       updated_at
     )
     VALUES (
       $1, $2, $3, $4, $5::jsonb, 'PENDING', 0, $6,
       'WHATSAPP', $7, $8, $8, NOW()
     )
     ON CONFLICT (shipment_id, notification_type, attempt_no)
     DO NOTHING`,
    [
      input.shipmentId,
      input.shipmentEventId,
      input.notificationType,
      input.recipient,
      JSON.stringify(input.payload),
      input.attemptNo,
      idempotencyKey,
      input.availableAt,
    ]
  );
}

export async function claimNextNotification(
  pool: Pool,
  workerId: string
): Promise<OutboxMessage | null> {
  const client = await pool.connect();

  try {
    await client.query("BEGIN");

    const result = await client.query<OutboxMessage>(
      `WITH candidate AS (
         SELECT id
         FROM notification_outbox
         WHERE status = 'PENDING'
           AND available_at <= NOW()
         ORDER BY available_at, created_at, id
         FOR UPDATE SKIP LOCKED
         LIMIT 1
       )
       UPDATE notification_outbox AS n
       SET status = 'PROCESSING',
           locked_at = NOW(),
           locked_by = $1,
           lock_token = $2,
           updated_at = NOW()
       FROM candidate
       WHERE n.id = candidate.id
       RETURNING n.*`,
      [workerId, randomUUID()]
    );

    await client.query("COMMIT");
    return result.rows[0] ?? null;
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

export async function markNotificationSent(
  pool: Pool,
  message: OutboxMessage,
  lockToken: string,
  providerMessageId: string
): Promise<boolean> {
  const result = await pool.query(
    `UPDATE notification_outbox
     SET status = 'SENT',
         sent_at = NOW(),
         provider_message_id = $3,
         last_error = NULL,
         locked_at = NULL,
         locked_by = NULL,
         lock_token = NULL,
         updated_at = NOW()
     WHERE id = $1
       AND status = 'PROCESSING'
       AND lock_token = $2`,
    [message.id, lockToken, providerMessageId]
  );

  return result.rowCount === 1;
}

export async function dropStaleOutForDelivery(
  pool: Pool,
  message: OutboxMessage,
  lockToken: string
): Promise<boolean> {
  const result = await pool.query(
    `UPDATE notification_outbox AS n
     SET status = 'DROPPED',
         dropped_at = NOW(),
         drop_reason = 'SHIPMENT_ALREADY_DELIVERED',
         locked_at = NULL,
         locked_by = NULL,
         lock_token = NULL,
         updated_at = NOW()
     FROM shipments AS s
     WHERE n.id = $1
       AND n.shipment_id = s.id
       AND n.status = 'PROCESSING'
       AND n.lock_token = $2
       AND n.notification_type = 'OUT_FOR_DELIVERY'
       AND s.current_status = 'DELIVERED'`,
    [message.id, lockToken]
  );

  return result.rowCount === 1;
}
