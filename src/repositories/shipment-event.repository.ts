import type { Pool, PoolClient } from "pg";
import type { PendingWebhook,CourierCode } from "../models/webhook/pending-webhook";
import {
  createNotificationIntent,
} from "./notification-outbox.repository";

import {
  getNotificationTime,
} from "../services/notification-schedule.service";
import { ndrWebhookService } from "../services/ndr/ndr-webhook.service";
import type { NdrFailureReason } from "../types/ndr/ndr.types";


function getAwb(
  courierCode: CourierCode,
  payload: Record<string, unknown>
): string | null {
  const value =
    courierCode === "SWIFTSHIP"
      ? payload.awb
      : payload.tracking_number;

  return typeof value === "string" && value.trim()
    ? value.trim()
    : null;
}

function getExternalStatusCode(
  courierCode: CourierCode,
  payload: Record<string, unknown>
): string | null {
  const value =
    courierCode === "SWIFTSHIP"
      ? payload.status
      : payload.code;

  if (typeof value === "string" || typeof value === "number") {
    return String(value);
  }

  return null;
}

function getEventTime(
  courierCode: CourierCode,
  payload: Record<string, unknown>
): Date | null {
  let date: Date;

  if (courierCode === "SWIFTSHIP") {
    if (typeof payload.event_time !== "string") return null;

    // Courier timestamps are IST, regardless of the server timezone.
    const value = payload.event_time.replace(" ", "T") + "+05:30";
    date = new Date(value);
  } else {
    if (
      typeof payload.ts !== "number" ||
      !Number.isFinite(payload.ts)
    ) {
      return null;
    }

    // BlueRoute ts is Unix epoch milliseconds (UTC).
    date = new Date(payload.ts);
  }

  return Number.isNaN(date.getTime()) ? null : date;
}

async function markFailed(
  pool: Pool,
  eventId: string,
  errorMessage: string
): Promise<void> {
  await pool.query(
    `UPDATE webhook_events
       SET processing_status = 'FAILED',
           processing_attempts = processing_attempts + 1,
           last_error = $2,
           next_retry_at = NULL
     WHERE id = $1
       AND processing_status = 'RECEIVED'`,
    [eventId, errorMessage]
  );
}

