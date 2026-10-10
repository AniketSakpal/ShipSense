export type SwiftStatus = "PKD" | "IT" | "OFD" | "UDL" | "RTI" | "RTD" | "DLV";
export interface ChaosEvent {
  event_id: string; awb: string; order_ref: string; status: SwiftStatus;
  status_detail: string; location: string; pincode: string; event_time: string;
  attempt_no: number; cod_amount: string;
}
export interface ShipmentFixture {
  logicalId: string; awb: string; orderRef: string; events: ChaosEvent[]; expectedStatus: string;
}
export class SeededRandom {
  private state: number;
  constructor(seed: number) { this.state = seed >>> 0 || 0x6d2b79f5; }
  next(): number {
    let t = (this.state += 0x6d2b79f5);
    t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }
  int(max: number): number { return Math.floor(this.next() * max); }
  shuffle<T>(items: T[]): T[] {
    const out = [...items];
    for (let i = out.length - 1; i > 0; i--) { const j = this.int(i + 1); [out[i], out[j]] = [out[j], out[i]]; }
    return out;
  }
}
function time(day: number, hour: number, minute = 0): string {
  return `2026-10-${String(day).padStart(2,"0")} ${String(hour).padStart(2,"0")}:${String(minute).padStart(2,"0")}:00`;
}
function makeEvent(id: string, awb: string, orderRef: string, seq: number, status: SwiftStatus, eventTime: string, attempt: number, detail: string): ChaosEvent {
  return { event_id:`chaos_${id}_${String(seq).padStart(3,"0")}`, awb, order_ref:orderRef, status, status_detail:detail,
    location:"Chaos-Test-Hub", pincode:"400053", event_time:eventTime, attempt_no:attempt, cod_amount:"849.00" };
}
export function buildFixtureSet(seed: number, count: number, runTag: string) {
  if (!Number.isInteger(count) || count < 20) throw new Error("Part D requires at least 20 shipments");
  const shipments: ShipmentFixture[] = [];
  for (let i=1; i<=count; i++) {
    const logicalId=`S${String(i).padStart(3,"0")}`, awb=`CH${runTag}${String(i).padStart(6,"0")}`, orderRef=`CHAOS-${runTag}-${logicalId}`;
    const e: ChaosEvent[] = [
      makeEvent(logicalId,awb,orderRef,1,"PKD",time(1,9),0,"Picked up"),
      makeEvent(logicalId,awb,orderRef,2,"IT",time(1,10),0,"In transit")
    ];
    let expectedStatus="DELIVERED";
    if (i===1) {
      e.push(makeEvent(logicalId,awb,orderRef,3,"OFD",time(2,9),1,"Out for delivery"));
      e.push(makeEvent(logicalId,awb,orderRef,4,"UDL",time(2,11,15),1,"Customer not available"));
      e.push(makeEvent(logicalId,awb,orderRef,5,"OFD",time(3,9),2,"Out for delivery"));
      e.push(makeEvent(logicalId,awb,orderRef,6,"UDL",time(3,11,15),2,"Address issue"));
      e.push(makeEvent(logicalId,awb,orderRef,7,"OFD",time(4,9),3,"Out for delivery"));
      e.push(makeEvent(logicalId,awb,orderRef,8,"UDL",time(4,11,15),3,"Customer not available"));
      e.push(makeEvent(logicalId,awb,orderRef,9,"RTI",time(4,13),3,"Return to origin initiated"));
      e.push(makeEvent(logicalId,awb,orderRef,10,"RTD",time(6,16),3,"Returned to origin"));
      expectedStatus="RTO_DELIVERED";
    } else if (i%5===0) {
      e.push(makeEvent(logicalId,awb,orderRef,3,"OFD",time(2,9),1,"Out for delivery"));
      e.push(makeEvent(logicalId,awb,orderRef,4,"UDL",time(2,11,15),1,"Premises closed"));
      e.push(makeEvent(logicalId,awb,orderRef,5,"OFD",time(3,9),2,"Out for delivery"));
      e.push(makeEvent(logicalId,awb,orderRef,6,"DLV",time(3,14),2,"Delivered"));
    } else {
      e.push(makeEvent(logicalId,awb,orderRef,3,"IT",time(1,15),0,"In transit update"));
      e.push(makeEvent(logicalId,awb,orderRef,4,"OFD",time(2,9),1,"Out for delivery"));
      e.push(makeEvent(logicalId,awb,orderRef,5,"DLV",time(2,14),1,"Delivered"));
    }
    shipments.push({logicalId,awb,orderRef,events:e,expectedStatus});
  }
  return {seed,shipments,events:shipments.flatMap(s=>s.events)};
}
export function injectDuplicates(events: ChaosEvent[], rng: SeededRandom): ChaosEvent[] {
  const copies = rng.shuffle(events).slice(0, Math.max(1, Math.floor(events.length*0.2)));
  return [...events, ...copies.map(e=>({...e}))];
}

