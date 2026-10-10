import {
  createHmac,
  timingSafeEqual,
} from "node:crypto";

export type SignatureResult =
  | { valid: true }
  | {
      valid: false;
      reason:
        | "MISSING_SIGNATURE"
        | "INVALID_SIGNATURE_FORMAT"
        | "SIGNATURE_MISMATCH"
        | "MISSING_TIMESTAMP"
        | "INVALID_TIMESTAMP"
        | "TIMESTAMP_OUTSIDE_TOLERANCE";
    };

function safeEqual(actual: Buffer, expected: Buffer): boolean {
  return (
    actual.length === expected.length &&
    timingSafeEqual(actual, expected)
  );
}

export function verifySwiftShipSignature(
  rawBody: Buffer,
  signatureHeader: string | undefined,
  secret: string ,
): SignatureResult {
  if (!signatureHeader) {
    return { valid: false, reason: "MISSING_SIGNATURE" };
  }

  const match = /^sha256=([a-fA-F0-9]{64})$/.exec(
    signatureHeader,
  );

  if (!match) {
    return {
      valid: false,
      reason: "INVALID_SIGNATURE_FORMAT",
    };
  }

  const [, signatureHex] = match;

  if (!signatureHex) {
    return {
      valid: false,
      reason: "INVALID_SIGNATURE_FORMAT",
    };
  }

  const receivedSignature = Buffer.from(signatureHex, "hex");

  const expectedSignature = createHmac("sha256", secret)
    .update(rawBody)
    .digest();

  return safeEqual(receivedSignature, expectedSignature)
    ? { valid: true }
    : { valid: false, reason: "SIGNATURE_MISMATCH" };
}

export interface BlueRouteVerificationOptions {
  nowSeconds?: () => number;
  toleranceSeconds?: number;
}

export function verifyBlueRouteSignature(
  rawBody: Buffer,
  timestampHeader: string | undefined,
  signatureHeader: string | undefined,
  secret: string,
  options: BlueRouteVerificationOptions = {},
): SignatureResult {
  if (!timestampHeader) {
    return { valid: false, reason: "MISSING_TIMESTAMP" };
  }

  if (!signatureHeader) {
    return { valid: false, reason: "MISSING_SIGNATURE" };
  }

  if (!/^\d+$/.test(timestampHeader)) {
    return { valid: false, reason: "INVALID_TIMESTAMP" };
  }

  const timestampSeconds = Number(timestampHeader);

  if (!Number.isSafeInteger(timestampSeconds)) {
    return { valid: false, reason: "INVALID_TIMESTAMP" };
  }

  const nowSeconds =
    options.nowSeconds ?? (() => Date.now() / 1000);

  const toleranceSeconds = options.toleranceSeconds ?? 300;

  if (
    Math.abs(nowSeconds() - timestampSeconds) >
    toleranceSeconds
  ) {
    return {
      valid: false,
      reason: "TIMESTAMP_OUTSIDE_TOLERANCE",
    };
  }

  // Require canonical Base64 encoding of a 32-byte SHA-256 digest.
  const receivedSignature = Buffer.from(signatureHeader, "base64");

  if (
    receivedSignature.length !== 32 ||
    receivedSignature.toString("base64") !== signatureHeader
  ) {
    return {
      valid: false,
      reason: "INVALID_SIGNATURE_FORMAT",
    };
  }

  // The assignment specifies: timestamp + "." + raw request body.
  const expectedSignature = createHmac("sha256", secret)
    .update(timestampHeader, "utf8")
    .update(".", "utf8")
    .update(rawBody)
    .digest();

  return safeEqual(receivedSignature, expectedSignature)
    ? { valid: true }
    : { valid: false, reason: "SIGNATURE_MISMATCH" };
}