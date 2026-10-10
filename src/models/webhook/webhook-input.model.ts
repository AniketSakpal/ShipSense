export interface WebhookInput {
  rawBody: unknown;
  signature?: string | undefined;
  timestamp?: string | undefined;
}