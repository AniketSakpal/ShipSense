
import type { Pool, PoolClient } from "pg";
import { randomUUID } from "node:crypto";
import type { NotificationChannel } from "../models/notification-job.model";
import type { NotificationOutboxInput } from "../models/notification-outbox.model";

import type { NotificationJob } from "../models/notification-job.model";


export async function createNotificationIntent(
  client: PoolClient,
  input: NotificationOutboxInput
): Promise<void> {
  // Keep the payload minimal. Never add order contents or medicine names.
  const safePayload = {
    notificationType: input.notificationType,
    ...input.payload,
  };

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
       whatsapp_attempts,
       sms_attempts,
       available_at,
       next_retry_at,
       idempotency_key,
       updated_at
     )
     VALUES (
       $1, $2, $3, $4, $5::jsonb, 'PENDING', 0, $6, 'WHATSAPP',
       0, 0, $7, $7, $8, NOW()
     )
     ON CONFLICT (shipment_id, notification_type, attempt_no)
     DO NOTHING`,
    [
      input.shipmentId,
      input.shipmentEventId,
      input.notificationType,
      input.recipient,
      JSON.stringify(safePayload),
      input.attemptNo,
      input.availableAt,
      randomUUID(),
    ]
  );
}

export async function claimNextNotification(
  pool: Pool,
  workerId: string
): Promise<NotificationJob | null> {
  const client = await pool.connect();

  try {
    await client.query("BEGIN");

    // Recover jobs whose worker died while holding a lease.
    // The timeout should exceed the provider's configured timeout.
    await client.query(
      `UPDATE notification_outbox
       SET status = 'PENDING',
           locked_at = NULL,
           locked_by = NULL,
           lock_token = NULL,
           updated_at = NOW()
       WHERE status = 'PROCESSING'
         AND locked_at < NOW() - INTERVAL '2 minutes'`
    );

    const result = await client.query<NotificationJob>(
      `WITH candidate AS (
         SELECT no.id
         FROM notification_outbox no
         JOIN shipments s ON s.id = no.shipment_id
         WHERE no.status = 'PENDING'
           AND no.available_at <= NOW()
           AND s.current_status <> 'DELIVERED'
         ORDER BY no.available_at, no.created_at, no.id
         FOR UPDATE OF no SKIP LOCKED
         LIMIT 1
       )
       UPDATE notification_outbox no
       SET status = 'PROCESSING',
           locked_at = NOW(),
           locked_by = $1,
           lock_token = $2,
           updated_at = NOW()
       FROM candidate c
       WHERE no.id = c.id
       RETURNING no.*`,
      [workerId, randomUUID()]
    );

    // Mark queued out-for-delivery notifications stale if the shipment
    // is already delivered. Do not send an obsolete notification.
    await client.query(
      `UPDATE notification_outbox no
       SET status = 'DROPPED',
           dropped_at = NOW(),
           drop_reason = 'STALE_AFTER_DELIVERY',
           locked_at = NULL,
           locked_by = NULL,
           lock_token = NULL,
           updated_at = NOW()
       FROM shipments s
       WHERE no.shipment_id = s.id
         AND s.current_status = 'DELIVERED'
         AND no.status = 'PENDING'
         AND no.notification_type = 'OUT_FOR_DELIVERY'`
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
  job: NotificationJob,
  providerMessageId: string
): Promise<void> {
  await pool.query(
    `UPDATE notification_outbox
     SET status = 'SENT',
         sent_at = NOW(),
         provider_message_id = $3,
         attempts = attempts + 1,
         whatsapp_attempts = whatsapp_attempts
           + CASE WHEN channel = 'WHATSAPP' THEN 1 ELSE 0 END,
         sms_attempts = sms_attempts
           + CASE WHEN channel = 'SMS' THEN 1 ELSE 0 END,
         locked_at = NULL,
         locked_by = NULL,
         lock_token = NULL,
         last_error = NULL,
         updated_at = NOW()
     WHERE id = $1
       AND status = 'PROCESSING'
       AND lock_token = $2`,
    [job.id, job.lock_token, providerMessageId]
  );
}

export async function markNotificationFailed(
  pool: Pool,
  job: NotificationJob,
  errorMessage: string,
  retryDelayMs: number
): Promise<void> {
  const isWhatsApp = job.channel === "WHATSAPP";
  const nextWhatsAppAttempts = job.whatsapp_attempts + (isWhatsApp ? 1 : 0);
  const nextSmsAttempts = job.sms_attempts + (isWhatsApp ? 0 : 1);

  let nextStatus = "PENDING";
  let nextChannel: NotificationChannel = job.channel;
  let deadLetteredAt: Date | null = null;
  let delay = retryDelayMs;

  if (isWhatsApp && nextWhatsAppAttempts >= 3) {
    // Switch channel after three failed WhatsApp attempts.
    nextChannel = "SMS";
    delay = 0;
  } else if (!isWhatsApp && nextSmsAttempts >= 3) {
    nextStatus = "DEAD_LETTER";
    deadLetteredAt = new Date();
  }

  await pool.query(
    `UPDATE notification_outbox
     SET status = $3::notification_status,
         channel = $4,
         attempts = attempts + 1,
         whatsapp_attempts = $5,
         sms_attempts = $6,
         available_at = NOW() + ($7 * INTERVAL '1 millisecond'),
         next_retry_at = CASE
           WHEN $3 = 'PENDING'
           THEN NOW() + ($7 * INTERVAL '1 millisecond')
           ELSE NULL
         END,
         dead_lettered_at = $8,
         last_error = $9,
         locked_at = NULL,
         locked_by = NULL,
         lock_token = NULL,
         updated_at = NOW()
     WHERE id = $1
       AND status = 'PROCESSING'
       AND lock_token = $2`,
    [
      job.id,
      job.lock_token,
      nextStatus,
      nextChannel,
      nextWhatsAppAttempts,
      nextSmsAttempts,
      delay,
      deadLetteredAt,
      errorMessage.slice(0, 500),
    ]
  );
}

export async function dropNotification(
  pool: Pool,
  job: NotificationJob,
  reason: string
): Promise<void> {
  await pool.query(
    `UPDATE notification_outbox
     SET status = 'DROPPED',
         dropped_at = NOW(),
         drop_reason = $3,
         locked_at = NULL,
         locked_by = NULL,
         lock_token = NULL,
         updated_at = NOW()
     WHERE id = $1
       AND status = 'PROCESSING'
       AND lock_token = $2`,
    [job.id, job.lock_token, reason]
  );
}

export async function listOutbox(
  pool: Pool,
  status: string | undefined,
  limit = 100
) {
  const allowed = new Set([
    "PENDING",
    "PROCESSING",
    "SENT",
    "FAILED",
    "DEAD_LETTER",
    "DROPPED",
  ]);

  if (status && !allowed.has(status)) {
    throw new Error("INVALID_OUTBOX_STATUS");
  }

  const values: unknown[] = [];
  let where = "";

  if (status) {
    values.push(status);
    where = "WHERE status = $1::notification_status";
  }

  values.push(Math.min(Math.max(limit, 1), 200));

  const result = await pool.query(
    `SELECT id, shipment_id, shipment_event_id, notification_type,
            status, channel, attempts, whatsapp_attempts, sms_attempts,
            attempt_no, available_at, created_at, sent_at, last_error,
            dead_lettered_at, dropped_at, drop_reason, replay_count
     FROM notification_outbox
     ${where}
     ORDER BY created_at DESC
     LIMIT $${values.length}`,
    values
  );

  return result.rows;
}

export async function replayDeadLetter(
  pool: Pool,
  id: string
): Promise<boolean> {
  const result = await pool.query(
    `UPDATE notification_outbox
     SET status = 'PENDING',
         channel = 'WHATSAPP',
         attempts = 0,
         whatsapp_attempts = 0,
         sms_attempts = 0,
         available_at = NOW(),
         next_retry_at = NULL,
         dead_lettered_at = NULL,
         last_error = NULL,
         locked_at = NULL,
         locked_by = NULL,
         lock_token = NULL,
         replay_count = replay_count + 1,
         idempotency_key = $2,
         updated_at = NOW()
     WHERE id = $1
       AND status = 'DEAD_LETTER'
     RETURNING id`,
    [id, randomUUID()]
  );

  return result.rowCount === 1;
}