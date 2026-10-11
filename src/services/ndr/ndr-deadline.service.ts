import { pool } from "../../config/db/db.pool";

export interface NdrDeadlineResult {
  escalatedCount: number;
  escalatedCaseIds: string[];
}

export async function escalateExpiredNdrCases(): Promise<NdrDeadlineResult> {
  // One atomic UPDATE prevents concurrent workers from escalating
  // the same case more than once.
  const result = await pool.query<{ id: string }>(
    `
    UPDATE public.ndr_cases
       SET status = 'ESCALATED',
           escalated_at = NOW(),
           decision_explanation =
             decision_explanation ||
             ' Automatically escalated because the customer response deadline expired.',
           updated_at = NOW()
     WHERE status = 'AWAITING_CUSTOMER'
       AND response_deadline_at <= NOW()
    RETURNING id
    `
  );

  return {
    escalatedCount: result.rowCount ?? 0,
    escalatedCaseIds: result.rows.map((row) => row.id),
  };
}