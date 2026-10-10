import type { Request, Response } from "express";
import { pool } from "../config/db/db.pool";
import {
  listOutbox,
  replayDeadLetter,
} from "../repositories/notification-outbox.repository";

export async function getOutbox(req: Request, res: Response): Promise<void> {
  try {
    const status = typeof req.query.status === "string"
      ? req.query.status
      : undefined;
    const limitValue = Number(req.query.limit ?? 100);

    if (!Number.isInteger(limitValue) || limitValue < 1 || limitValue > 200) {
      res.status(400).json({
        error: "INVALID_LIMIT",
        message: "limit must be an integer between 1 and 200",
      });
      return;
    }

    const items = await listOutbox(pool, status, limitValue);
    res.status(200).json({ count: items.length, items });
  } catch (error) {
    if (error instanceof Error && error.message === "INVALID_OUTBOX_STATUS") {
      res.status(400).json({ error: "INVALID_OUTBOX_STATUS" });
      return;
    }

    console.error("Failed to list outbox jobs");
    res.status(500).json({ error: "INTERNAL_SERVER_ERROR" });
  }
}

export async function replayOutbox(
  req: Request,
  res: Response
): Promise<void> {
  const id = req.params.id;

  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(String(id))) {
    res.status(400).json({ error: "INVALID_OUTBOX_ID" });
    return;
  }

  try {
    const replayed = await replayDeadLetter(pool, String(id));

    if (!replayed) {
      res.status(409).json({
        error: "NOT_REPLAYABLE",
        message: "The outbox record does not exist or is not DEAD_LETTER",
      });
      return;
    }

    res.status(202).json({
      id,
      status: "PENDING",
      message: "Notification queued for replay",
    });
  } catch {
    console.error("Failed to replay outbox job");
    res.status(500).json({ error: "INTERNAL_SERVER_ERROR" });
  }
}