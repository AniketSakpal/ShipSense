import type { Pool } from "pg";
import type { NotificationSummary } from "../models/summary/notification-summary.model";
import type { NotificationSummaryFilters } from "../models/summary/notification-summary-filter.model";
import type { SummaryRow } from "../models/summary/summary-row.model";

export async function getNotificationSummary(
  pool: Pool,
  filters: NotificationSummaryFilters = {},
): Promise<NotificationSummary> {
  const { from, to } = filters;

  if (from && Number.isNaN(from.getTime())) {
    throw new Error("Invalid 'from' date");
  }

  if (to && Number.isNaN(to.getTime())) {
    throw new Error("Invalid 'to' date");
  }

  if (from && to && from > to) {
    throw new Error("'from' must be earlier than or equal to 'to'");
  }

  const query = `
    SELECT
      COUNT(*)::int AS total,

      COUNT(*) FILTER (
        WHERE status = 'PENDING'
      )::int AS pending,

      COUNT(*) FILTER (
        WHERE status = 'PROCESSING'
      )::int AS processing,

      COUNT(*) FILTER (
        WHERE status = 'SENT'
      )::int AS sent,

      COUNT(*) FILTER (
        WHERE status = 'FAILED'
      )::int AS failed,

      COUNT(*) FILTER (
        WHERE status = 'DEAD_LETTER'
      )::int AS dead_letter,

      COUNT(*) FILTER (
        WHERE status = 'DROPPED'
      )::int AS dropped,

      COALESCE(SUM(attempts), 0)::int AS total_attempts,

      COUNT(*) FILTER (
        WHERE channel = 'WHATSAPP'
      )::int AS whatsapp_count,

      COUNT(*) FILTER (
        WHERE channel = 'SMS'
      )::int AS sms_count

    FROM notification_outbox
    WHERE ($1::timestamptz IS NULL OR created_at >= $1)
      AND ($2::timestamptz IS NULL OR created_at <= $2)
  `;

  const result = await pool.query<SummaryRow>(query, [
    from ?? null,
    to ?? null,
  ]);

  const row = result.rows[0];

  if (!row) {
    throw new Error("Unable to retrieve notification summary");
  }

  return {
    total: row.total,
    pending: row.pending,
    processing: row.processing,
    sent: row.sent,
    failed: row.failed,
    deadLetter: row.dead_letter,
    dropped: row.dropped,
    totalAttempts: row.total_attempts,
    whatsappCount: row.whatsapp_count,
    smsCount: row.sms_count,
  };
}