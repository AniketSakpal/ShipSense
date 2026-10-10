import { randomUUID } from "node:crypto";

import type { ProviderSendInput } from "../models/provider-input-send.model";
import type { ProviderSendResult } from "../models/provider-result-send.model";
import { ProviderError } from "../models/error/provider-error.model";

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function sendNotification(
  input: ProviderSendInput
): Promise<ProviderSendResult> {
  // Only log safe metadata. Do not log the recipient, raw payload,
  // medicine names, order contents, or authentication secrets.
  console.info(JSON.stringify({
    event: "provider_send_started",
    channel: input.channel,
    notificationType: input.notificationType,
    idempotencyKey: input.idempotencyKey,
  }));

  const mode = (process.env.NOTIFICATION_PROVIDER_MODE ?? "success").toLowerCase();
  const delayMs = Number(process.env.NOTIFICATION_PROVIDER_DELAY_MS ?? 0);

if (mode === "whatsapp-5xx" && input.channel === "WHATSAPP") {
  throw new ProviderError("SIMULATED_WHATSAPP_5XX");
}

if (mode === "whatsapp-timeout" && input.channel === "WHATSAPP") {
  await delay(Number(process.env.NOTIFICATION_PROVIDER_TIMEOUT_MS ?? 1500));
  throw new ProviderError("SIMULATED_WHATSAPP_TIMEOUT");
}

  if (mode === "slow" && delayMs > 0) {
    await delay(delayMs);
  }

  if (mode === "timeout") {
    // Simulated provider timeout.
    await delay(Number(process.env.NOTIFICATION_PROVIDER_TIMEOUT_MS ?? 1500));
    throw new ProviderError("SIMULATED_PROVIDER_TIMEOUT");
  }

  if (mode === "5xx") {
    throw new ProviderError("SIMULATED_PROVIDER_5XX");
  }



  if (mode !== "success" && mode !== "slow") {
    throw new ProviderError("UNKNOWN_PROVIDER_SIMULATION_MODE", false);
  }



  return {
    messageId: `${input.channel.toLowerCase()}-${randomUUID()}`,
  };
}