async function processLockedEvent(
  client: PoolClient,
  event: PendingWebhook
): Promise<"PROCESSED" | "UNMATCHED" | "FAILED" | "DUPLICATE"> {
  const awb = getAwb(event.courier_code, event.payload);
  const externalCode = getExternalStatusCode(
    event.courier_code,
    event.payload
  );
  const eventTime = getEventTime(event.courier_code, event.payload);

  if (!awb || !externalCode || !eventTime) {
    await client.query(
      `UPDATE webhook_events
          SET processing_status = 'FAILED',
              processing_attempts = processing_attempts + 1,
              last_error = $2,
              next_retry_at = NULL
        WHERE id = $1`,
      [
        event.id,
        !awb
          ? "MISSING_OR_INVALID_AWB"
          : !externalCode
            ? "MISSING_OR_INVALID_STATUS_CODE"
            : "MISSING_OR_INVALID_EVENT_TIME",
      ]
    );

    return "FAILED";
  }

  const shipmentResult = await client.query<{
    id: string;
    current_status: string;
    last_status_event_id: string | null;
     customer_phone: string;
      payment_mode: "COD" | "PREPAID";
  cod_amount_paise: string | number;
  }>(
    `SELECT
      id,
      current_status,
      last_status_event_id,
      customer_phone,
      payment_mode,
      cod_amount_paise
   FROM shipments
   WHERE courier_id = $1
     AND awb = $2
   FOR UPDATE`,
    [event.courier_id, awb]
  );

  if (shipmentResult.rowCount === 0) {
    // Keep the event available for later reconciliation.
    await client.query(
      `UPDATE webhook_events
          SET processing_attempts = processing_attempts + 1,
              last_error = 'UNMATCHED_SHIPMENT_AWB',
              next_retry_at = NOW() + INTERVAL '1 minute'
        WHERE id = $1`,
      [event.id]
    );

    return "UNMATCHED";
  }

  const shipment = shipmentResult.rows[0];

  // BlueRoute code 10 is informational, not a new shipment status.
  const informational =
    event.courier_code === "BLUEROUTE" && externalCode === "10";

  let mappedStatus: string;

  if (informational) {
    mappedStatus = shipment?.current_status ?? "UNKNOWN";
  } else {
    const mappingResult = await client.query<{
      internal_status: string;
    }>(
      `SELECT internal_status
         FROM courier_status_code_mappings
        WHERE courier_id = $1
          AND external_status_code = $2
          AND is_active = TRUE`,
      [event.courier_id, externalCode]
    );

    if (mappingResult.rowCount === 0) {
      await client.query(
        `UPDATE webhook_events
            SET processing_status = 'FAILED',
                processing_attempts = processing_attempts + 1,
                last_error = $2,
                next_retry_at = NULL
          WHERE id = $1`,
        [event.id, `UNKNOWN_STATUS_CODE:${externalCode}`]
      );

      return "FAILED";
    }

    mappedStatus = mappingResult?.rows[0]?.internal_status ?? "UNKNOWN";
  }

  if (!event.dedup_key) {
    await client.query(
      `UPDATE webhook_events
          SET processing_status = 'FAILED',
              last_error = 'MISSING_DEDUP_KEY',
              next_retry_at = NULL
        WHERE id = $1`,
      [event.id]
    );

    return "FAILED";
  }

  // The unique constraint on (courier_id, dedup_key) makes this idempotent.
  const currentEventResult = await client.query<{
    event_time: Date;
    dedup_key: string;
  }>(
    `SELECT event_time, dedup_key
       FROM shipment_events
      WHERE id = $1`,
    [shipment?.last_status_event_id ?? null]
  );

  const currentEvent = currentEventResult.rows[0];

  // Event time determines order. dedup_key breaks timestamp ties consistently.
  const isNewer =
    !currentEvent ||
    eventTime.getTime() > new Date(currentEvent.event_time).getTime() ||
    (eventTime.getTime() ===
      new Date(currentEvent.event_time).getTime() &&
      event.dedup_key > currentEvent.dedup_key);

  const stateChanged =
    isNewer && mappedStatus !== shipment?.current_status;

  const decisionReason = informational
    ? "INFORMATIONAL_EVENT"
    : isNewer
      ? stateChanged
        ? "APPLIED_NEWER_EVENT"
        : "APPLIED_NEWER_EVENT_SAME_STATUS"
      : "OLDER_EVENT_NO_STATE_REGRESSION";

  const timelineResult = await client.query<{ id: string }>(
    `INSERT INTO shipment_events (
       shipment_id,
       courier_id,
       webhook_event_id,
       dedup_key,
       external_event_id,
       status,
       event_time,
       location,
       description,
       state_changed,
       decision_reason,
       metadata
     )
     VALUES (
       $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12::jsonb
     )
     ON CONFLICT (courier_id, dedup_key) DO NOTHING
     RETURNING id`,
    [
      shipment?.id,
      event.courier_id,
      event.id,
      event.dedup_key,
      event.external_event_id,
      mappedStatus,
      eventTime,
      event.courier_code === "SWIFTSHIP"
        ? event.payload.location ?? null
        : event.payload.hub ?? null,
      event.courier_code === "SWIFTSHIP"
        ? event.payload.status_detail ?? null
        : event.payload.message ?? null,
      stateChanged,
      decisionReason,
      JSON.stringify(event.payload),
    ]
  );

  if (timelineResult.rowCount === 0) {
    await client.query(
      `UPDATE webhook_events
          SET processing_status = 'PROCESSED',
              processed_at = NOW(),
              last_error = NULL,
              next_retry_at = NULL
        WHERE id = $1`,
      [event.id]
    );

    return "DUPLICATE";
  }

  const timelineEventId = timelineResult.rows[0]?.id;

  // Informational events and older events never change the shipment's state.
  if (isNewer && !informational) {
    await client.query(
      `UPDATE shipments
          SET current_status = $2,
              last_status_event_id = $3,
              updated_at = NOW()
        WHERE id = $1`,
      [shipment?.id, mappedStatus, timelineEventId]
    );
  }

if (!informational && timelineEventId && shipment) {
  const shouldCreateIntent =
    mappedStatus !== "PICKED_UP" ||
    await isFirstPickupEvent(
      client,
      shipment.id,
      timelineEventId
    );

  if (shouldCreateIntent) {
    await createIntentForTimelineEvent(client, {
      shipmentId: shipment.id,
      shipmentEventId: timelineEventId,
      status: mappedStatus,
      recipient: shipment.customer_phone,
      payload: {
        reasonCode: normalizeDeliveryFailureReason(
          event.courier_code,
          event.payload
        ),
      },
    });
  }
}

if (
    !informational &&
    mappedStatus === "DELIVERY_FAILED" &&
    timelineEventId &&
    shipment
  ) {
    const attemptNo = await resolveAttemptNo(
      client,
      shipment.id,
      timelineEventId,
      mappedStatus
    );

    const failureReason = normalizeDeliveryFailureReason(
      event.courier_code,
      event.payload
    ) as NdrFailureReason;

    await ndrWebhookService.processDeliveryFailure(
      client,
      shipment.id,
      {
        awb,
        attemptNo,
        failureReason,
        paymentMode: shipment.payment_mode,
        codAmountPaise: Number(shipment.cod_amount_paise),
      }
    );
  }

  await client.query(
    `UPDATE webhook_events
        SET processing_status = 'PROCESSED',
            processing_attempts = processing_attempts + 1,
            processed_at = NOW(),
            last_error = NULL,
            next_retry_at = NULL
      WHERE id = $1`,
    [event.id]
  );

  return "PROCESSED";
}

