
import { pool } from "../src/config/db/db.pool";

async function main(): Promise<void> {
  const id = process.argv[2];
  const expectedStatus = process.argv[3] ?? "SENT";
  const timeoutMs = Number(process.env.E2E_TIMEOUT_MS ?? 30000);
  const started = Date.now();

  if (!id) {
    throw new Error(
      "Usage: npx tsx scripts/test-outbox-e2e.ts <outbox-id> [expected-status]"
    );
  }

  try {
    while (Date.now() - started < timeoutMs) {
      const result = await pool.query<{
        status: string;
        channel: string;
        attempts: number;
        whatsapp_attempts: number;
        sms_attempts: number;
        last_error: string | null;
      }>(
        `SELECT status, channel, attempts, whatsapp_attempts,
                sms_attempts, last_error
         FROM notification_outbox
         WHERE id = $1`,
        [id]
      );

      const job = result.rows[0];
      if (!job) throw new Error(`Outbox job not found: ${id}`);

      console.log(JSON.stringify(job));

      if (job.status === expectedStatus) {
        console.log(`PASS: reached ${expectedStatus}`);
        return;
      }

      if (job.status === "DEAD_LETTER" && expectedStatus !== "DEAD_LETTER") {
        throw new Error("Job reached DEAD_LETTER before expected status");
      }

      await new Promise((resolve) => setTimeout(resolve, 500));
    }

    throw new Error(
      `Timed out waiting for ${expectedStatus} after ${timeoutMs}ms`
    );
  } finally {
    await pool.end();
  }
}

main().catch((error) => {
  console.error("FAIL:", error instanceof Error ? error.message : "UNKNOWN");
  process.exitCode = 1;
});
