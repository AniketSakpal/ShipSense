import { Router } from "express";
import { getOutbox, replayOutbox } from "../controllers/outbox.controller";
import { requireOutboxAdmin } from "../middleware/outbox-admin.middleware";
const router = Router();



router.get("/outbox", requireOutboxAdmin, getOutbox);
router.post("/admin/outbox/:id/replay", requireOutboxAdmin, replayOutbox);

export default router;