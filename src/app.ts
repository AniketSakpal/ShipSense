import express from "express";
import userRoutes from "./routes/user.routes";
import healthRoutes from "./routes/health.routes";
import webhookRoutes from "./routes/webhook.routes";
import { errorHandler } from "./middleware/error-handler";
import { shipmentRouter } from "./routes/shipment.routes";
import outboxRoutes from "./routes/outbox.routes";
import notificationMetricsRouter from
  "./routes/admin/notification-metrics.routes";
import ndrRoutes from "./routes/ndr.routes";

export const app = express();
app.disable("x-powered-by");

app.use("/v1/webhooks", webhookRoutes);
app.use(express.json());
app.use("/v1", outboxRoutes);
app.use("/v1/ndr", ndrRoutes);
app.use("/v1/shipments", shipmentRouter);
app.use("/v1/admin/notifications",notificationMetricsRouter);
app.use("/api/v1",healthRoutes);

app.use("/api/users", userRoutes);
app.use(errorHandler);
export default app;