import type { Prepared, Outcome, Authorize } from "./policy.ts";
export type Rpc = (name:string,args?:Record<string,unknown>)=>Promise<{data:any;error:any}>;
/** Sequential bounded batch: each recipient is rechecked AFTER all preceding transports. */
export async function dispatch(rpc:Rpc,send:(p:Prepared,authorize:Authorize)=>Promise<Outcome>) {
  const release=await rpc("push_release_tick");if(release.error)throw Error("release_failed");
  const claim=await rpc("claim_push_work");if(claim.error)throw Error("claim_failed");
  const counts={accepted:0,gone:0,permanent:0,retry:0,deferred:0,expired:0};
  for(const work of (claim.data??[]).slice(0,10)) {
    const ids={p_job:work.job_id,p_sub:work.subscription_id,p_lease:work.lease};
    const check=await rpc("prepare_push",ids);
    let result:Outcome="deferred",handoff:string|null=null,requested=false;
    const authorize:Authorize=async hash=>{
      if(requested)return null;requested=true; // one finalization per local attempt
      const r=await rpc("handoff_push",{...ids,p_request_hash:hash});
      if(r.error || !r.data)return null;
      handoff=r.data.id;return r.data;
    };
    if(!check.error && check.data) {try { result=await send(check.data,authorize); } catch {result="retry";} }
    if((result==="accepted" || result==="gone") && !handoff)result="deferred";
    counts[result]++;
    const finished=await rpc("finish_push",{...ids,p_outcome:result,p_handoff:handoff});
    if(finished.error)throw Error("finish_failed"); // lease will recover; duplicates are possible
  }
  const cleanup=await rpc("cleanup_push_work");if(cleanup.error)throw Error("cleanup_failed");
  return counts;
}
