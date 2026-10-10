import { pool } from "../config/db/db.pool";
import { processOnePendingWebhook } from "../repositories/shipment-event.repository";
import dotenv from "dotenv";
dotenv.config();

type ProcessingResult = "PROCESSED" | "UNMATCHED" | "FAILED" | "DUPLICATE" | "EMPTY";

type ProcessingCounts = Record<Exclude<ProcessingResult, "EMPTY">, number>;

const DEFAULT_POLL_INTERVAL_MS = 5_000;
const DEFAULT_ERROR_BACKOFF_MS = 1_000;
const MAX_ERROR_BACKOFF_MS = 30_000;

const counts: ProcessingCounts = {
  PROCESSED: 0,
  UNMATCHED: 0,
  FAILED: 0,
  DUPLICATE: 0,
};

let stopRequested = false;
let workerPromise: Promise<void> | undefined;
let sleepTimer: ReturnType<typeof setTimeout> | undefined;
let wakeSleepingWorker: (() => void) | undefined;

function readPositiveIntegerEnv(name: string, fallback: number): number {
  const raw = process.env[name];
  if (raw === undefined || raw.trim() === "") return fallback;

  const value = Number(raw);
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new Error(`${name} must be a positive integer; received: ${raw}`);
  }
  return value;
}

const pollIntervalMs = readPositiveIntegerEnv(
  "WEBHOOK_WORKER_POLL_INTERVAL_MS",
  DEFAULT_POLL_INTERVAL_MS
);
const errorBackoffBaseMs = readPositiveIntegerEnv(
  "WEBHOOK_WORKER_ERROR_BACKOFF_MS",
  DEFAULT_ERROR_BACKOFF_MS
);

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    sleepTimer = setTimeout(() => {
      sleepTimer = undefined;
      wakeSleepingWorker = undefined;
      resolve();
    }, ms);

    // Allows shutdown to wake the worker immediately instead of waiting for the full delay.
    wakeSleepingWorker = () => {
      if (sleepTimer) clearTimeout(sleepTimer);
      sleepTimer = undefined;
      wakeSleepingWorker = undefined;
      resolve();
    };
  });
}

function getErrorBackoffMs(consecutiveErrors: number): number {
  const exponential = Math.min(
    errorBackoffBaseMs * 2 ** Math.min(consecutiveErrors - 1, 10),
    MAX_ERROR_BACKOFF_MS
  );
  // Add 0-20% jitter so multiple worker instances are less likely to retry in lockstep.
  return Math.round(exponential + Math.random() * exponential * 0.2);
}

/**
 * Starts the continuous worker. Calling this more than once in the same process
 * returns the existing worker promise rather than starting a duplicate loop.
 * The worker deliberately does not close the shared PostgreSQL pool.
 */
export function startWebhookProcessor(): Promise<void> {
  if (workerPromise) return workerPromise;

  stopRequested = false;
  workerPromise = runWorker().finally(() => {
    workerPromise = undefined;
  });
  return workerPromise;
}

/** Requests a graceful stop. An in-flight database operation is allowed to finish. */
export function stopWebhookProcessor(): void {
  stopRequested = true;
  wakeSleepingWorker?.();
}

/** Resolves after the current processing operation and worker loop have finished. */
export async function waitForWebhookProcessorToStop(): Promise<void> {
  if (workerPromise) await workerPromise;
}

async function runWorker(): Promise<void> {
  let consecutiveErrors = 0;
  console.info(
    `[WebhookWorker] Started; idle poll interval=${pollIntervalMs}ms, error backoff base=${errorBackoffBaseMs}ms`
  );

  try {
    while (!stopRequested) {
      try {
        const result = (await processOnePendingWebhook(pool)) as ProcessingResult;
        consecutiveErrors = 0;

        if (result === "EMPTY") {
          // No pending work: avoid hammering PostgreSQL while idle.
          await sleep(pollIntervalMs);
          continue;
        }

        counts[result]++;
        console.info(`[WebhookWorker] Processing result: ${result}`, {
          counts: { ...counts },
        });
        // Work was found; immediately continue draining the backlog.
      } catch (error: unknown) {
        consecutiveErrors++;
        const delayMs = getErrorBackoffMs(consecutiveErrors);
        console.error("[WebhookWorker] Processing iteration failed; will retry", {
          consecutiveErrors,
          retryInMs: delayMs,
          error: error instanceof Error ? error.message : String(error),
        });
        await sleep(delayMs);
      }
    }
  } finally {
    console.info("[WebhookWorker] Stopped. Processing summary:", { ...counts });
  }
}
