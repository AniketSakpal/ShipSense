import type { Pool } from "pg";
import { pool } from "../../config/db/db.pool";
import type { ClaimedAction } from "../../types/ndr/ndr.types";
import { courierActionAdapter } from "../../integrations/courier/courier-action.adapter";
import type { CourierActionRequest } from "../../models/courier/courier-action-request.model";

const MAX_ATTEMPTS = 5;
const BASE_RETRY_SECONDS = 5;
const MAX_RETRY_SECONDS = 15 * 60;


function retryDelaySeconds(attempt: number): number {
  const exponential = Math.min(
    BASE_RETRY_SECONDS * 2 ** Math.max(0, attempt - 1),
    MAX_RETRY_SECONDS,
  );

  // Jitter avoids multiple workers retrying in lockstep.
  return Math.floor(exponential * (0.5 + Math.random()));
}

export class NdrCourierActionWorker {
  constructor(private readonly db: Pool = pool) {}

  /**
   * Claims one action atomically. SKIP LOCKED lets multiple worker
   * processes safely compete for available actions.
   */
  private async claimOne(): Promise<ClaimedAction | null> {
    const client = await this.db.connect();

    try {
      await client.query("BEGIN");

      const result = await client.query<ClaimedAction>(
        `WITH candidate AS (
           SELECT id
           FROM public.ndr_courier_actions
           WHERE (
             status IN ('PENDING', 'FAILED')
             AND (next_retry_at IS NULL OR next_retry_at <= NOW())
           )
           OR (
             status = 'PROCESSING'
             AND updated_at < NOW() - INTERVAL '2 minutes'
           )
           ORDER BY created_at, id
           FOR UPDATE SKIP LOCKED
           LIMIT 1
         )
         UPDATE public.ndr_courier_actions a
         SET status = 'PROCESSING',
             attempts = a.attempts + 1,
             updated_at = NOW()
         FROM candidate c
         WHERE a.id = c.id
         RETURNING a.id, a.ndr_case_id, a.action_type,
                   a.attempts, a.request_payload`,
      );

      await client.query("COMMIT");
      return result.rows[0] ?? null;
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }

  async processOne(): Promise<
    "SUCCEEDED" | "FAILED" | "DEAD_LETTER" | "EMPTY"
  > {
    const action = await this.claimOne();
    if (!action) return "EMPTY";

    const payload = action.request_payload ?? {};
    const awb = payload.awb;
    const attemptNo = payload.attemptNo;

    if (
      typeof awb !== "string" ||
      typeof attemptNo !== "number" ||
      !Number.isInteger(attemptNo)
    ) {
      await this.db.query(
        `UPDATE public.ndr_courier_actions
         SET status = 'DEAD_LETTER',
             last_error = 'INVALID_REQUEST_PAYLOAD',
             updated_at = NOW()
         WHERE id = $1`,
        [action.id],
      );
      return "DEAD_LETTER";
    }

    // Never hold a DB transaction open during an external call.
    try {
      const result = await courierActionAdapter.execute({
        awb,
        attemptNo,
        actionType: action.action_type,
      } satisfies CourierActionRequest);

      if (!result.success) {
        return await this.recordFailure(
          action,
          result.message,
        );
      }

      const client = await this.db.connect();

      try {
        await client.query("BEGIN");
        console.log('executing UPDATE public.ndr_courier_actions query ');
        await client.query(
          `UPDATE public.ndr_courier_actions
           SET status = 'SUCCEEDED',
               response_payload = CAST($2 AS jsonb),
               last_error = NULL,
               completed_at = NOW(),
               next_retry_at = NULL,
               updated_at = NOW()
           WHERE id = $1`,
          [
            action.id,
            JSON.stringify({
              externalReference: result.externalReference ?? null,
              message: result.message,
            }),
          ],
        );

        if (action.action_type === "INITIATE_RTO") {
          await client.query(
            `UPDATE public.ndr_cases
             SET status = 'RTO_INITIATED',
                 updated_at = NOW()
             WHERE id = $1
               AND status = 'RTO_PENDING'`,
            [action.ndr_case_id],
          );
        }

        await client.query("COMMIT");
        return "SUCCEEDED";
      } catch (error) {
        await client.query("ROLLBACK");
        throw error;
      } finally {
        client.release();
      }
    } catch (error) {
        console.log(' Error occurred in suspect '+error);
      const message =
        error instanceof Error
          ? error.message
          : "UNKNOWN_COURIER_ERROR";

      return this.recordFailure(action, message);
    }
  }

  private async recordFailure(
    action: ClaimedAction,
    message: string,
  ): Promise<"FAILED" | "DEAD_LETTER"> {
    const exhausted = action.attempts >= MAX_ATTEMPTS;
    const delaySeconds = retryDelaySeconds(action.attempts);
    console.log(' executing UPDATE public.ndr_courier_actions query for failure');
    await this.db.query(
      `UPDATE public.ndr_courier_actions
       SET status = $2,
           last_error = $3,
           next_retry_at = CASE
             WHEN $2 = 'FAILED'
             THEN NOW() + ($4 * INTERVAL '1 second')
             ELSE NULL
           END,
           updated_at = NOW()
       WHERE id = $1`,
      [
        action.id,
        exhausted ? "DEAD_LETTER" : "FAILED",
        message.slice(0, 1000),
        delaySeconds,
      ],
    );

    return exhausted ? "DEAD_LETTER" : "FAILED";
  }
}

export const ndrCourierActionWorker = new NdrCourierActionWorker();