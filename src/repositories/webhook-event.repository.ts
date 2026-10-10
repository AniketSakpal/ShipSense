
import { createHash } from "node:crypto";
import type { Pool } from "pg";


export type CourierCode = "SWIFTSHIP" | "BLUEROUTE";

export type IngestResult =
  | { kind: "inserted"; eventId: string }
  | { kind: "duplicate"; eventId: string }
  | { kind: "collision"; eventId: string };

export interface WebhookInput {
  courierCode: CourierCode;
  rawBody: Buffer;
  payload: Record<string, unknown>;
}

function sha256(value: Buffer | string): string {
  return createHash("sha256").update(value).digest("hex");
}

function makeDedupKey(input: WebhookInput): string {
  if (input.courierCode === "SWIFTSHIP") {
    const eventId = input.payload.event_id;
    if (typeof eventId !== "string" || eventId.trim() === "") {
      throw new Error("INVALID_SWIFTSHIP_EVENT_ID");
    }

    return `ss:${eventId}`;
  }

  const awb = input.payload.tracking_number;
  const reference = input.payload.reference;
  const code = input.payload.code;
  const timestamp = input.payload.ts;

  if (
    typeof awb !== "string" ||
    typeof reference !== "string" ||
    (typeof code !== "number" && typeof code !== "string") ||
    typeof timestamp !== "number"
  ) {
    throw new Error("INVALID_BLUEROUTE_DEDUP_FIELDS");
  }

  // BlueRoute has no event ID. Build a stable identity from event fields,
  // not the full body, so harmless formatting changes don't create new events.
  const identity = JSON.stringify([
    awb,
    reference,
    String(code),
    timestamp,
  ]);

  return `br:${sha256(identity)}`;
}

function getExternalEventId(input: WebhookInput): string | null {
  if (input.courierCode === "SWIFTSHIP") {
    return input.payload.event_id as string;
  }

  return null;
}

export async function ingestWebhookEvent(
  pool: Pool,
  input: WebhookInput,
): Promise<IngestResult> {
  const dedupKey = makeDedupKey(input);
  const externalEventId = getExternalEventId(input);
  const bodyHash = sha256(input.rawBody);

  const client = await pool.connect();

  try {
    await client.query("BEGIN");

    const courierResult = await client.query<{ id: string }>(
      `SELECT id
       FROM public.couriers
       WHERE code = $1
         AND is_active = TRUE
         AND webhook_enabled = TRUE
       FOR SHARE`,
      [input.courierCode],
    );

    const courier = courierResult.rows[0];

    if (!courier) {
      throw new Error("COURIER_NOT_CONFIGURED_OR_DISABLED");
    }

    // The unique index on (courier_id, dedup_key) is the concurrency guard.
    const insertResult = await client.query<{ id: string }>(
      `INSERT INTO public.webhook_events (
         courier_id,
         external_event_id,
         raw_body,
         payload,
         signature_valid,
         processing_status,
         dedup_key
       )
       VALUES ($1, $2, $3, $4::jsonb, TRUE, 'RECEIVED', $5)
       ON CONFLICT (courier_id, dedup_key)
         WHERE dedup_key IS NOT NULL
       DO NOTHING
       RETURNING id`,
      [
        courier.id,
        externalEventId,
        input.rawBody,
        JSON.stringify(input.payload),
        dedupKey,
      ],
    );

    if (insertResult.rows[0]) {
      await client.query("COMMIT");
      return { kind: "inserted", eventId: insertResult.rows[0].id };
    }

    // A concurrent request or retry already inserted this identity.
    const existingResult = await client.query<{
      id: string;
      raw_body: Buffer;
      processing_status: string;
    }>(
      `SELECT id, raw_body, processing_status
       FROM public.webhook_events
       WHERE courier_id = $1
         AND dedup_key = $2
       FOR SHARE`,
      [courier.id, dedupKey],
    );

    const existing = existingResult.rows[0];

    if (!existing) {
      throw new Error("DEDUP_CONFLICT_ROW_NOT_FOUND");
    }

    if (Buffer.from(existing.raw_body).equals(input.rawBody)) {
      await client.query("COMMIT");
      return { kind: "duplicate", eventId: existing.id };
    }

    // Different bytes for the same logical event identity.
    // Preserve the conflicting body under a deterministic, separate key.
    // Repeated delivery of this same conflicting body will also deduplicate.
    const collisionKey = `collision:${dedupKey}:${bodyHash}`;

    const collisionResult = await client.query<{ id: string }>(
      `INSERT INTO public.webhook_events (
         courier_id,
         external_event_id,
         raw_body,
         payload,
         signature_valid,
         processing_status,
         dedup_key,
         processed_at,
         last_error
       )
       VALUES (
         $1, $2, $3, $4::jsonb, TRUE, 'IGNORED',
         $5, NOW(), $6
       )
       ON CONFLICT (courier_id, dedup_key)
         WHERE dedup_key IS NOT NULL
       DO NOTHING
       RETURNING id`,
      [
        courier.id,
        externalEventId,
        input.rawBody,
        JSON.stringify(input.payload),
        collisionKey,
        `EVENT_ID_COLLISION: identity=${dedupKey}; original_event_id=${existing.id}; incoming_sha256=${bodyHash}`,
      ],
    );

    if (collisionResult.rows[0]) {
      await client.query("COMMIT");
      return {
        kind: "collision",
        eventId: collisionResult.rows[0].id,
      };
    }

    // This exact collision body was already recorded by another request.
    const priorCollision = await client.query<{ id: string }>(
      `SELECT id
       FROM public.webhook_events
       WHERE courier_id = $1
         AND dedup_key = $2`,
      [courier.id, collisionKey],
    );

    if (!priorCollision.rows[0]) {
      throw new Error("COLLISION_RECORD_NOT_FOUND");
    }

    await client.query("COMMIT");
    return { kind: "collision", eventId: priorCollision.rows[0].id };
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}
