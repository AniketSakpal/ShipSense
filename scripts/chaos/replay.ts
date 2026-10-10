import { createHmac } from "node:crypto";
import { pool } from "../../src/config/db/db.pool";
import type { ChaosEvent, ShipmentFixture } from "./fixtures";
export interface ReplayOptions { baseUrl: string; swiftShipSecret: string; concurrency: number; }
async function post(url:string, raw:string, headers:Record<string,string>={}) {
  return fetch(url,{method:"POST",headers:{"content-type":"application/json",...headers},body:raw});
}
export async function registerShipments(options:ReplayOptions, shipments:ShipmentFixture[]):Promise<void> {
  for (const s of shipments) {
    const body={awb:s.awb,courier:"SWIFTSHIP",order_ref:s.orderRef,customer_ref:`CUST-${s.awb}`,
      customer_phone:`+919900${s.awb.slice(-6)}`,payment_mode:"COD",cod_amount_paise:84900};
    const response=await post(`${options.baseUrl}/v1/shipments`,JSON.stringify(body));
    if (!response.ok) throw new Error(`Shipment registration failed ${response.status} for ${s.awb}: ${(await response.text()).slice(0,300)}`);
  }
}
function sign(raw:string, secret:string):string {
  return `sha256=${createHmac("sha256",secret).update(Buffer.from(raw,"utf8")).digest("hex")}`;
}
async function postEvent(options:ReplayOptions,e:ChaosEvent):Promise<void> {
  const raw=JSON.stringify(e);
  const response=await post(`${options.baseUrl}/v1/webhooks/swiftship`,raw,{"X-SwiftShip-Signature":sign(raw,options.swiftShipSecret)});
  if (!response.ok) throw new Error(`Webhook rejected ${response.status} for ${e.event_id}: ${(await response.text()).slice(0,300)}`);
  // In ordered baseline mode, wait for this exact event to be processed before posting the next one.
  if (options.concurrency===1) {
    const deadline=Date.now()+15000;
    while(Date.now()<deadline) {
      const r=await pool.query<{processing_status:string}>(
        `SELECT processing_status FROM webhook_events WHERE external_event_id=$1`,[e.event_id]);
      if (r.rows[0]?.processing_status==="PROCESSED") return;
      if (r.rows[0]?.processing_status==="FAILED") throw new Error(`Event ${e.event_id} was marked FAILED`);
      await new Promise(resolve=>setTimeout(resolve,50));
    }
    throw new Error(`Timed out waiting for baseline event ${e.event_id}`);
  }
}
export async function postEventStream(options:ReplayOptions,events:ChaosEvent[],concurrency:number):Promise<void> {
  if (concurrency===1) {
    for (const e of events) await postEvent(options,e);
    return;
  }
  const queue=[...events]; const errors:unknown[]=[];
  await Promise.all(Array.from({length:Math.min(concurrency,queue.length)},async()=>{
    while(queue.length && !errors.length) {
      const e=queue.shift(); if(!e) return;
      try { await postEvent(options,e); } catch(err) { errors.push(err); return; }
    }
  }));
  if(errors.length) throw errors[0];
}

