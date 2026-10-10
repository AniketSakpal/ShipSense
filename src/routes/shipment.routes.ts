
import { Router } from "express";
import { createShipmentController } from "../controllers/shipment.controller";

export const shipmentRouter = Router();

shipmentRouter.post("/", createShipmentController);