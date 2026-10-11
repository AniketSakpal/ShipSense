import { pool } from "../src/config/db/db.pool";
import { ndrCourierActionWorker } from "../src/services/ndr/ndr-courier-action-worker.service";

async function main(): Promise<void> {
  try {
    const result = await ndrCourierActionWorker.processOne();
    console.log(`[NDR courier worker] ${result}`);
  } finally {
    await pool.end();
  }
}

main().catch((error: unknown) => {
  console.error(
    "[NDR courier worker] Fatal error:",
    error instanceof Error ? error.message : error,
  );
  process.exitCode = 1;
});