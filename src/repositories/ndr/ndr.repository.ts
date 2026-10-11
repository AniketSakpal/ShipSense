
import { pool } from "../../config/db/db.pool";
import type { PoolClient } from "pg";

import type {
  NdrAction,
  NdrDecision,
  NdrDecisionInput,
  NdrRule,
  NdrStatus,
} from "../../types/ndr/ndr.types";
import { enqueueCourierAction } from "./ndr-courier-action.repository";

interface NdrRuleRow {
  rule_key: string;
  description: string;
  priority: number;
  conditions: Record<string, unknown>;
  action: NdrAction;
  enabled: boolean;
}

export interface CreateNdrCaseInput {
  shipmentId: string;
  decisionInput: NdrDecisionInput;
  decision: NdrDecision;
  responseTimeoutHours?: number;
}

export interface NdrCaseRecord {
  id: string;
  shipment_id: string;
  awb: string;
  attempt_no: number;
  failure_reason: string;
  payment_mode: string;
  cod_amount_paise: string | number;
  status: NdrStatus;
  recommended_action: NdrAction;
  decision_explanation: string;
  response_deadline_at: Date;
  created_at: Date;
}

export class NdrRepository {
  async findEnabledRules(): Promise<NdrRule[]> {
    const result = await pool.query<NdrRuleRow>(
      `
        SELECT
          rule_key,
          description,
          priority,
          conditions,
          action,
          enabled
        FROM public.ndr_rules
        WHERE enabled = TRUE
        ORDER BY priority ASC, id ASC
      `,
    );

    return result.rows.map((row) => ({
      ruleKey: row.rule_key,
      description: row.description,
      priority: row.priority,
      conditions: row.conditions,
      action: row.action,
      enabled: row.enabled,
    }));
  }

  async createCase(
    input: CreateNdrCaseInput,
  ): Promise<{ record: NdrCaseRecord; created: boolean }> {
    const {
      shipmentId,
      decisionInput,
      decision,
      responseTimeoutHours = 24,
    } = input;

    if (
      !Number.isInteger(responseTimeoutHours) ||
      responseTimeoutHours < 1 ||
      responseTimeoutHours > 168
    ) {
      throw new Error(
        "responseTimeoutHours must be an integer between 1 and 168",
      );
    }

    const result = await pool.query<NdrCaseRecord>(
      `
        INSERT INTO public.ndr_cases (
          shipment_id,
          awb,
          attempt_no,
          failure_reason,
          payment_mode,
          cod_amount_paise,
          status,
          recommended_action,
          decision_explanation,
          decision_metadata,
          response_deadline_at
        )
        VALUES (
          $1, $2, $3, $4, $5, $6,
          $7, $8, $9, $10::jsonb,
          NOW() + ($11::integer * INTERVAL '1 hour')
        )
        ON CONFLICT (awb, attempt_no) DO NOTHING
        RETURNING
          id,
          shipment_id,
          awb,
          attempt_no,
          failure_reason,
          payment_mode,
          cod_amount_paise,
          status,
          recommended_action,
          decision_explanation,
          response_deadline_at,
          created_at
      `,
      [
        shipmentId,
        decisionInput.awb,
        decisionInput.attemptNo,
        decisionInput.failureReason,
        decisionInput.paymentMode,
        decisionInput.codAmountPaise,
        decision.action === "INITIATE_RTO"
          ? "RTO_PENDING"
          : decision.action === "ESCALATE"
            ? "ESCALATED"
            : "AWAITING_CUSTOMER",
        decision.action,
        decision.explanation,
        JSON.stringify({
          ...decision.metadata,
          ruleKey: decision.ruleKey,
        }),
        responseTimeoutHours,
      ],
    );

    if (result.rows[0]) {
      return {
        record: result.rows[0],
        created: true,
      };
    }

    // The same AWB and attempt already exist. Return the original case
    // without overwriting its decision or customer response.
    const existing = await pool.query<NdrCaseRecord>(
      `
        SELECT
          id,
          shipment_id,
          awb,
          attempt_no,
          failure_reason,
          payment_mode,
          cod_amount_paise,
          status,
          recommended_action,
          decision_explanation,
          response_deadline_at,
          created_at
        FROM public.ndr_cases
        WHERE awb = $1 AND attempt_no = $2
      `,
      [decisionInput.awb, decisionInput.attemptNo],
    );

    if (!existing.rows[0]) {
      throw new Error(
        "NDR case was not returned after an idempotent insert conflict",
      );
    }

    return {
      record: existing.rows[0],
      created: false,
    };
  }

