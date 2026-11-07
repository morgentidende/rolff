import { assert, assertEquals, assertRejects } from "jsr:@std/assert@1";
import { blockingApi, sortBlockEntries } from "../../apps/web/src/blockingListModel.ts";
const rows=[{id:'3',word:'åben',created_at:'2026-01-02T00:00:00.000002+00:00'},{id:'1',word:'æble',created_at:'2020-01-01T00:00:00+00:00'},{id:'2',word:'ønske',created_at:'2026-01-02T00:00:00.000001+00:00'}];
Deno.test('blocklists Danish ÆØÅ; genuine legacy timestamps and sub-ms chronology preserved; no in-place save-sort',()=>{
 const before=JSON.stringify(rows);
 assertEquals(sortBlockEntries(rows,'alphabetical').map(x=>x.word),['æble','ønske','åben']);
 assertEquals(sortBlockEntries(rows,'oldest').map(x=>x.id),['1','2','3']);
 assertEquals(sortBlockEntries(rows,'newest').map(x=>x.id),['3','2','1']);
 assertEquals(JSON.stringify(rows),before);
});
Deno.test('blocklists ties deterministic by existing id, not fabricated creation times',()=>{
 const tie=rows.map(x=>({...x,created_at:'2020-01-01T00:00:00+00:00'}));
 assertEquals(sortBlockEntries(tie,'oldest').map(x=>x.id),['1','2','3']);
 assertEquals(sortBlockEntries([...tie].reverse(),'oldest'),sortBlockEntries(tie,'oldest'));
 assertEquals(sortBlockEntries(tie,'newest').map(x=>x.id),['3','2','1']);
});
Deno.test('blocklist HTTP captures opening token, scoped URL/body and fails closed on unsuccessful save',async()=>{
 const seen:any[]=[];const fakeFetch:typeof fetch=async(url,opts)=>{seen.push({url,opts});return new Response(null,{status:503});};
 const api=blockingApi('https://synthetic.invalid','fabricated-key','fabricated-token-A',fakeFetch);
 await assertRejects(()=>api('rpc/reset_blocked_words','POST',{conv:'fabricated-conversation'}));
 assertEquals(seen[0].opts.headers.authorization,'Bearer fabricated-token-A');assertEquals(JSON.parse(seen[0].opts.body),{conv:'fabricated-conversation'});assert(String(seen[0].url).startsWith('https://synthetic.invalid/rest/v1/'));
});
Deno.test('blocklists whole-second vs microsecond timestamps and mixed precision compare true instants',()=>{
 const times=['2026-01-02T10:00:00.1+00:00','2026-01-02T10:00:00.000001+00:00','2026-01-02T10:00:00+00:00','2026-01-02T10:00:00.000010Z','2026-01-02T10:00:00.000002+00:00'];
 const entries=times.map((created_at,i)=>({id:String(i),word:'æble',created_at}));
 assertEquals(sortBlockEntries(entries,'oldest').map(x=>x.id),['2','1','4','3','0']);
 assertEquals(sortBlockEntries(entries,'newest').map(x=>x.id),['0','3','4','1','2']);
});
Deno.test('blocklists mixed offsets normalize to UTC without losing microseconds and equal-instant ID ties',()=>{
 const entries=[
  {id:'a',word:'æble',created_at:'2026-01-02T11:00:00.000001+01:00'},
  {id:'z',word:'æble',created_at:'2026-01-02T10:00:00Z'},
  {id:'b',word:'æble',created_at:'2026-01-02T05:00:00.000002-05:00'},
  {id:'c',word:'æble',created_at:'2026-01-02T15:30:00.000001+05:30'},
  {id:'d',word:'æble',created_at:'2026-01-02T09:59:59.999999Z'}
 ];
 assertEquals(sortBlockEntries(entries,'oldest').map(x=>x.id),['d','z','a','c','b']);
 assertEquals(sortBlockEntries(entries,'newest').map(x=>x.id),['b','c','a','z','d']);
 assertEquals(sortBlockEntries(entries,'alphabetical').map(x=>x.id),['d','z','a','c','b']);
});
