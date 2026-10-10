import type {NotificationChannel} from "../models/notification-job.model";
export interface OutboxMessage {
  id: string;
  shipment_id: string;
  shipment_event_id: string;
  notification_type: string;
  recipient: string;
  payload: Record<string, unknown>;
  status: NotificationStatus;
  attempts: number;
  attempt_no: number;
  channel: NotificationChannel;
  whatsapp_attempts: number;
  sms_attempts: number;
  idempotency_key: string | null;
}

export type NotificationStatus =
  | "PENDING"
  | "PROCESSING"
  | "SENT"
  | "FAILED"
  | "DEAD_LETTER"
  | "DROPPED";