  async recordCustomerResponse(
  awb: string,
  response: import("../../types/ndr/ndr.types").NdrCustomerResponse,
): Promise<NdrCaseRecord> {
  const client = await pool.connect();

  try {
    await client.query("BEGIN");

    const lookup = await client.query<NdrCaseRecord>(
      `
        SELECT
          id,
          shipment_id,
          awb,
          attempt_no,
          failure_reason,
          payment_mode,
          cod_amount_paise,
          status,
          recommended_action,
          decision_explanation,
          response_deadline_at,
          created_at
        FROM public.ndr_cases
        WHERE awb = $1
        ORDER BY attempt_no DESC
        LIMIT 1
        FOR UPDATE
      `,
      [awb],
    );

    const ndrCase = lookup.rows[0];

    if (!ndrCase) {
      throw new Error("NDR case not found for this AWB");
    }

    if (
      ndrCase.status !== "OPEN" &&
      ndrCase.status !== "AWAITING_CUSTOMER"
    ) {
      throw new Error(
        `Customer response is not accepted for case status ${ndrCase.status}`,
      );
    }

    if (new Date(ndrCase.response_deadline_at).getTime() < Date.now()) {
      await client.query(
        `
          UPDATE public.ndr_cases
          SET status = 'ESCALATED',
              escalated_at = NOW(),
              updated_at = NOW()
          WHERE id = $1
        `,
        [ndrCase.id],
      );

      await client.query("COMMIT");
      throw new Error("Customer response deadline has expired");
    }

    let nextStatus: NdrStatus;

    switch (response) {
      case "RETRY_DELIVERY":
        nextStatus = "RETRY_REQUESTED";
        break;
      case "UPDATE_ADDRESS":
      case "CANCEL_DELIVERY":
        nextStatus = "ESCALATED";
        break;
    }

    const updated = await client.query<NdrCaseRecord>(
      `
        UPDATE public.ndr_cases
        SET customer_response = $2,
            customer_response_at = NOW(),
            status = $3,
            escalated_at = CASE
              WHEN $3 = 'ESCALATED' THEN NOW()
              ELSE escalated_at
            END,
            updated_at = NOW()
        WHERE id = $1
        RETURNING
          id,
          shipment_id,
          awb,
          attempt_no,
          failure_reason,
          payment_mode,
          cod_amount_paise,
          status,
          recommended_action,
          decision_explanation,
          response_deadline_at,
          created_at
      `,
      [ndrCase.id, response, nextStatus],
    );
    const updatedRecord = updated.rows[0];
    if (!updatedRecord) {
    throw new Error("NDR case update returned no row");
    }
    if (response === "RETRY_DELIVERY") {
        await enqueueCourierAction(client, {
                ndrCaseId: ndrCase.id,
                actionType: "RETRY_DELIVERY",
                idempotencyKey: `ndr:${ndrCase.id}:retry`,
                requestPayload: {
                awb: ndrCase.awb,
                attemptNo: ndrCase.attempt_no,
                requestedBy: "CUSTOMER",
            },
  });
}
    await client.query("COMMIT");

    return updatedRecord;
  } catch (error) {
    // A deadline expiry was committed above; do not attempt a second
    // transaction rollback after that successful commit.
    if (client) {
      try {
        await client.query("ROLLBACK");
      } catch {
        // The transaction may already have been committed.
      }
    }

    throw error;
  } finally {
    client.release();
  }
}

async findEnabledRulesWithClient(
    client: PoolClient,
  ): Promise<NdrRule[]> {
    const result = await client.query<NdrRuleRow>(`
      SELECT
        rule_key,
        description,
        priority,
        conditions,
        action,
        enabled
      FROM public.ndr_rules
      WHERE enabled = TRUE
      ORDER BY priority ASC, id ASC
    `);

    return result.rows.map((row) => ({
      ruleKey: row.rule_key,
      description: row.description,
      priority: row.priority,
      conditions: row.conditions,
      action: row.action,
      enabled: row.enabled,
    }));
  }

