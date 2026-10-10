export interface NotificationOutboxInput {
  shipmentId: string;
  shipmentEventId: string;
  notificationType: string;
  recipient: string;
  payload: Record<string, unknown>;
  attemptNo: number;
  availableAt: Date;
}