export async function processOnePendingWebhook(
  pool: Pool
): Promise<"PROCESSED" | "UNMATCHED" | "FAILED" | "DUPLICATE" | "EMPTY"> {
  const client = await pool.connect();
  let eventId: string | undefined;

  try {
    await client.query("BEGIN");

    const result = await client.query<PendingWebhook>(
      `SELECT
          we.id,
          we.courier_id,
          c.code AS courier_code,
          we.external_event_id,
          we.dedup_key,
          we.payload,
          we.received_at
       FROM webhook_events we
       JOIN couriers c ON c.id = we.courier_id
       WHERE we.signature_valid = TRUE
         AND we.processing_status = 'RECEIVED'
         AND (we.next_retry_at IS NULL OR we.next_retry_at <= NOW())
       ORDER BY we.received_at, we.id
       FOR UPDATE OF we SKIP LOCKED
       LIMIT 1`
    );

    if (result.rowCount === 0) {
      await client.query("COMMIT");
      return "EMPTY";
    }

    const event = result.rows[0];
    eventId = event?.id;

    const outcome = await processLockedEvent(client, event || ({} as PendingWebhook));

    await client.query("COMMIT");
    return outcome;
  } catch (error) {
    await client.query("ROLLBACK");

    if (eventId) {
      const message =
        error instanceof Error ? error.message : "UNKNOWN_PROCESSING_ERROR";

      await markFailed(pool, eventId, message).catch(() => undefined);
    }

    throw error;
  } finally {
    client.release();
  }
}
async function resolveAttemptNo(
  client: PoolClient,
  shipmentId: string,
  timelineEventId: string,
  status: string
): Promise<number> {
  if (status === "SHIPPED" || status === "DELIVERED") {
    return 0;
  }

  if (
    status !== "OUT_FOR_DELIVERY" &&
    status !== "DELIVERY_FAILED"
  ) {
    return 0;
  }

  const result = await client.query<{ attempt_no: string }>(
    `WITH target AS (
       SELECT event_time, dedup_key
       FROM shipment_events
       WHERE id = $2
         AND shipment_id = $1
     )
     SELECT COUNT(*) FILTER (
       WHERE se.status = 'OUT_FOR_DELIVERY'
     )::int AS attempt_no
     FROM shipment_events se
     CROSS JOIN target t
     WHERE se.shipment_id = $1
       AND (se.event_time, se.dedup_key)
           <= (t.event_time, t.dedup_key)`,
    [shipmentId, timelineEventId]
  );

  const attemptNo = Number(result.rows[0]?.attempt_no ?? 0);

  // A failed delivery should normally correspond to a prior
  // out-for-delivery attempt. Use 1 as a defensive fallback.
  return Math.max(1, attemptNo);
}


