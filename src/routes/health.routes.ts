import { Router } from "express";
import { AppReadyHealthController } from "../checkup/health/app.ready.health";

const router = Router();

router.get("/health", AppReadyHealthController.getHealth);
router.get("/ready", AppReadyHealthController.isReady);
export default router;
