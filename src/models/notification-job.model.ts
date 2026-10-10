export interface NotificationJob {
  id: string;
  shipment_id: string;
  shipment_event_id: string;
  notification_type: string;
  recipient: string;
  payload: Record<string, unknown>;
  status: string;
  attempts: number;
  attempt_no: number;
  channel: NotificationChannel;
  whatsapp_attempts: number;
  sms_attempts: number;
  replay_count: number;
  idempotency_key: string | null;
  lock_token: string | null;
}


export type NotificationChannel = "WHATSAPP" | "SMS";
export type NotificationStatus =
  | "PENDING"
  | "PROCESSING"
  | "SENT"
  | "FAILED"
  | "DEAD_LETTER"
  | "DROPPED";