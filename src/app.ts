import express from "express";
import userRoutes from "./routes/user.routes";
import healthRoutes from "./routes/health.routes";
import webhookRoutes from "./routes/webhook.routes";
import { errorHandler } from "./middleware/error-handler";
import { shipmentRouter } from "./routes/shipment.routes";

export const app = express();
app.disable("x-powered-by");

app.use("/v1/webhooks", webhookRoutes);
app.use(express.json());
app.use("/v1/shipments", shipmentRouter);
app.use("/api/v1",healthRoutes);

app.use("/api/users", userRoutes);
app.use(errorHandler);
export default app;