import { pool } from "../config/db/db.pool";
import { ndrCourierActionWorker } from "../services/ndr/ndr-courier-action-worker.service";
import { escalateExpiredNdrCases } from "../services/ndr/ndr-deadline.service";

const POLL_INTERVAL_MS = 1_000;

let isRunning = true;
let isShuttingDown = false;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function runWorker(): Promise<void> {
  console.log("[NDR Worker] Started");
  console.log(`[NDR Worker] Poll interval: ${POLL_INTERVAL_MS}ms`);
    let lastDeadlineCheckAt = 0;
  while (isRunning) {
    try {
const now = Date.now();

      if (now - lastDeadlineCheckAt >= 30_000) {
        const result = await escalateExpiredNdrCases();
        lastDeadlineCheckAt = Date.now();

        if (result.escalatedCount > 0) {
          console.info(
            `[NDR Worker] Automatically escalated ${result.escalatedCount} expired case(s).`
          );
        }
      }


      // Process at most one available action per iteration.
      // The service should return promptly when no action is available.
      const result = await ndrCourierActionWorker.processOne();

      if (result) {
        console.log(`[NDR Worker] Process result: ${result}`);
      } else {
        // No action was available; avoid continuously querying PostgreSQL.
        await sleep(POLL_INTERVAL_MS);
      }
    } catch (error: unknown) {
      console.error(
        "[NDR Worker] Processing error:",
        error instanceof Error ? error.message : error
      );

      // Prevent a database outage from causing a tight retry loop.
      await sleep(POLL_INTERVAL_MS);
    }
  }
}

async function shutdown(signal: string): Promise<void> {
  if (isShuttingDown) return;

  isShuttingDown = true;
  isRunning = false;

  console.log(`[NDR Worker] Received ${signal}; shutting down...`);
}

process.on("SIGINT", () => {
  void shutdown("SIGINT");
});

process.on("SIGTERM", () => {
  void shutdown("SIGTERM");
});

async function main(): Promise<void> {
  try {
    await runWorker();
  } finally {
    await pool.end();
    console.log("[NDR Worker] PostgreSQL pool closed");
  }
}

main().catch((error: unknown) => {
  console.error("[NDR Worker] Fatal error:", error);
  process.exitCode = 1;
});