import { randomInt } from "node:crypto";
import type { Pool } from "pg";
import {
  claimNextNotification,
  markNotificationFailed,
  markNotificationSent,
} from "../repositories/notification-outbox.repository";

import type { NotificationJob } from "../models/notification-job.model";
import { sendNotification } from "./notification-provider.service";

function retryDelayMs(attemptNumber: number): number {
  const base = 1000;
  const max = Number(process.env.NOTIFICATION_MAX_BACKOFF_MS ?? 60000);
  const exponential = Math.min(max, base * 2 ** Math.max(0, attemptNumber - 1));

  // Full jitter: random delay between zero and the exponential cap.
  return randomInt(0, Math.max(2, Math.floor(exponential) + 1));
}

function safeError(error: unknown): string {
  if (error instanceof Error) {
    // Provider errors should contain codes, not recipient or payload data.
    return error.message.slice(0, 500);
  }
  return "UNKNOWN_PROVIDER_ERROR";
}

async function processJob(pool: Pool, job: NotificationJob): Promise<void> {
  try {
    // Recheck the shipment immediately before sending. Claiming already
    // excludes delivered shipments, but state may have changed afterwards.
    const state = await pool.query<{ current_status: string }>(
      `SELECT current_status
       FROM shipments
       WHERE id = $1`,
      [job.shipment_id]
    );

    if (state.rows[0]?.current_status === "DELIVERED"
        && job.notification_type === "OUT_FOR_DELIVERY") {
      const { dropNotification } = await import(
        "../repositories/notification-outbox.repository"
      );
      await dropNotification(pool, job, "STALE_AFTER_DELIVERY");
      return;
    }

    const result = await sendNotification({
      channel: job.channel,
      recipient: job.recipient,
      notificationType: job.notification_type,
      payload: job.payload,
      idempotencyKey: job.idempotency_key ?? job.id,
    });

    await markNotificationSent(pool, job, result.messageId);
  } catch (error) {
    const retryNumber = job.attempts + 1;
    await markNotificationFailed(
      pool,
      job,
      safeError(error),
      retryDelayMs(retryNumber)
    );
  }
}

export async function processOneNotification(
  pool: Pool,
  workerId: string
): Promise<boolean> {
  const job = await claimNextNotification(pool, workerId);
  if (!job) return false;

  await processJob(pool, job);
  return true;
}