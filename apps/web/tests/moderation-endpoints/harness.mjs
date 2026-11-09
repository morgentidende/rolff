import {pathToFileURL} from 'node:url';import path from 'node:path';
import assert from 'node:assert/strict';
const g=globalThis;let handler;let calls=[];let writes=0;let answer;let blockedWords=[];let providerCalls=0;let topics=[];let topicAnswer={decision:"allow"};let topicRequests=[];let staleIssuer=false;let policyUnavailable=false;let allowCommit=false,duplicate=false;let replyRows=[];let replyErr=null;let modRequests=[];const handlers={};
g.Deno={serve:f=>handler=f,env:{get:k=>({MODERATION_PROVIDER:'openai',OPENAI_API_KEY:'fabricated',OPENAI_MODEL:'mock-model',MODERATION_TIER:'paid',APP_ENV:'production'}[k])}};
g.__admin={rpc:async(name,args)=>{calls.push({name,args});if(name==="recipient_filter_snapshot"&&policyUnavailable)return{data:null,error:{message:"unavailable"}};if(name==="reply_moderation_context"&&replyErr)return{data:null,error:{message:replyErr}};if(name==="issue_reply_approval_v3"&&staleIssuer)return{data:null,error:{message:"recipient_policy_changed"}};const data={message_char_limit:480,_send_limits:[],prepare_send:[],_effective_plan:'text_attachments',recipient_filter_snapshot:{revision:"1",words:blockedWords,topics},assert_reply_target:null,reply_moderation_context:replyRows}[name];if(/issue|commit/.test(name)){if(!allowCommit)throw Error('unexpected approval or commit');return{data:name.startsWith('issue')?'50000000-0000-4000-8000-000000000001':[{message_id:'60000000-0000-4000-8000-000000000001',duplicate:false}],error:null}}return{data:data??null,error:null}},from:table=>{const result={data:table==='messages'&&duplicate?{id:'60000000-0000-4000-8000-000000000001',conversation_id:input.conversation_id,body:input.body}:table==='memberships'?{role:'writer'}:table==='conversation_blocks'?[]:null,error:null};const q=new Proxy({}, {get:(_,k)=>k==='then'?(resolve)=>Promise.resolve(result).then(resolve):['insert','update','upsert','delete'].includes(k)?()=>{writes++;throw Error('unexpected table write')}:()=>q});return q;}};
g.fetch=async(url,opts)=>{providerCalls++;const body=JSON.parse(opts.body);const schema=body.response_format?.json_schema.schema??body.text.format.schema;assert.deepEqual(schema.properties.decision.enum,['allow','block','clarify']);if(!schema.properties.reason_code){topicRequests.push(body);return new Response(JSON.stringify({choices:[{message:{content:JSON.stringify(topicAnswer)}}]}),{status:200})}assert.ok(schema.properties.reason_code.enum.includes('unclear_meaning'));modRequests.push(body);return new Response(JSON.stringify({choices:[{message:{content:JSON.stringify(answer)}}],output_text:JSON.stringify(answer)}),{status:200});};
const input={conversation_id:'11111111-1111-4111-8111-111111111111',idempotency_key:'synthetic-key-1',body:'Aftalen er plimvax nudro.',caption:'Aftalen er plimvax nudro.',file_name:'x.png',file_b64:'iVBORwAAAAA='};
let passed=0;
for(const kind of ['message','attachment']){await import(pathToFileURL(path.join(process.argv[2],kind+'.mjs')).href);handlers[kind]=handler;const run=async(result,expected,words=[])=>{calls=[];writes=0;providerCalls=0;blockedWords=words;answer=kind==='attachment'?{...result,transcript:result.transcript??'Tidspunkt: plimvax nudro.'}:result;const response=await handler(new Request('https://synthetic.invalid',{method:'POST',body:JSON.stringify(input)}));const data=await response.json();assert.equal(response.status,200,JSON.stringify(data));assert.equal(data.status,expected);assert.equal(writes,0);assert.ok(!calls.some(c=>/issue|commit/.test(c.name)));passed++;};
await run({decision:'clarify',reason_code:'unclear_meaning',spans:[],suggestion:''},'clarification_required');
await run({decision:'block',reason_code:'personal_attack',spans:[],suggestion:''},'blocked');
if(kind==='attachment'){await run({decision:'clarify',reason_code:'unclear_meaning',spans:[],suggestion:'',transcript:'Idiot'},'blocked');await run({decision:'clarify',reason_code:'unclear_meaning',spans:[],suggestion:'',transcript:'syntheticblocked'},'blocked_word',['syntheticblocked']);}}
input.file_name='synthetic.png';answer={decision:'clarify',reason_code:'unclear_meaning',spans:[],suggestion:'',transcript:'Idiot'};const regression=await handler(new Request('https://synthetic.invalid',{method:'POST',body:JSON.stringify(input)}));assert.equal((await regression.json()).status,'blocked');passed++;console.log('PASS longer filename cannot mask pure harmful transcript.');
console.log(passed+' actual endpoint scenarios passed; zero approval/commit/table writes, all provider fetches mocked.');