async function createIntentForTimelineEvent(
  client: PoolClient,
  input: {
    shipmentId: string;
    shipmentEventId: string;
    status: string;
    recipient: string;
    payload: Record<string, unknown>;
  }
): Promise<void> {
  const {
    shipmentId,
    shipmentEventId,
    status,
    recipient,
    payload,
  } = input;

  let notificationType:
    | "SHIPPED"
    | "OUT_FOR_DELIVERY"
    | "DELIVERY_FAILED"
    | "DELIVERED"
    | null = null;

  switch (status) {
    case "PICKED_UP":
      notificationType = "SHIPPED";
      break;
    case "OUT_FOR_DELIVERY":
      notificationType = "OUT_FOR_DELIVERY";
      break;
    case "DELIVERY_FAILED":
      notificationType = "DELIVERY_FAILED";
      break;
    case "DELIVERED":
      notificationType = "DELIVERED";
      break;
    default:
      return;
  }

  // A failed attempt and its matching OFD event share the same
  // attempt number. Shipment-level notifications use attempt 0.
  const attemptNo = await resolveAttemptNo(
    client,
    shipmentId,
    shipmentEventId,
    status
  );

  const templateByType = {
    SHIPPED: "shipment_shipped",
    OUT_FOR_DELIVERY: "shipment_out_for_delivery",
    DELIVERY_FAILED: "shipment_delivery_failed",
    DELIVERED: "shipment_delivered",
  } as const;

  const safePayload: Record<string, unknown> = {
    template: templateByType[notificationType],
    attemptNo,
  };

  if (notificationType === "DELIVERY_FAILED") {
    // Accept only a normalized reason, never raw courier text.
    const allowedReasons = new Set([
      "ADDRESS_ISSUE",
      "CUSTOMER_UNAVAILABLE",
      "REFUSED",
      "COD_NOT_READY",
      "PREMISES_CLOSED",
      "OTHER",
    ]);

    const candidate = payload.reasonCode;
    safePayload.reasonCode =
      typeof candidate === "string" &&
      allowedReasons.has(candidate)
        ? candidate
        : "OTHER";
  }

  await createNotificationIntent(client, {
    shipmentId,
    shipmentEventId,
    notificationType,
    recipient,
    attemptNo,
    payload: safePayload,
    availableAt: getNotificationTime(new Date()),
  });
}

async function isFirstPickupEvent(
  client: PoolClient,
  shipmentId: string,
  timelineEventId: string
): Promise<boolean> {
  const result = await client.query<{ is_first: boolean }>(
    `SELECT NOT EXISTS (
       SELECT 1
       FROM shipment_events earlier
       JOIN shipment_events target
         ON target.id = $2
       WHERE earlier.shipment_id = $1
         AND earlier.status = 'PICKED_UP'
         AND (earlier.event_time, earlier.dedup_key)
             < (target.event_time, target.dedup_key)
     ) AS is_first`,
    [shipmentId, timelineEventId]
  );

  return result.rows[0]?.is_first ?? false;
}


function normalizeDeliveryFailureReason(
  courierCode: CourierCode,
  payload: Record<string, unknown>
): string {
  const allowedReasons = new Set([
    "ADDRESS_ISSUE",
    "CUSTOMER_UNAVAILABLE",
    "REFUSED",
    "COD_NOT_READY",
    "PREMISES_CLOSED",
  ]);

  let rawReason: unknown;

  if (courierCode === "SWIFTSHIP") {
    rawReason = payload.status_detail;
  } else {
    const meta = payload.meta;

    if (
      meta &&
      typeof meta === "object" &&
      !Array.isArray(meta)
    ) {
      rawReason = (meta as Record<string, unknown>).reason_code;
    }
  }

  if (typeof rawReason !== "string") {
    return "OTHER";
  }

  const normalized = rawReason.trim().toUpperCase();

  // BlueRoute example codes; adjust only if your fixture differs.
  const blueRouteCodes: Record<string, string> = {
    CNA: "CUSTOMER_UNAVAILABLE",
    ADD: "ADDRESS_ISSUE",
    REF: "REFUSED",
    CODNR: "COD_NOT_READY",
    CLS: "PREMISES_CLOSED",
  };

  const candidate =
    courierCode === "BLUEROUTE"
      ? blueRouteCodes[normalized]
      : normalized;

  return candidate && allowedReasons.has(candidate)
    ? candidate
    : "OTHER";
}