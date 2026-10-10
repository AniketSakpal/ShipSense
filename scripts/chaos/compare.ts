import type { CanonicalSnapshot } from "./snapshot";
export interface Difference { logicalId:string; path:string; baseline:unknown; chaos:unknown; }
function stable(value:unknown):string {
  if(Array.isArray(value)) return `[${value.map(stable).join(",")}]`;
  if(value && typeof value==="object") {
    const r=value as Record<string,unknown>;
    return `{${Object.keys(r).sort().map(k=>`${JSON.stringify(k)}:${stable(r[k])}`).join(",")}}`;
  }
  return JSON.stringify(value);
}
function normalizeIntents(items:CanonicalSnapshot["intents"]) {
  return items.map(i=>({notificationType:i.notificationType,attemptNo:i.attemptNo,channel:i.channel,payload:i.payload}))
    .sort((a,b)=>`${a.notificationType}:${a.attemptNo}:${a.channel}`.localeCompare(`${b.notificationType}:${b.attemptNo}:${b.channel}`));
}
export function compareSnapshots(a:CanonicalSnapshot[],b:CanonicalSnapshot[]):Difference[] {
  const diffs:Difference[]=[]; const am=new Map(a.map(x=>[x.logicalId,x])), bm=new Map(b.map(x=>[x.logicalId,x]));
  for(const id of [...new Set([...am.keys(),...bm.keys()])].sort()) {
    const x=am.get(id),y=bm.get(id);
    if(!x||!y){diffs.push({logicalId:id,path:"shipment",baseline:!!x,chaos:!!y});continue;}
    if(x.finalState!==y.finalState) diffs.push({logicalId:id,path:"finalState",baseline:x.finalState,chaos:y.finalState});
    if(stable(x.timeline)!==stable(y.timeline)) diffs.push({logicalId:id,path:"timeline",baseline:x.timeline,chaos:y.timeline});
    const xi=normalizeIntents(x.intents), yi=normalizeIntents(y.intents);
    if(stable(xi)!==stable(yi)) diffs.push({logicalId:id,path:"intents",baseline:xi,chaos:yi});
  }
  return diffs;
}
export function formatDifferences(diffs:Difference[],limit=20):string {
  return diffs.slice(0,limit).map(d=>`${d.logicalId} ${d.path}\n baseline: ${JSON.stringify(d.baseline)}\n chaos:    ${JSON.stringify(d.chaos)}`).join("\n");
}