for(const kind of ['message','attachment']){handler=handlers[kind];calls=[];answer={decision:'invalid',reason_code:'none',spans:[],suggestion:'',...(kind==='attachment'?{transcript:'Synthetic'}:{})};const r=await handler(new Request('https://synthetic.invalid',{method:'POST',body:JSON.stringify(input)}));assert.equal(r.status,503);assert.equal((await r.json()).status,'technical_error');assert.ok(!calls.some(c=>/issue|commit/.test(c.name)));passed++;}
handler=handlers.message;calls=[];duplicate=true;providerCalls=0;let r=await handler(new Request('https://synthetic.invalid',{method:'POST',body:JSON.stringify(input)}));assert.equal((await r.json()).status,'accepted');assert.equal(providerCalls,0);assert.equal(calls.length,0);duplicate=false;passed++;
for(const kind of ['message','attachment']){handler=handlers[kind];calls=[];allowCommit=true;answer={decision:'allow',reason_code:'none',spans:[],suggestion:'',...(kind==='attachment'?{transcript:'Receipt number 481'}:{})};r=await handler(new Request('https://synthetic.invalid',{method:'POST',body:JSON.stringify(input)}));assert.equal((await r.json()).status,'accepted');assert.deepEqual(calls.filter(c=>c.name.startsWith('issue')).map(c=>c.name),['issue_reply_approval_v3']);assert.equal(calls.filter(c=>c.name.startsWith('commit')).length,1);allowCommit=false;passed++;}
console.log(passed+' total endpoint scenarios passed, including malformed503, accepted retry and v3 snapshot-bound allow approvals.');

// Semantic stage uses real endpoint/provider code with fetch mocked. These test routing, NOT AI accuracy.
for(const kind of ['message','attachment']) {
 handler=handlers[kind];topics=['omtaler mine forældre'];blockedWords=[];
 const globalAllow={decision:'allow',reason_code:'none',spans:[],suggestion:'',...(kind==='attachment'?{transcript:'Dine forældre har sendt en venlig hilsen.'}:{})};
 for(const [privateResult,expected,http] of [[{decision:'block'},'private_boundary',200],[{decision:'clarify'},'clarification_required',200],[{decision:'allow',secret:'omtaler mine forældre'},'technical_error',503],[{decision:'invented'},'technical_error',503]]) {
  calls=[];topicRequests=[];answer=globalAllow;topicAnswer=privateResult;providerCalls=0;
  const r=await handler(new Request('https://synthetic.invalid',{method:'POST',body:JSON.stringify(input)}));const payload=await r.text();
  assert.equal(r.status,http);assert.equal(JSON.parse(payload).status,expected);assert.ok(!payload.includes('forældre'));assert.equal(topicRequests.length,1);
  assert.ok(!calls.some(c=>/issue|commit/.test(c.name)));assert.ok(!calls.filter(c=>c.name==='record_attempt').some(c=>JSON.stringify(c.args).includes('forældre')));passed++;
 }
 for(const result of [{decision:'block',reason_code:'personal_attack',spans:[],suggestion:''},{decision:'clarify',reason_code:'unclear_meaning',spans:[],suggestion:''}]) {
  calls=[];topicRequests=[];answer={...result,...(kind==='attachment'?{transcript:'Neutral synthetic text'}:{})};topicAnswer={decision:'allow'};
  const r=await handler(new Request('https://synthetic.invalid',{method:'POST',body:JSON.stringify(input)}));assert.equal((await r.json()).status,result.decision==='block'?'blocked':'clarification_required');assert.equal(topicRequests.length,0);assert.ok(!calls.some(c=>/issue|commit/.test(c.name)));passed++;
 }
 calls=[];topicRequests=[];answer=globalAllow;topicAnswer={decision:'allow'};allowCommit=true;
 let r=await handler(new Request('https://synthetic.invalid',{method:'POST',body:JSON.stringify(input)}));assert.equal((await r.json()).status,'accepted');
 const ticket=calls.find(c=>c.name==='issue_reply_approval_v3');assert.equal(ticket.args.p_revision,'1');assert.ok(!JSON.stringify(ticket).includes('forældre'));
 if(kind==='attachment'){const data=JSON.stringify(topicRequests[0]);assert.ok(data.includes('Dine forældre'));assert.ok(data.includes(input.caption));assert.ok(data.includes(input.file_name));}passed++;
 staleIssuer=true;calls=[];r=await handler(new Request('https://synthetic.invalid',{method:'POST',body:JSON.stringify(input)}));assert.equal(r.status,503);assert.ok(!calls.some(c=>c.name.startsWith('commit')));staleIssuer=false;allowCommit=false;passed++;
 policyUnavailable=true;providerCalls=0;calls=[];r=await handler(new Request('https://synthetic.invalid',{method:'POST',body:JSON.stringify(input)}));assert.equal(r.status,503);assert.equal(providerCalls,0);assert.ok(!calls.some(c=>/issue|commit/.test(c.name)));policyUnavailable=false;passed++;
}
console.log(passed+' total actual endpoint scenarios passed, including deny-only topics, attachment parity, strict malformed failures, private errors and stale snapshot binding.');

