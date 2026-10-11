import type { Request, Response, NextFunction } from "express";
import { ndrRepository } from "../../repositories/ndr/ndr.repository";
import { ndrService } from "../../services/ndr/ndr.service";

export class NdrController {
  async submitCustomerResponse(
    req: Request,
    res: Response,
    next: NextFunction,
  ): Promise<void> {
    try {
      const awb =  typeof req.params.awb === "string" ? req.params.awb.trim() : undefined;

      if (!awb) {
        res.status(400).json({
          success: false,
          message: "AWB is required",
        });
        return;
      }

      const body = req.body as { response?: unknown };

      if (typeof body.response !== "string") {
        res.status(400).json({
          success: false,
          message: "response must be a string",
        });
        return;
      }

      const response = ndrService.validateCustomerResponse(body.response);
      const record = await ndrRepository.recordCustomerResponse(
        awb,
        response,
      );

      res.status(200).json({
        success: true,
        message: "Customer response recorded",
        data: record,
      });
    } catch (error) {
      if (error instanceof Error) {
        if (error.message.includes("not found")) {
          res.status(404).json({
            success: false,
            message: error.message,
          });
          return;
        }

        if (
          error.message.includes("not accepted") ||
          error.message.includes("deadline has expired")
        ) {
          res.status(409).json({
            success: false,
            message: error.message,
          });
          return;
        }

        if (error.message.startsWith("response must be")) {
          res.status(400).json({
            success: false,
            message: error.message,
          });
          return;
        }
      }

      next(error);
    }
  }
}

export const ndrController = new NdrController();