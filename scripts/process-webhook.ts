import { pool } from "../src/config/db/db.pool";
import { processOnePendingWebhook } from "../src/repositories/shipment-event.repository";

async function main(): Promise<void> {
  const counts = {
    PROCESSED: 0,
    UNMATCHED: 0,
    FAILED: 0,
    DUPLICATE: 0,
  };

  try {
    while (true) {
      const result = await processOnePendingWebhook(pool);

      if (result === "EMPTY") {
        break;
      }

      counts[result]++;
      console.log(`Webhook processing result: ${result}`);
    }

    console.log("Processing summary:", counts);
  } finally {
    await pool.end();
  }
}

main().catch((error: unknown) => {
  console.error(
    "Webhook processing failed:",
    error instanceof Error ? error.message : error
  );
  process.exitCode = 1;
});