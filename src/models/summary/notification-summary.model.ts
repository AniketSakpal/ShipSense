export interface NotificationSummary {
  total: number;
  pending: number;
  processing: number;
  sent: number;
  failed: number;
  deadLetter: number;
  dropped: number;
  totalAttempts: number;
  whatsappCount: number;
  smsCount: number;
}