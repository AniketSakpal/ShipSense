import { Router, type Request, type Response, type NextFunction } from "express";
import { timingSafeEqual } from "node:crypto";
import { getOutbox, replayOutbox } from "../controllers/outbox.controller";

const router = Router();

function requireOutboxAdmin(
  req: Request,
  res: Response,
  next: NextFunction
): void {
  const expected = process.env.OUTBOX_ADMIN_TOKEN;
  const authorization = req.header("authorization") ?? "";
  const supplied = authorization.startsWith("Bearer ")
    ? authorization.slice(7)
    : "";

  if (!expected || !supplied) {
    res.status(401).json({ error: "UNAUTHORIZED" });
    return;
  }

  const expectedBuffer = Buffer.from(expected);
  const suppliedBuffer = Buffer.from(supplied);

  if (
    expectedBuffer.length !== suppliedBuffer.length ||
    !timingSafeEqual(expectedBuffer, suppliedBuffer)
  ) {
    res.status(401).json({ error: "UNAUTHORIZED" });
    return;
  }

  next();
}

router.get("/outbox", requireOutboxAdmin, getOutbox);
router.post("/admin/outbox/:id/replay", requireOutboxAdmin, replayOutbox);

export default router;