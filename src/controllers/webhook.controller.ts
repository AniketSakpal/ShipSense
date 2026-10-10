import type { Request, Response, NextFunction } from "express";
import {
  ingestSwiftShipWebhook,
  ingestBlueRouteWebhook,
} from "../services/webhook-ingestion.service";

export async function handleSwiftShipWebhook(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    console.log("Received SwiftShip webhook:", req.body);
    const result = await ingestSwiftShipWebhook({
      rawBody: req.body,
      signature: req.header("X-SwiftShip-Signature"),
      timestamp: undefined, // SwiftShip does not provide a timestamp header
    });

    res.status(result.httpStatus).json(result.body);
  } catch (error) {
    next(error);
  }
}

export async function handleBlueRouteWebhook(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const result = await ingestBlueRouteWebhook({
      rawBody: req.body,
      timestamp: req.header("X-BR-Timestamp"),
      signature: req.header("X-BR-Signature"),
    });

    res.status(result.httpStatus).json(result.body);
  } catch (error) {
    next(error);
  }
}