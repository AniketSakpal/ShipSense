import type { Pool } from "pg";
export interface CanonicalSnapshot {
  logicalId:string; finalState:string;
  timeline:Array<{status:string;eventTime:string;dedupKey:string;stateChanged:boolean;decisionReason:string}>;
  intents:Array<{notificationType:string;attemptNo:number;channel:string;payload:unknown}>;
}
export async function drainConcurrent(pool:Pool, concurrency:number):Promise<void> {
  const {processOnePendingWebhook}=await import("../../src/repositories/shipment-event.repository");
  await Promise.all(Array.from({length:concurrency},async()=>{
    let empty=0;
    while(empty<2) {
      const result=await processOnePendingWebhook(pool);
      if(result==="EMPTY"){empty++; await new Promise(r=>setTimeout(r,50));} else empty=0;
    }
  }));
}
export async function waitForProcessing(pool:Pool,awbs:string[],expectedUniqueEvents:number,timeoutMs=60000):Promise<void> {
  const deadline=Date.now()+timeoutMs;
  while(Date.now()<deadline) {
    const r=await pool.query<{total:string;pending:string;failed:string}>(
      `SELECT COUNT(*)::text total,
        COUNT(*) FILTER(WHERE processing_status IN ('RECEIVED','PROCESSING'))::text pending,
        COUNT(*) FILTER(WHERE processing_status='FAILED')::text failed
       FROM webhook_events WHERE payload->>'awb'=ANY($1::text[])`,[awbs]);
    const row=r.rows[0], total=Number(row?.total??0), pending=Number(row?.pending??0), failed=Number(row?.failed??0);
    if(failed) throw new Error(`${failed} webhook events FAILED for chaos AWBs`);
    if(total>=expectedUniqueEvents && pending===0) return;
    await new Promise(r=>setTimeout(r,200));
  }
  throw new Error(`Timed out waiting for ${expectedUniqueEvents} accepted events across ${awbs.length} AWBs`);
}
export async function captureSnapshots(pool:Pool,items:Array<{logicalId:string;awb:string}>):Promise<CanonicalSnapshot[]> {
  const snapshots:CanonicalSnapshot[]=[];
  for(const item of items) {
    const s=await pool.query<{id:string;current_status:string}>(`SELECT id,current_status FROM shipments WHERE awb=$1`,[item.awb]);
    const shipment=s.rows[0]; if(!shipment) throw new Error(`Shipment missing: ${item.awb}`);
    const t=await pool.query<{status:string;event_time:Date|string;dedup_key:string;state_changed:boolean;decision_reason:string}>(
      `SELECT status,event_time,dedup_key,state_changed,decision_reason FROM shipment_events
       WHERE shipment_id=$1 ORDER BY event_time,dedup_key`,[shipment.id]);
    const n=await pool.query<{notification_type:string;attempt_no:number;channel:string;payload:unknown}>(
      `SELECT notification_type,attempt_no,channel,payload FROM notification_outbox WHERE shipment_id=$1
       ORDER BY notification_type,attempt_no,channel`,[shipment.id]);
    snapshots.push({logicalId:item.logicalId,finalState:shipment.current_status,
      timeline:t.rows.map(e=>({status:e.status,eventTime:new Date(e.event_time).toISOString(),
        dedupKey:e.dedup_key.replace(item.awb,"<AWB>"),stateChanged:e.state_changed,decisionReason:e.decision_reason})),
      intents:n.rows.map(e=>({notificationType:e.notification_type,attemptNo:Number(e.attempt_no),channel:e.channel,payload:e.payload}))});
  }
  return snapshots.sort((a,b)=>a.logicalId.localeCompare(b.logicalId));
}

