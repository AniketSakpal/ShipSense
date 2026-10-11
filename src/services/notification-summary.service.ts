import type { Pool } from "pg";
import type { NotificationSummary } from "../models/summary/notification-summary.model";
import type { NotificationSummaryFilters } from "../models/summary/notification-summary-filter.model";
import { getNotificationSummary } from "../repositories/notification-metrics.repository";
export async function fetchNotificationSummary(
  pool: Pool,
  filters: NotificationSummaryFilters = {},
): Promise<NotificationSummary> {
  if (filters.from && filters.to && filters.from > filters.to) {
    throw new Error("'from' must be earlier than or equal to 'to'");
  }

  return getNotificationSummary(pool, filters);
}