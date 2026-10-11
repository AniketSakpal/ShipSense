import type {
  NdrAction,
  NdrDecision,
  NdrDecisionInput,
  NdrRule,
} from "../../types/ndr/ndr.types";

const MAX_DELIVERY_ATTEMPTS = 3;

export class NdrDecisionService {
  decide(
    input: NdrDecisionInput,
    rules: NdrRule[],
  ): NdrDecision {
    const {
      attemptNo,
      failureReason,
      paymentMode,
      codAmountPaise,
    } = input;

    // Rule 1: The third failed delivery attempt triggers RTO.
    const maxAttemptsRule = rules.find(
      (rule) =>
        rule.enabled &&
        rule.conditions.maxAttempts === MAX_DELIVERY_ATTEMPTS,
    );

    if (attemptNo >= MAX_DELIVERY_ATTEMPTS) {
      return {
        action: "INITIATE_RTO",
        ruleKey: maxAttemptsRule?.ruleKey ?? "MAX_ATTEMPTS_RTO",
        explanation:
          `Delivery attempt ${attemptNo} has failed. ` +
          `The maximum allowed attempts (${MAX_DELIVERY_ATTEMPTS}) ` +
          `has been reached, so return-to-origin is required.`,
        metadata: {
          attemptNo,
          maxAttempts: MAX_DELIVERY_ATTEMPTS,
          failureReason,
          paymentMode,
          codAmountPaise,
        },
      };
    }

    // Rule 2: Evaluate enabled rules in ascending priority order.
    const sortedRules = [...rules]
      .filter((rule) => rule.enabled)
      .sort((a, b) => a.priority - b.priority);

    for (const rule of sortedRules) {
      // The maximum-attempt rule is handled above.
      if (rule.conditions.maxAttempts !== undefined) {
        continue;
      }

      const conditions = rule.conditions;

      if (
        conditions.failureReason !== undefined &&
        conditions.failureReason !== failureReason
      ) {
        continue;
      }

      if (
        conditions.paymentMode !== undefined &&
        conditions.paymentMode !== paymentMode
      ) {
        continue;
      }

      return {
        action: rule.action as NdrAction,
        ruleKey: rule.ruleKey,
        explanation:
          `${rule.description} ` +
          `Failure reason: ${failureReason}. ` +
          `Delivery attempt: ${attemptNo} of ${MAX_DELIVERY_ATTEMPTS}.`,
        metadata: {
          attemptNo,
          maxAttempts: MAX_DELIVERY_ATTEMPTS,
          failureReason,
          paymentMode,
          codAmountPaise,
          matchedConditions: conditions,
        },
      };
    }

    // Rule 3: Safe default when no configured rule matches.
    return {
      action: "CONTACT_CUSTOMER",
      ruleKey: "DEFAULT_CONTACT_CUSTOMER",
      explanation:
        `No specific enabled rule matched failure reason ` +
        `${failureReason}. Contact the customer to resolve the issue ` +
        `before attempting delivery again.`,
      metadata: {
        attemptNo,
        maxAttempts: MAX_DELIVERY_ATTEMPTS,
        failureReason,
        paymentMode,
        codAmountPaise,
        fallback: true,
      },
    };
  }
}