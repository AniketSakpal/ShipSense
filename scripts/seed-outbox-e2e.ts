import { pool } from "../src/config/db/db.pool";
import { randomUUID } from "node:crypto";

async function main(): Promise<void> {
  const client = await pool.connect();

  try {
    const shipmentResult = await client.query<{
      shipment_id: string;
      shipment_event_id: string;
      customer_phone: string;
    }>(
      `SELECT s.id AS shipment_id,
              se.id AS shipment_event_id,
              s.customer_phone
       FROM shipments s
       JOIN shipment_events se ON se.shipment_id = s.id
       WHERE s.current_status <> 'DELIVERED'
         AND s.customer_phone IS NOT NULL
       ORDER BY s.updated_at DESC, se.created_at DESC
       LIMIT 1`
    );

    const fixture = shipmentResult.rows[0];
    if (!fixture) {
      throw new Error(
        "No suitable non-delivered shipment found. Register a test shipment and process a webhook first."
      );
    }

    const testKey = randomUUID();

    const inserted = await client.query<{ id: string }>(
      `INSERT INTO notification_outbox (
         shipment_id, shipment_event_id, notification_type, recipient,
         payload, status, attempts, attempt_no, channel,
         whatsapp_attempts, sms_attempts, available_at,
         next_retry_at, idempotency_key, updated_at
       )
       VALUES (
         $1, $2, 'E2E_TEST', $3,
         $4::jsonb, 'PENDING', 0, 900000, 'WHATSAPP',
         0, 0, NOW(), NOW(), $5, NOW()
       )
       RETURNING id`,
      [
        fixture.shipment_id,
        fixture.shipment_event_id,
        fixture.customer_phone,
        JSON.stringify({ notificationType: "E2E_TEST", test: true }),
        testKey,
      ]
    );

    console.log(JSON.stringify({
      outboxId: inserted.rows[0].id,
      shipmentId: fixture.shipment_id,
      message: "Test outbox job created",
    }, null, 2));
  } finally {
    client.release();
    await pool.end();
  }
}

main().catch((error) => {
  console.error("Seed failed:", error instanceof Error ? error.message : "UNKNOWN");
  process.exitCode = 1;
});