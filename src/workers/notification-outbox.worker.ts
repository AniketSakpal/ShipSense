import { randomInt } from "node:crypto";
import { pool } from "../config/db/db.pool";
import { processOneNotification } from "../services/notification-outbox.service";
import dotenv from "dotenv";
dotenv.config();

const workerId =
  process.env.NOTIFICATION_WORKER_ID ?? `notification-worker-${process.pid}`;

const pollMs = Math.max(
  250,
  Number(process.env.NOTIFICATION_WORKER_POLL_MS ?? 1000)
);

let running = false;
let loopPromise: Promise<void> | undefined;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function runLoop(): Promise<void> {
  while (running) {
    try {
      const processed = await processOneNotification(pool, workerId);
      if (!processed && running) {
        await sleep(pollMs + randomInt(0, 251));
      }
    } catch (error) {
      // Do not print provider payloads or customer data here.
      console.error(JSON.stringify({
        event: "notification_worker_error",
        workerId,
        error: error instanceof Error ? error.message : "UNKNOWN_ERROR",
      }));
      await sleep(pollMs * 2);
    }
  }
}

export function startNotificationOutboxWorker(): void {
  if (running) return;
  running = true;
  loopPromise = runLoop();
  console.info(JSON.stringify({ event: "notification_worker_started", workerId }));
}

export async function stopNotificationOutboxWorker(): Promise<void> {
  running = false;
  await loopPromise;
  console.info(JSON.stringify({ event: "notification_worker_stopped", workerId }));
}