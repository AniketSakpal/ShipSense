import type { CourierActionRequest } from "../../models/courier/courier-action-request.model";
import type { CourierActionResult } from "../../models/courier/courier-action-result.model";
import type { CourierActionAdapter } from "../../models/courier/courier-action-adapter.adapter";
import dotenv from "dotenv";
dotenv.config();
export class StubCourierActionAdapter implements CourierActionAdapter {
  async execute(
    request: CourierActionRequest,
  ): Promise<CourierActionResult> {
    const mode = process.env.COURIER_STUB_MODE ?? "success";

    if (mode === "timeout") {
      await new Promise((resolve) => setTimeout(resolve, 10_000));
      throw new Error("SIMULATED_COURIER_TIMEOUT");
    }

    if (mode === "failure") {
      return {
        success: false,
        message: "SIMULATED_COURIER_FAILURE",
      };
    }

    return {
      success: true,
      externalReference: `STUB-${request.actionType}-${request.awb}`,
      message: "Stub courier action accepted",
    };
  }
}

export const courierActionAdapter = new StubCourierActionAdapter();