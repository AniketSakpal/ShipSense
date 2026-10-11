import { Router } from "express";

import { requireOutboxAdmin } from "../../middleware/outbox-admin.middleware";
import {
  getNotificationSummaryController,
} from "../../controllers/admin/notification-metrics.controller";

const router = Router();

router.get(
  "/summary",
  requireOutboxAdmin,
  getNotificationSummaryController,
);

export default router;