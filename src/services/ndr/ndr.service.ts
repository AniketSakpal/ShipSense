
import { ndrRepository } from "../../repositories/ndr/ndr.repository";
import type {
  NdrDecisionInput,
  NdrFailureReason,
  NdrCustomerResponse,
  ProcessNdrInput,
} from "../../types/ndr/ndr.types";
import { NdrDecisionService } from "./ndr-decision.service";

const decisionService = new NdrDecisionService();

const VALID_FAILURE_REASONS = new Set<NdrFailureReason>([
  "CUSTOMER_UNAVAILABLE",
  "ADDRESS_ISSUE",
  "REFUSED",
  "COD_NOT_READY",
  "PREMISES_CLOSED",
  "OTHER",
]);



export class NdrService {
  async processFailure(input: ProcessNdrInput) {
    const awb = input.awb.trim();

    if (!awb) {
      throw new Error("AWB is required");
    }

    if (!input.shipmentId.trim()) {
      throw new Error("Shipment ID is required");
    }

    if (!Number.isInteger(input.attemptNo) || input.attemptNo < 1) {
      throw new Error("attemptNo must be a positive integer");
    }

    if (
      !Number.isSafeInteger(input.codAmountPaise) ||
      input.codAmountPaise < 0
    ) {
      throw new Error("codAmountPaise must be a non-negative safe integer");
    }

    if (!VALID_FAILURE_REASONS.has(input.failureReason)) {
      throw new Error("Unsupported delivery failure reason");
    }

    if (
      input.paymentMode !== "COD" &&
      input.paymentMode !== "PREPAID"
    ) {
      throw new Error("paymentMode must be COD or PREPAID");
    }

    if (
      input.failureReason === "COD_NOT_READY" &&
      input.paymentMode !== "COD"
    ) {
      throw new Error("COD_NOT_READY is only valid for COD shipments");
    }

    const decisionInput: NdrDecisionInput = {
      awb,
      attemptNo: input.attemptNo,
      failureReason: input.failureReason,
      paymentMode: input.paymentMode,
      codAmountPaise: input.codAmountPaise,
    };

    // Read active rules from PostgreSQL on each evaluation so rule
    // changes take effect without restarting the application.
    const rules = await ndrRepository.findEnabledRules();

    const decision = decisionService.decide(decisionInput, rules);

    const result = await ndrRepository.createCase({
      shipmentId: input.shipmentId,
      decisionInput,
      decision,
    });

    return {
      created: result.created,
      case: result.record,
      decision: {
        action: decision.action,
        ruleKey: decision.ruleKey,
        explanation: decision.explanation,
      },
    };
  }

  validateCustomerResponse(response: string): NdrCustomerResponse {
    const allowedResponses: NdrCustomerResponse[] = [
      "RETRY_DELIVERY",
      "UPDATE_ADDRESS",
      "CANCEL_DELIVERY",
    ];

    if (!allowedResponses.includes(response as NdrCustomerResponse)) {
      throw new Error(
        "response must be RETRY_DELIVERY, UPDATE_ADDRESS, or CANCEL_DELIVERY",
      );
    }

    return response as NdrCustomerResponse;
  }
}

export const ndrService = new NdrService();
