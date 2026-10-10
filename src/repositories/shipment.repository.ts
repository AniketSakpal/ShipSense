
import { pool } from "../config/db/db.pool";
import type { CreateShipmentInput } from "../schemas/shipment.schema";
import type { ShipmentRow } from "../models/shipment.row";
import type { PoolClient } from "pg";


export class ShipmentConflictError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ShipmentConflictError";
  }
}

export async function registerShipment(
  input: CreateShipmentInput
): Promise<{ shipment: ShipmentRow; created: boolean }> {
  const client = await pool.connect();

  try {
    await client.query("BEGIN");

    const courierResult = await client.query<{
      id: string;
    }>(
      `SELECT id
         FROM couriers
        WHERE code = $1
          AND is_active = TRUE`,
      [input.courier]
    );

    if (courierResult.rowCount === 0) {
      throw new Error(`ACTIVE_COURIER_NOT_FOUND:${input.courier}`);
    }

    const courierId = courierResult.rows[0]?.id;

    const insertResult = await client.query<ShipmentRow>(
      `INSERT INTO shipments (
         courier_id,
         awb,
         order_ref,
         customer_ref,
         customer_phone,
         payment_mode,
         cod_amount_paise
       )
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       ON CONFLICT (courier_id, awb) DO NOTHING
       RETURNING
         id,
         awb,
         $8::text AS courier,
         order_ref,
         customer_ref,
         customer_phone,
         payment_mode,
         cod_amount_paise::text,
         current_status,
         registered_at`,
      [
        courierId,
        input.awb,
        input.order_ref,
        input.customer_ref,
        input.customer_phone,
        input.payment_mode,
        input.cod_amount_paise,
        input.courier,
      ]
    );

    if (insertResult.rowCount === 1) {
        await releaseUnmatchedEvents(
        client,
        courierId || "", 
        input.courier,
        input.awb
        );
      await client.query("COMMIT");

      return {
        shipment: insertResult.rows[0]? {} as ShipmentRow : ({} as ShipmentRow),
        created: true,
      };
    }

    // The shipment already exists. Compare the immutable registration data.
    const existingResult = await client.query<ShipmentRow>(
      `SELECT
         s.id,
         s.awb,
         c.code AS courier,
         s.order_ref,
         s.customer_ref,
         s.customer_phone,
         s.payment_mode,
         s.cod_amount_paise::text,
         s.current_status,
         s.registered_at
       FROM shipments s
       JOIN couriers c ON c.id = s.courier_id
       WHERE s.courier_id = $1
         AND s.awb = $2
       FOR UPDATE OF s`,
      [courierId, input.awb]
    );

    if (existingResult.rowCount === 0) {
      throw new Error("SHIPMENT_CONFLICT_RETRY");
    }

    const existing = existingResult.rows[0];

    const matches =
      existing?.order_ref === input.order_ref &&
      existing.customer_ref === input.customer_ref &&
      existing.customer_phone === input.customer_phone &&
      existing.payment_mode === input.payment_mode &&
      BigInt(existing.cod_amount_paise) ===
        BigInt(input.cod_amount_paise);

    if (!matches) {
      throw new ShipmentConflictError(
        "This courier and AWB are already registered with different shipment details"
      );
    }
    await releaseUnmatchedEvents(
        client,
        courierId || "", 
        input.courier,
        input.awb
        );
    await client.query("COMMIT");

    return {
      shipment: existing,
      created: false,
    };
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

async function releaseUnmatchedEvents(
  client: PoolClient,
  courierId: string,
  courier: "SWIFTSHIP" | "BLUEROUTE",
  awb: string
): Promise<void> {
  const payloadField =
    courier === "SWIFTSHIP" ? "awb" : "tracking_number";

  // payloadField is selected from a fixed allowlist, not user input.
  await client.query(
    `UPDATE webhook_events
        SET next_retry_at = NULL,
            last_error = NULL
      WHERE courier_id = $1
        AND processing_status = 'RECEIVED'
        AND last_error = 'UNMATCHED_SHIPMENT_AWB'
        AND payload ->> '${payloadField}' = $2`,
    [courierId, awb]
  );
}
