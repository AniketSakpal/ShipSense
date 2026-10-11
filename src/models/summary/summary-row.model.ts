export interface SummaryRow {
  total: number;
  pending: number;
  processing: number;
  sent: number;
  failed: number;
  dead_letter: number;
  dropped: number;
  total_attempts: number;
  whatsapp_count: number;
  sms_count: number;
}