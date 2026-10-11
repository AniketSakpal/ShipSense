import type { PoolClient } from "pg";
import type { CourierActionType } from "../../types/ndr/ndr.types";



export async function enqueueCourierAction(
  client: PoolClient,
  input: {
    ndrCaseId: string;
    actionType: CourierActionType;
    idempotencyKey: string;
    requestPayload: Record<string, unknown>;
  },
): Promise<void> {
  await client.query(
    `INSERT INTO public.ndr_courier_actions (
       ndr_case_id,
       action_type,
       idempotency_key,
       status,
       request_payload,
       next_retry_at,
       created_at,
       updated_at
     )
     VALUES ($1, $2, $3, 'PENDING', $4::jsonb, NOW(), NOW(), NOW())
     ON CONFLICT (idempotency_key) DO NOTHING`,
    [
      input.ndrCaseId,
      input.actionType,
      input.idempotencyKey,
      JSON.stringify(input.requestPayload),
    ],
  );
}