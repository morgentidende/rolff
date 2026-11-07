import assert from 'node:assert/strict';
import {bootstrap} from './timezone-test-db.mjs';
const {db,OLD,U,V}=await bootstrap();
let pass = 0, fail = 0;
async function t(name, fn) { try { await fn(); pass++; console.log('ok   ', name); } catch (e) { fail++; console.log('FAIL ', name, '-', e.message); } }
async function as(uid, sql, params = []) {
  return db.transaction(async (tx) => {
    await tx.exec(`set local role authenticated; select set_config('request.jwt.sub', '${uid}', true);`);
    return (await tx.query(sql, params)).rows;
  });
}
async function svc(sql, params = []) {
  return db.transaction(async (tx) => { await tx.exec(`set local role service_role;`); return (await tx.query(sql, params)).rows; });
}
async function rejects(p, re) { await assert.rejects(p, re); }
const hash = async (s) => (await db.query(`select encode(extensions.digest($1,'sha256'),'hex') h`, [s])).rows[0].h;


const D='10000000-0000-4000-8000-000000000001', E='10000000-0000-4000-8000-000000000002';
const W=[{weekday:1,start_minute:540,end_minute:1020}];
const get=async(u,d=D)=>(await as(u,'select get_my_receive_settings($1) r',[d]))[0].r;
const save=async(u,rev,mode='auto',zone='Europe/Copenhagen',device=D,windows=W,take=false,enabled=true)=>(await as(u,'select save_my_receive_settings($1,$2::jsonb,$3,$4,$5,$6,$7) r',[enabled,JSON.stringify(windows),mode,zone,device,rev,take]))[0].r;
const sync=async(u,rev,zone='Europe/London',device=D)=>(await as(u,'select sync_my_receive_timezone($1,$2,$3) r',[zone,device,rev]))[0].r;
await t('legacy zone/windows preserved fixed',async()=>{const r=await get(OLD);assert.equal(r.mode,'fixed');assert.equal(r.timezone,'America/New_York');assert.deepEqual(r.windows,[{weekday:2,start_minute:600,end_minute:900}]);});
await t('new user unconfigured revision zero',async()=>{const r=await get(U);assert.equal(r.configured,false);assert.equal(r.revision,0);});
await t('first auto save controller and no controller ID exposed',async()=>{const r=await save(U,0);assert.equal(r.mode,'auto');assert.equal(r.revision,1);assert.equal(r.is_controller,true);assert.equal(JSON.stringify(r).includes(D),false);assert.deepEqual(r.windows,W);});
await t('other user isolated',async()=>{assert.equal((await get(V)).configured,false);assert.equal((await as(V,'select user_id from receive_settings')).length,0);});
await t('other device cannot change timezone silently',async()=>{await rejects(save(U,1,'auto','Europe/London',E),/timezone_control_required/);assert.equal((await get(U)).revision,1);});
await t('other device can edit windows without takeover',async()=>{const r=await save(U,1,'auto','Europe/Copenhagen',E,[]);assert.equal(r.is_controller,false);assert.equal((await get(U,D)).is_controller,true);assert.equal(r.revision,2);});
await t('explicit takeover works',async()=>{const r=await save(U,2,'auto','Europe/London',E,W,true);assert.equal(r.is_controller,true);assert.equal((await get(U,D)).is_controller,false);});
await t('former controller sync rejected',async()=>rejects(sync(U,3,'UTC',D),/timezone_not_controller/));
await t('stale sync rejected',async()=>rejects(sync(U,2,'UTC',E),/settings_conflict/));
await t('controller sync changes only zone/revision/sync time',async()=>{const before=await get(U,E);const r=await sync(U,3,'UTC',E);assert.equal(r.revision,4);assert.equal(r.timezone,'UTC');for(const k of ['enabled','windows','mode','is_controller'])assert.deepEqual(r[k],before[k]);});
await t('fixed save removes controller',async()=>{const r=await save(U,4,'fixed','Europe/Copenhagen',E);assert.equal(r.revision,5);assert.equal(r.mode,'fixed');assert.equal(r.is_controller,false);assert.equal(r.synced_at,null);});
await t('fixed sync rejected',async()=>rejects(sync(U,5,'UTC',E),/timezone_not_controller/));
await t('stale save is atomic',async()=>{const b=await get(U);await rejects(save(U,4,'fixed','UTC',D,[]),/settings_conflict/);assert.deepEqual(await get(U),b);});
for(const zone of ['Not/AZone','CET','+01:00','posix/Europe/Copenhagen'])await t('invalid zone '+zone,async()=>{const b=await get(U);await rejects(save(U,5,'fixed',zone),/invalid_timezone/);assert.deepEqual(await get(U),b);});
const invalids=[null,{},[{weekday:0,start_minute:1,end_minute:2}],[{weekday:8,start_minute:1,end_minute:2}],[{weekday:1,start_minute:1440,end_minute:2}],[{weekday:1,start_minute:1,end_minute:1441}],[{weekday:1,start_minute:1,end_minute:1}],[{weekday:1.5,start_minute:1,end_minute:2}],[{weekday:'1',start_minute:1,end_minute:2}],Array.from({length:129},()=>W[0])];
for(let i=0;i<invalids.length;i++)await t('invalid windows atomic '+i,async()=>{const b=await get(U);await rejects(save(U,5,'fixed','Europe/Copenhagen',D,invalids[i]),/invalid_windows/);assert.deepEqual(await get(U),b);});
await t('atomic replacement removes former windows',async()=>{const nw=[{weekday:6,start_minute:1320,end_minute:420}];const r=await save(U,5,'fixed','Europe/Copenhagen',D,nw);assert.deepEqual(r.windows,nw);assert.equal(r.revision,6);});
await t('DST overnight and half-open end',async()=>{const q=async(ts)=>(await db.query('select in_receive_window($1,$2::timestamptz) v',[U,ts])).rows[0].v;assert.equal(await q('2026-10-24T20:00:00Z'),true);assert.equal(await q('2026-10-24T19:59:00Z'),false);assert.equal(await q('2026-10-25T05:59:00Z'),true);assert.equal(await q('2026-10-25T06:00:00Z'),false);assert.equal(await q('2026-10-25T00:30:00Z'),true);assert.equal(await q('2026-10-25T01:30:00Z'),true);});
await t('enabled empty windows blocks, disabled permits',async()=>{await save(U,6,'fixed','Europe/Copenhagen',D,[]);assert.equal((await db.query('select in_receive_window($1) v',[U])).rows[0].v,false);await save(U,7,'fixed','Europe/Copenhagen',D,[],false,false);assert.equal((await db.query('select in_receive_window($1) v',[U])).rows[0].v,true);});
await t('unauthenticated RPC rejected',async()=>rejects(as('','select get_my_receive_settings($1)',[D]),/unauthenticated/));
await t('direct controller ID read denied',async()=>rejects(as(U,'select timezone_device_id from receive_settings'),/permission denied/));
await t('direct settings/windows mutation denied',async()=>{await rejects(as(U,'update receive_settings set timezone=\'UTC\''),/permission denied/);await rejects(as(U,'delete from receive_windows'),/permission denied/);});
await t('save and sync never force release or enqueue notification',async()=>{
const conv=(await db.query('insert into conversations(created_by) values($1) returning id',[U])).rows[0].id;
const m=(await db.query(`insert into messages(conversation_id,sender_id,body,body_hash,idempotency_key) values($1,$2,'Fabricated scheduling test','synthetic','scratch-timezone-1') returning id`,[conv,V])).rows[0].id;
await db.query('insert into message_deliveries(message_id,recipient_id) values($1,$2)',[m,U]);
await save(U,8,'auto','Europe/Copenhagen',D,[]);await sync(U,9,'UTC');
assert.equal((await db.query('select released_at from message_deliveries where message_id=$1',[m])).rows[0].released_at,null);
assert.equal((await db.query('select count(*)::int n from notification_jobs where user_id=$1',[U])).rows[0].n,0);
assert.equal((await db.query('select _release_for($1,false) n',[U])).rows[0].n,0);
});
console.log(JSON.stringify({pass,fail,backend:process.env.TIMEZONE_SQL_BACKEND||'pglite'}));await db.close();process.exitCode=fail?1:0;
