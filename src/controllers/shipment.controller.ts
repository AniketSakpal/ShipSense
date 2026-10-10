
import type { Request, Response, NextFunction } from "express";
import { createShipmentSchema } from "../schemas/shipment.schema";
import { createShipment } from "../services/shipment.service";
import { ShipmentConflictError } from "../repositories/shipment.repository";

export async function createShipmentController(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  const validation = createShipmentSchema.safeParse(req.body);

  if (!validation.success) {
    res.status(400).json({
      success: false,
      error: "VALIDATION_ERROR",
      details: validation.error.issues.map((issue) => ({
        field: issue.path.join("."),
        message: issue.message,
      })),
    });
    return;
  }

  try {
    const result = await createShipment(validation.data);

    res.status(result.created ? 201 : 200).json({
      success: true,
      created: result.created,
      shipment: result.shipment,
    });
  } catch (error) {
    if (error instanceof ShipmentConflictError) {
      res.status(409).json({
        success: false,
        error: "SHIPMENT_CONFLICT",
        message: error.message,
      });
      return;
    }

    if (
      error instanceof Error &&
      error.message.startsWith("ACTIVE_COURIER_NOT_FOUND:")
    ) {
      res.status(400).json({
        success: false,
        error: "INVALID_COURIER",
        message: "Courier does not exist or is inactive",
      });
      return;
    }

    next(error);
  }
}
