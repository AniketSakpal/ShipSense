import type { Request, Response, NextFunction } from "express";

import { pool } from "../../config/db/db.pool";
import { fetchNotificationSummary } from "../../services/notification-summary.service";

function parseDate(
  value: unknown,
  fieldName: string,
): Date | undefined {
  if (value === undefined) {
    return undefined;
  }

  if (typeof value !== "string" || value.trim() === "") {
    throw new Error(`Invalid '${fieldName}' query parameter`);
  }

  const date = new Date(value);

  if (Number.isNaN(date.getTime())) {
    throw new Error(`Invalid '${fieldName}' query parameter`);
  }

  return date;
}

export async function getNotificationSummaryController(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const from = parseDate(req.query.from, "from");
    const to = parseDate(req.query.to, "to");

    const summary = await fetchNotificationSummary(pool, {
       ...(from !== undefined ? { from } : {}),
  ...(to !== undefined ? { to } : {}),
    });

    res.status(200).json({
      success: true,
      data: summary,
    });
  } catch (error) {
    if (
      error instanceof Error &&
      error.message.startsWith("Invalid '")
    ) {
      res.status(400).json({
        success: false,
        error: error.message,
      });
      return;
    }

    next(error);
  }
}