const test=require('node:test'),assert=require('node:assert/strict'),esbuild=require('esbuild'),path=require('node:path');
const bundle=esbuild.buildSync({entryPoints:[path.resolve(__dirname,'../../src/pushRenew.ts')],bundle:true,platform:'node',format:'cjs',write:false}).outputFiles[0].text;
const mod={exports:{}};new Function('module','exports',bundle)(mod,mod.exports);
const {shouldRenew,RENEW_WITHIN_MS,RENEW_MIN_GAP_MS,RENEW_RETRY_GAP_MS,memoryStore}=mod.exports;
const day=86400000;
const base=({now=1_700_000_000_000,...rest}={})=>({expiresAt:now+80*day,currentEndpoint:'https://fcm.googleapis.com/fcm/send/A',lastEndpoint:'https://fcm.googleapis.com/fcm/send/A',lastSuccessAt:now-2*day,lastFailureAt:null,now,...rest});

test('far-off expiry is left alone',()=>{assert.equal(shouldRenew(base()),false);});
test('first run with far-off expiry (no last success) still skips, so upgrade does not mass-renew',()=>{assert.equal(shouldRenew(base({lastSuccessAt:null,lastEndpoint:null})),false);});
test('renews when expiry is within 30 days and last success is older than 24h',()=>{
  const now=1_700_000_000_000;
  assert.equal(shouldRenew(base({now,expiresAt:now+29*day,lastSuccessAt:now-25*3600*1000})),true);
});
test('throttles to at most once per 24h while inside the 30-day window',()=>{
  const now=1_700_000_000_000;
  assert.equal(shouldRenew(base({now,expiresAt:now+10*day,lastSuccessAt:now-2*3600*1000})),false);
});
test('endpoint or native-token change renews even when expiry is far and last success is recent',()=>{
  const now=1_700_000_000_000;
  assert.equal(shouldRenew(base({now,lastSuccessAt:now-60_000,expiresAt:now+80*day,lastEndpoint:'https://old.example/token',currentEndpoint:'https://new.example/token'})),true);
});
test('failed attempt retries after 5 minutes, not immediately',()=>{
  const now=1_700_000_000_000;
  assert.equal(shouldRenew(base({now,expiresAt:now+10*day,lastSuccessAt:now-40*day,lastFailureAt:now-60_000})),false);
  assert.equal(shouldRenew(base({now,expiresAt:now+10*day,lastSuccessAt:now-40*day,lastFailureAt:now-RENEW_RETRY_GAP_MS})),true);
});
test('memoryStore keeps per-owner records and survives empty or broken storage',()=>{
  const data={};const storage={getItem:k=>k in data?data[k]:null,setItem:(k,v)=>{data[k]=v;}};
  const s=memoryStore(storage);
  assert.equal(s.read('a'),null);
  s.write('a',{endpoint:'e1',lastSuccessAt:1,lastFailureAt:null});
  s.write('b',{endpoint:'e2',lastSuccessAt:2,lastFailureAt:3});
  assert.deepEqual(s.read('a'),{endpoint:'e1',lastSuccessAt:1,lastFailureAt:null});
  assert.equal(s.read('b').endpoint,'e2');
  const broken=memoryStore({getItem:()=>'{',setItem:()=>{throw Error('quota');}});
  assert.equal(broken.read('a'),null);
  broken.write('a',{endpoint:'x',lastSuccessAt:1,lastFailureAt:null});
  assert.equal(RENEW_WITHIN_MS,30*day);assert.equal(RENEW_MIN_GAP_MS,24*3600*1000);
});
