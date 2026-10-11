export interface CourierActionRequest {
  awb: string;
  attemptNo: number;
  actionType: "RETRY_DELIVERY" | "INITIATE_RTO";
}