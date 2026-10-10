import type { NotificationChannel } from "../models/notification-job.model";
export interface ProviderSendInput {
  channel: NotificationChannel;
  recipient: string;
  notificationType: string;
  payload: Record<string, unknown>;
  idempotencyKey: string;
}