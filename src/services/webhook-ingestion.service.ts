import dotenv from "dotenv";
import { pool } from "../config/db/db.pool";
import {
  verifySwiftShipSignature,
  verifyBlueRouteSignature,
} from "../security/webhook.signature";
import { ingestWebhookEvent } from "../repositories/webhook-event.repository";
import type { WebhookInput } from "../models/webhook/webhook-input.model";
import type { IngestionResponse } from "../models/webhook/ingestion-response.model";
dotenv.config();




function parseObject(rawBody: Buffer): Record<string, unknown> | null {
  try {
    const parsed: unknown = JSON.parse(rawBody.toString("utf8"));

    if (
      parsed === null ||
      typeof parsed !== "object" ||
      Array.isArray(parsed)
    ) {
      return null;
    }

    return parsed as Record<string, unknown>;
  } catch {
    return null;
  }
}

function validateRawBody(rawBody: unknown): Buffer | null {
  return Buffer.isBuffer(rawBody) ? rawBody : null;
}

export async function ingestSwiftShipWebhook(
  input: WebhookInput,
): Promise<IngestionResponse> {
    
  const rawBody = validateRawBody(input.rawBody);
    
  if (!rawBody) {
    return {
      httpStatus: 415,
      body: { error: "UNSUPPORTED_CONTENT_TYPE" },
    };
  }

  const verification = verifySwiftShipSignature(
    rawBody,
    input.signature,
    String(process.env.SWIFTSHIP_WEBHOOK_SECRET),
  );

  if (!verification.valid) {
    return {
      httpStatus: 401,
      body: {
        error: "INVALID_WEBHOOK_SIGNATURE",
        reason: verification.reason,
      },
    };
  }

  const payload = parseObject(rawBody);

  if (!payload) {
    return {
      httpStatus: 400,
      body: { error: "INVALID_JSON_OBJECT" },
    };
  }

  return persistVerifiedEvent("SWIFTSHIP", rawBody, payload);
}

export async function ingestBlueRouteWebhook(
  input: WebhookInput,
): Promise<IngestionResponse> {
  const rawBody = validateRawBody(input.rawBody);

  if (!rawBody) {
    return {
      httpStatus: 415,
      body: { error: "UNSUPPORTED_CONTENT_TYPE" },
    };
  }

  const verification = verifyBlueRouteSignature(
    rawBody,
    input.timestamp,
    input.signature,
    String(process.env.BLUEROUTE_WEBHOOK_SECRET),
  );

  if (!verification.valid) {
    return {
      httpStatus: 401,
      body: {
        error: "INVALID_WEBHOOK_SIGNATURE",
        reason: verification.reason,
      },
    };
  }

  const payload = parseObject(rawBody);

  if (!payload) {
    return {
      httpStatus: 400,
      body: { error: "INVALID_JSON_OBJECT" },
    };
  }

  return persistVerifiedEvent("BLUEROUTE", rawBody, payload);
}

async function persistVerifiedEvent(
  courierCode: "SWIFTSHIP" | "BLUEROUTE",
  rawBody: Buffer,
  payload: Record<string, unknown>,
): Promise<IngestionResponse> {
  const result = await ingestWebhookEvent(pool, {
    courierCode,
    rawBody,
    payload,
  });

  switch (result.kind) {
    case "inserted":
      return {
        httpStatus: 202,
        body: {
          accepted: true,
          duplicate: false,
          eventId: result.eventId,
        },
      };

    case "duplicate":
      return {
        httpStatus: 200,
        body: {
          accepted: true,
          duplicate: true,
          eventId: result.eventId,
        },
      };

    case "collision":
      return {
        httpStatus: 200,
        body: {
          accepted: true,
          collision: true,
          eventId: result.eventId,
        },
      };
  }
}