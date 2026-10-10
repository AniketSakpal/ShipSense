
import type { CreateShipmentInput } from "../schemas/shipment.schema";
import { registerShipment } from "../repositories/shipment.repository";

export async function createShipment(input: CreateShipmentInput) {
  return registerShipment(input);
}
