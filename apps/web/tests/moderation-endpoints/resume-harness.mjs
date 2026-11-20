// Real send-message endpoint code, resume of a held delayed message: the STORED text is re-checked against the
// current recipient lists (house rules, blocked words, topics, model) before the hold can end. All provider
// fetches are mocked (no network, no model calls); admin RPCs are fabricated.
import {pathToFileURL} from 'node:url';import path from 'node:path';
import assert from 'node:assert/strict';
const g=globalThis;let handler;let calls=[];let providerCalls=0,modRequests=[],topicRequests=[];
let modAnswer={decision:'allow',reason_code:'none',spans:[],suggestion:''},topicAnswer={decision:'allow'},providerStatus=200;
let words=[],topics=[],ownCtx=[],resumable={data:null,error:null},issueErr=null,resumeErr=null;
const CONV='11111111-1111-4111-8111-111111111111',MID='60000000-0000-4000-8000-000000000009',STORED='Aftalen er plimvax nudro.';
g.Deno={serve:f=>handler=f,env:{get:k=>({MODERATION_PROVIDER:'openai',OPENAI_API_KEY:'fabricated',OPENAI_MODEL:'mock-model',MODERATION_TIER:'paid',APP_ENV:'production'}[k])}};
g.__admin={rpc:async(name,args)=>{calls.push({name,args});
 if(name==='get_resumable_message')return resumable;
 if(name==='issue_reply_approval_v3'&&issueErr)return{data:null,error:{message:issueErr}};
 if(name==='resume_held_message')return resumeErr?{data:null,error:{message:resumeErr}}:{data:[{message_id:MID,due:'2026-11-20T08:00:30Z'}],error:null};
 if(/^(commit_|update_delayed)/.test(name))throw Error('resume must never commit or edit: '+name);
 const data={message_char_limit:480,_send_limits:[],prepare_send:ownCtx,_effective_plan:'text_attachments',recipient_filter_snapshot:{revision:'1',words,topics},assert_reply_target:null,issue_reply_approval_v3:'50000000-0000-4000-8000-000000000001',locale_of:'da'}[name];
 return{data:data??null,error:null}},
 from:table=>{const result={data:table==='memberships'?{role:'writer'}:table==='conversation_blocks'?[]:null,error:null};const q=new Proxy({}, {get:(_,k)=>k==='then'?(resolve)=>Promise.resolve(result).then(resolve):['insert','update','upsert','delete'].includes(k)?()=>{throw Error('unexpected table write')}:()=>q});return q;}};
g.fetch=async(url,opts)=>{providerCalls++;if(providerStatus!==200)return new Response('{}',{status:providerStatus});const body=JSON.parse(opts.body);const schema=body.response_format?.json_schema.schema??body.text.format.schema;
 if(!schema.properties.reason_code){topicRequests.push(body);return new Response(JSON.stringify({choices:[{message:{content:JSON.stringify(topicAnswer)}}]}),{status:200})}
 modRequests.push(body);return new Response(JSON.stringify({choices:[{message:{content:JSON.stringify(modAnswer)}}],output_text:JSON.stringify(modAnswer)}),{status:200});};
await import(pathToFileURL(path.join(process.argv[2],'message.mjs')).href);
const post=async(over={})=>{const r=await handler(new Request('https://synthetic.invalid',{method:'POST',body:JSON.stringify({conversation_id:CONV,idempotency_key:'synthetic-key-resume',body:'ignored by the server',lang:'da',resume_message_id:MID,...over})}));return{status:r.status,data:await r.json()};};
const reset=()=>{calls=[];providerCalls=0;modRequests=[];topicRequests=[];modAnswer={decision:'allow',reason_code:'none',spans:[],suggestion:''};topicAnswer={decision:'allow'};providerStatus=200;words=[];topics=[];ownCtx=[{ctx_mine:false,ctx_body:'Hej, kan vi tale sammen?'},{ctx_mine:true,ctx_body:STORED}];resumable={data:[{conversation_id:CONV,body:STORED,held:true}],error:null};issueErr=null;resumeErr=null;};
const names=()=>calls.map(c=>c.name);
const noEnd=()=>{assert.ok(!names().includes('issue_reply_approval_v3'),'no approval issued');assert.ok(!names().includes('resume_held_message'),'hold must not end');};
let passed=0;const t=async(n,f)=>{reset();await f();passed++;console.log('ok  ',n);};
const sha=async s=>[...new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(s)))].map(b=>b.toString(16).padStart(2,'0')).join('');

