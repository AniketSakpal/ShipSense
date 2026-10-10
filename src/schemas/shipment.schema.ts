
import { z } from "zod";

export const createShipmentSchema = z
  .object({
    awb: z.string().trim().min(1).max(100),
    courier: z.enum(["SWIFTSHIP", "BLUEROUTE"]),
    order_ref: z.string().trim().min(1).max(100),
    customer_ref: z.string().trim().min(1).max(100),
    customer_phone: z.string().trim().min(8).max(20),
    payment_mode: z.enum(["COD", "PREPAID"]),
    cod_amount_paise: z.number().int().nonnegative().safe(),
  })
  .strict()
  .superRefine((shipment, context) => {
    if (
      shipment.payment_mode === "PREPAID" &&
      shipment.cod_amount_paise !== 0
    ) {
      context.addIssue({
        code: "custom",
        path: ["cod_amount_paise"],
        message: "Prepaid shipments must have cod_amount_paise = 0",
      });
    }
  });

export type CreateShipmentInput = z.infer<
  typeof createShipmentSchema
>;
