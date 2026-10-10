export type CourierCode = "SWIFTSHIP" | "BLUEROUTE";
export interface PendingWebhook {
  id: string;
  courier_id: string;
  courier_code: CourierCode;
  external_event_id: string | null;
  dedup_key: string | null;
  payload: Record<string, unknown>;
  received_at: Date;
}