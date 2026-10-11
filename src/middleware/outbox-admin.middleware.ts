import type { Request, Response, NextFunction } from "express";
import { timingSafeEqual } from "node:crypto";

export function requireOutboxAdmin(
  req: Request,
  res: Response,
  next: NextFunction,
): void {
  const expected = process.env.OUTBOX_ADMIN_TOKEN;
  const authorization = req.header("authorization") ?? "";

  const supplied = authorization.startsWith("Bearer ")
    ? authorization.slice("Bearer ".length)
    : "";

  if (!expected || !supplied) {
    res.status(401).json({ error: "UNAUTHORIZED" });
    return;
  }

  const expectedBuffer = Buffer.from(expected, "utf8");
  const suppliedBuffer = Buffer.from(supplied, "utf8");

  if (
    expectedBuffer.length !== suppliedBuffer.length ||
    !timingSafeEqual(expectedBuffer, suppliedBuffer)
  ) {
    res.status(401).json({ error: "UNAUTHORIZED" });
    return;
  }

  next();
}