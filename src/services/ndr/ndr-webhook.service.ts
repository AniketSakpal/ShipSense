import type { PoolClient } from "pg";

import {
  ndrRepository,
} from "../../repositories/ndr/ndr.repository";

import { NdrDecisionService } from "./ndr-decision.service";

import type {
  NdrDecisionInput,
} from "../../types/ndr/ndr.types";

const decisionService = new NdrDecisionService();

export class NdrWebhookService {
  async processDeliveryFailure(
    client: PoolClient,
    shipmentId: string,
    input: NdrDecisionInput,
  ) {
    const rules =
      await ndrRepository.findEnabledRulesWithClient(client);

    const decision = decisionService.decide(input, rules);

    return ndrRepository.createCaseWithClient(client, {
      shipmentId,
      decisionInput: input,
      decision,
      responseTimeoutHours: Number(
        process.env.NDR_RESPONSE_TIMEOUT_HOURS ?? 24,
      ),
    });
  }
}

export const ndrWebhookService = new NdrWebhookService();