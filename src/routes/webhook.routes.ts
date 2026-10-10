import { Router, type Request, type Response } from "express";
import express from "express";
import {verifyBlueRouteSignature,verifySwiftShipSignature,} from "../security/webhook.signature";
import dotenv from "dotenv";
import {
  handleSwiftShipWebhook,
  handleBlueRouteWebhook,
} from "../controllers/webhook.controller";
dotenv.config();

const router = Router();

const webhookRawBody = express.raw({
  type: "application/json",
  limit: "256kb",
});

router.post(
  "/swiftship",
  webhookRawBody,
  handleSwiftShipWebhook,
);

router.post(
  "/blueroute",
  webhookRawBody,
  handleBlueRouteWebhook,
);

export default router;