// Replies: Luna gets the replied-to message (server RPC after assert_reply_target) as context; fail closed.
const replyId='22222222-2222-4222-8222-222222222222';
for(const kind of ['message','attachment']){
 handler=handlers[kind];topics=['syntetisk emne'];blockedWords=[];
 const ok={decision:'allow',reason_code:'none',spans:[],suggestion:'',...(kind==='attachment'?{transcript:'Neutral synthetic text'}:{})};
 calls=[];modRequests=[];topicRequests=[];answer=ok;topicAnswer={decision:'allow'};allowCommit=true;replyRows=[{mine:false,body:'Gammel syntetisk aftale om fredag',newer:9}];
 let r=await handler(new Request('https://synthetic.invalid',{method:'POST',body:JSON.stringify({...input,reply_to_id:replyId})}));assert.equal((await r.json()).status,'accepted');
 const names=calls.map(c=>c.name);assert.ok(names.indexOf('assert_reply_target')>=0&&names.indexOf('assert_reply_target')<names.indexOf('reply_moderation_context'));
 assert.deepEqual(calls.find(c=>c.name==='reply_moderation_context').args,{p_sender:calls.find(c=>c.name==='reply_moderation_context').args.p_sender,conv:input.conversation_id,p_reply:replyId});
 assert.equal(modRequests.length,1);assert.ok(JSON.stringify(modRequests[0]).includes('replying_to\\":'));assert.ok(JSON.stringify(modRequests[0]).includes('Gammel syntetisk aftale om fredag'));
 assert.equal(topicRequests.length,1);assert.ok(JSON.stringify(topicRequests[0]).includes('Gammel syntetisk aftale om fredag'));
 assert.equal(calls.find(c=>c.name==='issue_reply_approval_v3').args.p_reply_to??replyId,replyId);allowCommit=false;passed++;
 // no reply: no extra RPC, no replying_to
 calls=[];modRequests=[];allowCommit=true;r=await handler(new Request('https://synthetic.invalid',{method:'POST',body:JSON.stringify(input)}));assert.equal((await r.json()).status,'accepted');
 assert.ok(!calls.some(c=>c.name==='reply_moderation_context'));assert.ok(!JSON.stringify(modRequests[0]).includes('Gammel syntetisk aftale'));assert.ok(!JSON.stringify(modRequests[0]).includes('replying_to\\":'));allowCommit=false;passed++;
 // RPC rejects (not visible) -> 400 invalid_reply; other error -> 503; never reaches provider/approval
 for(const [err,http] of [['invalid_reply',400],['boom',503]]){calls=[];providerCalls=0;replyErr=err;
  r=await handler(new Request('https://synthetic.invalid',{method:'POST',body:JSON.stringify({...input,reply_to_id:replyId})}));assert.equal(r.status,http);assert.equal(providerCalls,0);assert.ok(!calls.some(c=>/issue|commit/.test(c.name)));replyErr=null;passed++;}
 topics=[];replyRows=[];
}
console.log(passed+' total endpoint scenarios passed, including reply context for Luna (message + attachment).');

// Luna's block explanation: passed through on block (same single provider call), dropped when unsafe, absent on fallback.
for(const kind of ['message','attachment']){
 handler=handlers[kind];topics=[];blockedWords=[];
 for(const [explanation,expected] of [['Beskeden kan virke anklagende og gøre den anden defensiv.','Beskeden kan virke anklagende og gøre den anden defensiv.'],['Ordet plimvax kan såre.',undefined],['<b>Det lyder som en ordre.</b>',undefined],[undefined,undefined]]){
  calls=[];providerCalls=0;answer={decision:'block',reason_code:'controlling_demand',spans:['plimvax'],suggestion:'',...(explanation===undefined?{}:{explanation}),...(kind==='attachment'?{transcript:'Tidspunkt: plimvax nudro.'}:{})};
  const r=await handler(new Request('https://synthetic.invalid',{method:'POST',body:JSON.stringify(input)}));const data=await r.json();
  assert.equal(r.status,200);assert.equal(data.status,'blocked');assert.equal(data.reason_code,'controlling_demand');assert.equal(data.explanation,expected);assert.equal(providerCalls,1);
  assert.ok(!calls.some(c=>c.name==='record_attempt'&&JSON.stringify(c.args).includes('defensiv')));passed++;
 }
}
console.log(passed+' total endpoint scenarios passed, including Luna block explanations (message + attachment).');
