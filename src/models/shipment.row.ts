export interface ShipmentRow {
  id: string;
  awb: string;
  courier: string;
  order_ref: string;
  customer_ref: string;
  customer_phone: string;
  payment_mode: "COD" | "PREPAID";
  cod_amount_paise: string;
  current_status: string;
  registered_at: Date;
}