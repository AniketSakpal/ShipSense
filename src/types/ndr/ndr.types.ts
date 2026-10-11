
export type NdrFailureReason =
  | "CUSTOMER_UNAVAILABLE"
  | "ADDRESS_ISSUE"
  | "REFUSED"
  | "COD_NOT_READY"
  | "PREMISES_CLOSED"
  | "OTHER";

export type NdrAction =
  | "CONTACT_CUSTOMER"
  | "RETRY_DELIVERY"
  | "ESCALATE"
  | "INITIATE_RTO";

export type NdrStatus =
  | "OPEN"
  | "AWAITING_CUSTOMER"
  | "RETRY_REQUESTED"
  | "ESCALATED"
  | "RTO_PENDING"
  | "RTO_INITIATED"
  | "CLOSED";

export type NdrCustomerResponse =
  | "RETRY_DELIVERY"
  | "UPDATE_ADDRESS"
  | "CANCEL_DELIVERY";

export type NdrCourierActionType =
  | "RETRY_DELIVERY"
  | "INITIATE_RTO";

export type NdrCourierActionStatus =
  | "PENDING"
  | "PROCESSING"
  | "SUCCEEDED"
  | "FAILED"
  | "DEAD_LETTER";

export interface NdrDecisionInput {
  awb: string;
  attemptNo: number;
  failureReason: NdrFailureReason;
  paymentMode: "COD" | "PREPAID";
  codAmountPaise: number;
}

export interface NdrDecision {
  action: NdrAction;
  explanation: string;
  ruleKey: string;
  metadata: Record<string, unknown>;
}

export interface NdrCustomerResponseInput {
  response: NdrCustomerResponse;
}

export interface NdrRule {
  ruleKey: string;
  description: string;
  priority: number;
  conditions: Record<string, unknown>;
  action: NdrAction;
  enabled: boolean;
}

export interface ProcessNdrInput {
  shipmentId: string;
  awb: string;
  attemptNo: number;
  failureReason: NdrFailureReason;
  paymentMode: "COD" | "PREPAID";
  codAmountPaise: number;
}
export type CourierActionType = "RETRY_DELIVERY" | "INITIATE_RTO";


export interface ClaimedAction {
  id: string;
  ndr_case_id: string;
  action_type: "RETRY_DELIVERY" | "INITIATE_RTO";
  attempts: number;
  request_payload: Record<string, unknown>;
}