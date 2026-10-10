import "dotenv/config";
import { randomInt } from "node:crypto";
import { pool } from "../src/config/db/db.pool";
import { buildFixtureSet, injectDuplicates, SeededRandom } from "./chaos/fixtures";
import { postEventStream, registerShipments } from "./chaos/replay";
import { captureSnapshots, drainConcurrent, waitForProcessing } from "./chaos/snapshot";
import { compareSnapshots, formatDifferences } from "./chaos/compare";
function arg(name:string,fallback:string):string { const i=process.argv.indexOf(name); return i>=0&&process.argv[i+1]?process.argv[i+1]:fallback; }
function positive(name:string,fallback:number):number { const n=Number(arg(name,String(fallback))); if(!Number.isSafeInteger(n)||n<=0) throw new Error(`${name} must be positive`); return n; }
function uniqueCount(events:Array<{event_id:string}>):number { return new Set(events.map(e=>e.event_id)).size; }
async function main() {
  const seed=positive("--seed",randomInt(1,2_000_000_000)), count=positive("--shipments",25), concurrency=positive("--concurrency",8);
  const baseUrl=arg("--base-url",process.env.CHAOS_BASE_URL??"http://localhost:3000");
  const secret=process.env.CHAOS_SWIFTSHIP_SECRET??process.env.SWIFTSHIP_WEBHOOK_SECRET??process.env.SWIFTSHIP_SECRET??"swiftship-demo-secret";
  console.log(JSON.stringify({event:"chaos_test_started",seed,count,concurrency,baseUrl},null,2));
  let stage="start";
  try {
    const baselineSet=buildFixtureSet(seed,count,"B"), chaosSet=buildFixtureSet(seed,count,"C");
    const options={baseUrl,swiftShipSecret:secret,concurrency};
    stage="register-baseline"; await registerShipments(options,baselineSet.shipments);
    stage="baseline-replay"; await postEventStream({...options,concurrency:1},baselineSet.events,1);
    await drainConcurrent(pool,1);
    await waitForProcessing(pool,baselineSet.shipments.map(s=>s.awb),uniqueCount(baselineSet.events));
    const baseline=await captureSnapshots(pool,baselineSet.shipments.map(s=>({logicalId:s.logicalId,awb:s.awb})));
    stage="register-chaos"; await registerShipments(options,chaosSet.shipments);
    stage="chaos-replay";
    const rng=new SeededRandom(seed), shuffled=rng.shuffle(chaosSet.events), duplicated=injectDuplicates(shuffled,rng);
    await postEventStream(options,duplicated,concurrency);
    stage="concurrent-processing"; await drainConcurrent(pool,concurrency);
    await waitForProcessing(pool,chaosSet.shipments.map(s=>s.awb),uniqueCount(chaosSet.events));
    const chaos=await captureSnapshots(pool,chaosSet.shipments.map(s=>({logicalId:s.logicalId,awb:s.awb})));
    stage="compare"; const diffs=compareSnapshots(baseline,chaos);
    console.log(JSON.stringify({event:diffs.length?"chaos_test_failed":"chaos_test_passed",seed,shipments:count,
      uniqueEvents:uniqueCount(chaosSet.events),chaosRequests:duplicated.length,duplicatesInjected:duplicated.length-uniqueCount(chaosSet.events),
      concurrency,differences:diffs.length},null,2));
    if(diffs.length){console.error(formatDifferences(diffs));process.exitCode=1;}
  } catch(e) {
    console.error(JSON.stringify({event:"chaos_test_error",seed,stage,message:e instanceof Error?e.message:"UNKNOWN"},null,2));
    process.exitCode=1;
  } finally { await pool.end(); }
  if(process.exitCode===1) console.error(`REPRODUCE: npx tsx scripts/chaos-test.ts --seed ${seed} --shipments ${count} --concurrency ${concurrency}`);
}
main().catch(e=>{console.error(e);process.exitCode=1;});

