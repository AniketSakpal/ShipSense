import type { CourierActionRequest } from "./courier-action-request.model";
import type { CourierActionResult } from "./courier-action-result.model";
export interface CourierActionAdapter {
  execute(
    request: CourierActionRequest,
  ): Promise<CourierActionResult>;
}