await t('still allowed: full pipeline ran on the STORED text, then (and only then) the hold ends with a fresh approval',async()=>{
 const r=await post();assert.equal(r.status,200);assert.equal(r.data.status,'accepted');assert.equal(r.data.message_id,MID);
 const n=names();assert.ok(n.indexOf('get_resumable_message')<n.indexOf('recipient_filter_snapshot')&&n.indexOf('recipient_filter_snapshot')<n.indexOf('issue_reply_approval_v3')&&n.indexOf('issue_reply_approval_v3')<n.indexOf('resume_held_message'));
 assert.equal(calls.find(c=>c.name==='issue_reply_approval_v3').args.p_hash,await sha(STORED),'approval is for the stored text, not the client body');
 assert.equal(calls.find(c=>c.name==='resume_held_message').args.p_approval,'50000000-0000-4000-8000-000000000001');
 assert.equal(modRequests.length,1);assert.ok(JSON.stringify(modRequests[0]).includes('plimvax'));assert.ok(!JSON.stringify(modRequests[0]).includes('ignored by the server'));
});
await t('the held message is not a "repeat" of itself (it is removed from the history before the rule check)',async()=>{
 const r=await post();assert.equal(r.data.status,'accepted');
});
await t('...but a real earlier identical message still counts as a repeat',async()=>{
 ownCtx=[{ctx_mine:true,ctx_body:STORED},{ctx_mine:true,ctx_body:STORED}];
 const r=await post();assert.equal(r.data.status,'rule');assert.equal(r.data.rule,'repeat');noEnd();assert.equal(providerCalls,0);
});
await t('a blocked word added to the recipient list while paused blocks the resume (only the matched word is returned)',async()=>{
 words=['plimvax'];const r=await post();assert.equal(r.status,200);assert.equal(r.data.status,'blocked_word');assert.equal(r.data.word,'plimvax');noEnd();assert.equal(providerCalls,0);
});
await t('house rule on the stored text (emoji) blocks the resume before any model call',async()=>{
 resumable={data:[{conversation_id:CONV,body:'Det er fint 😀',held:true}],error:null};ownCtx=[];
 const r=await post();assert.equal(r.data.status,'rule');assert.equal(r.data.rule,'emoji');noEnd();assert.equal(providerCalls,0);
});
await t('model now blocks: normal block reply (reason, explanation path), hold stays',async()=>{
 modAnswer={decision:'block',reason_code:'personal_attack',spans:['plimvax'],suggestion:'',explanation:'Beskeden kan virke anklagende.'};
 const r=await post();assert.equal(r.status,200);assert.equal(r.data.status,'blocked');assert.equal(r.data.reason_code,'personal_attack');assert.equal(r.data.explanation,'Beskeden kan virke anklagende.');noEnd();assert.equal(providerCalls,1);
});
await t('model asks for clarification: not resumed',async()=>{
 modAnswer={decision:'clarify',reason_code:'unclear_meaning',spans:[],suggestion:''};
 const r=await post();assert.equal(r.data.status,'clarification_required');noEnd();
});
await t('a topic added while paused blocks the resume through the existing topic stage (mocked model)',async()=>{
 topics=['omtaler mine forældre'];topicAnswer={decision:'block'};
 const r=await post();assert.equal(r.data.status,'private_boundary');assert.equal(topicRequests.length,1);assert.ok(!JSON.stringify(r).includes('forældre'));noEnd();
});
await t('topic check unavailable/invalid or model down: fail strict (503), hold stays',async()=>{
 topics=['omtaler mine forældre'];topicAnswer={decision:'allow',secret:'x'};
 let r=await post();assert.equal(r.status,503);noEnd();
 reset();providerStatus=500;r=await post();assert.equal(r.status,503);noEnd();
});
await t('recipient lists changed between check and approval (stale snapshot): 503, hold stays',async()=>{
 issueErr='recipient_policy_changed';const r=await post();assert.equal(r.status,503);assert.ok(!names().includes('resume_held_message'));
});
await t('approval refused by the database at the end (e.g. already consumed): not accepted, no commit/edit',async()=>{
 resumeErr='approval_invalid';const r=await post();assert.equal(r.status,503);
});
await t('message already delivered/deleted: 409 no_longer_pending, nothing moderated',async()=>{
 resumable={data:null,error:{message:'no_longer_pending'}};const r=await post();assert.equal(r.status,409);assert.equal(r.data.error,'no_longer_pending');assert.equal(providerCalls,0);noEnd();
 reset();resumable={data:null,error:{message:'not_found'}};assert.equal((await post()).status,409);
});
await t('other lookup failure: 503; wrong conversation: 400; edit+resume together: 400',async()=>{
 resumable={data:null,error:{message:'boom'}};assert.equal((await post()).status,503);
 reset();resumable={data:[{conversation_id:'22222222-2222-4222-8222-222222222222',body:STORED,held:true}],error:null};assert.equal((await post()).status,400);noEnd();
 reset();assert.equal((await post({edit_message_id:MID})).status,400);assert.equal(calls.length,0);
});
console.log(passed+' resume endpoint scenarios passed; no commit/edit calls, all provider fetches mocked.');