  async createCaseWithClient(
    client: PoolClient,
    input: CreateNdrCaseInput,
  ): Promise<{ record: NdrCaseRecord; created: boolean }> {
    const {
      shipmentId,
      decisionInput,
      decision,
      responseTimeoutHours = 24,
    } = input;

    if (
      !Number.isInteger(responseTimeoutHours) ||
      responseTimeoutHours < 1 ||
      responseTimeoutHours > 168
    ) {
      throw new Error(
        "responseTimeoutHours must be an integer between 1 and 168",
      );
    }

    const result = await client.query<NdrCaseRecord>(
      `
        INSERT INTO public.ndr_cases (
          shipment_id,
          awb,
          attempt_no,
          failure_reason,
          payment_mode,
          cod_amount_paise,
          status,
          recommended_action,
          decision_explanation,
          decision_metadata,
          response_deadline_at
        )
        VALUES (
          $1, $2, $3, $4, $5, $6,
          $7, $8, $9, $10::jsonb,
          NOW() + ($11::integer * INTERVAL '1 hour')
        )
        ON CONFLICT (awb, attempt_no) DO NOTHING
        RETURNING
          id, shipment_id, awb, attempt_no,
          failure_reason, payment_mode, cod_amount_paise,
          status, recommended_action, decision_explanation,
          response_deadline_at, created_at
      `,
      [
        shipmentId,
        decisionInput.awb,
        decisionInput.attemptNo,
        decisionInput.failureReason,
        decisionInput.paymentMode,
        decisionInput.codAmountPaise,
        decision.action === "INITIATE_RTO"
          ? "RTO_PENDING"
          : decision.action === "ESCALATE"
            ? "ESCALATED"
            : "AWAITING_CUSTOMER",
        decision.action,
        decision.explanation,
        JSON.stringify({
          ...decision.metadata,
          ruleKey: decision.ruleKey,
        }),
        responseTimeoutHours,
      ],
    );

    let record = result.rows[0];
    const created = Boolean(record);

    if (!record) {
      const existing = await client.query<NdrCaseRecord>(
        `
          SELECT
            id, shipment_id, awb, attempt_no,
            failure_reason, payment_mode, cod_amount_paise,
            status, recommended_action, decision_explanation,
            response_deadline_at, created_at
          FROM public.ndr_cases
          WHERE awb = $1 AND attempt_no = $2
        `,
        [decisionInput.awb, decisionInput.attemptNo],
      );

      record = existing.rows[0];

      if (!record) {
        throw new Error("NDR case missing after idempotency conflict");
      }
    }

    // Enqueue RTO only when this transaction created the case.
    if (created && decision.action === "INITIATE_RTO") {
      await enqueueCourierAction(client, {
        ndrCaseId: record.id,
        actionType: "INITIATE_RTO",
        idempotencyKey: `ndr:${record.id}:rto`,
        requestPayload: {
          awb: record.awb,
          attemptNo: record.attempt_no,
          requestedBy: "NDR_RULE_ENGINE",
          ruleKey: decision.ruleKey,
        },
      });
    }

    return { record, created };
  }
}


export const ndrRepository = new NdrRepository();

