const test=require('node:test'),assert=require('node:assert/strict'),vm=require('node:vm'),fs=require('node:fs'),path=require('node:path'),{randomUUID}=require('node:crypto');
const source=fs.readFileSync(path.resolve(__dirname,'../../public/sw.js'),'utf8');
const owner='10000000-0000-4000-8000-000000000001',binding='20000000-0000-4000-8000-000000000002';
function harness(storage={}){
 const handlers={},shown=[],opened=[],logs=[],windows=[],self={location:{origin:'https://synthetic.invalid'},registration:{scope:'https://synthetic.invalid/app/',getNotifications:async()=>shown.filter(x=>!x.closed),showNotification:async(title,options)=>{shown.push({title,...options,closed:false,close(){this.closed=true;}});}},clients:{claim:async()=>{},matchAll:async()=>windows,openWindow:async url=>opened.push(url)},skipWaiting:async()=>{},addEventListener:(name,fn)=>handlers[name]=fn};
 const indexedDB={open(){const open={};setImmediate(()=>{open.result={createObjectStore(){},close(){},transaction(){const tx={objectStore:()=>({get(){const r={};setImmediate(()=>{r.result=structuredClone(storage.value);r.onsuccess();setImmediate(()=>tx.oncomplete());});return r;},put(v){storage.value=structuredClone(v);setImmediate(()=>tx.oncomplete());}})};return tx;}};open.onsuccess();});return open;}};
 vm.runInNewContext(source,{self,indexedDB,crypto:{randomUUID},URL,Date,Number,Promise,console:{log:(...a)=>logs.push(a),warn:(...a)=>logs.push(a),error:(...a)=>logs.push(a)},fetch(){throw Error('Network forbidden');}});
 async function emit(name,event={}){const waits=[];handlers[name]({...event,waitUntil:p=>waits.push(p)});await Promise.all(waits);assert.equal(logs.length,0);}
 async function message(data,origin='https://synthetic.invalid/app/'){let response;await emit('message',{data,source:{url:origin},ports:[{postMessage:x=>response=x}]});return response?.value;}
 async function push(data){await emit('push',{data:{text:()=>JSON.stringify(data),json:()=>data}});}
 return {self,storage,shown,opened,windows,message,push,emit};
}
async function bind(h){const s=await h.message({type:'IDENTITY',owner});assert.equal(await h.message({type:'BIND',fence:s.fence,binding}),true);return s;}
const payload=(extra={})=>({v:1,binding,expires:Date.now()+20000,...extra});
test('no name in payload: generic title/body, never payload text or links',async()=>{const h=harness();await bind(h);await h.push(payload({body:'MALICIOUS PRIVATE BODY',sender:'Synthetic Name',email:'a@b.invalid',title:'EVIL',url:'https://evil.invalid/steal'}));assert.equal(h.shown.length,1);const n=h.shown[0];assert.equal(n.title,'ROLFF');assert.equal(n.body,'Du har nye beskeder klar.');assert.deepEqual(Object.keys(n.data),['binding']);assert(!JSON.stringify(n).includes('MALICIOUS'));assert(!JSON.stringify(n).includes('EVIL'));assert(!JSON.stringify(n).includes('a@b'));});
test('generic fallback follows app language: English only for l=en, Danish otherwise',async()=>{const h=harness();await bind(h);await h.push(payload({l:'en'}));await h.push(payload({l:'en',body:'MALICIOUS'}));await h.push(payload({l:'xx'}));await h.push(payload());assert.equal(h.shown[0].body,'You have new messages ready.');assert.equal(h.shown[0].lang,'en');assert.equal(h.shown[1].body,'You have new messages ready.');assert.equal(h.shown[2].body,'Du har nye beskeder klar.');assert.equal(h.shown[3].body,'Du har nye beskeder klar.');assert.equal(h.shown[3].lang,'da');for(const n of h.shown)assert.equal(n.title,'ROLFF');});
const shownText=async(extra)=>{const h=harness();await bind(h);await h.push(payload(extra));const n=h.shown[0];return [n.title,n.body];};
test('sender name (da): single message, several messages from one sender, two senders, many senders',async()=>{
 assert.deepEqual(await shownText({s:['Far'],k:1,n:1}),['Ny besked fra Far','Åbn Rolff for at læse den.']);
 assert.deepEqual(await shownText({s:['Far'],k:1,n:3}),['Nye beskeder fra Far','Åbn Rolff for at læse dem.']);
 assert.deepEqual(await shownText({s:['Far','Mor'],k:2,n:2}),['Nye beskeder fra Far og Mor','Åbn Rolff for at læse dem.']);
 assert.deepEqual(await shownText({s:['Far'],k:3,n:5}),['Nye beskeder fra Far og 2 andre','Åbn Rolff for at læse dem.']);
 assert.deepEqual(await shownText({s:['Far'],k:2,n:2}),['Nye beskeder fra Far og 1 anden','Åbn Rolff for at læse dem.']);
});
test('sender name (en) follows the recipient language',async()=>{
 assert.deepEqual(await shownText({l:'en',s:['Dad'],k:1,n:1}),['New message from Dad','Open Rolff to read it.']);
 assert.deepEqual(await shownText({l:'en',s:['Dad'],k:1,n:2}),['New messages from Dad','Open Rolff to read them.']);
 assert.deepEqual(await shownText({l:'en',s:['Dad','Mom'],k:2,n:4}),['New messages from Dad and Mom','Open Rolff to read them.']);
 assert.deepEqual(await shownText({l:'en',s:['Dad'],k:3,n:3}),['New messages from Dad and 2 others','Open Rolff to read them.']);
 assert.deepEqual(await shownText({l:'en',s:['Dad'],k:2,n:2}),['New messages from Dad and 1 other','Open Rolff to read them.']);
});
test('unusable name data falls back to the generic text (never throws, never shows odd input)',async()=>{
 for(const extra of [{s:[],k:1},{s:'Far',k:1},{s:[5],k:1},{s:['Far']},{s:['Far'],k:0},{s:['Far'],k:'1'},{s:['\u200b'],k:1},{s:['Far','Mor'],k:1},{s:{x:1},k:1},{s:['Far'],k:1000}])assert.deepEqual(await shownText(extra),['ROLFF','Du har nye beskeder klar.'],JSON.stringify(extra));
 assert.equal((await shownText({s:['Far'],k:1,n:'x'}))[0],'Ny besked fra Far','bad message count falls back to sender count');
});
test('e-mail fallback names show as-is (da and en), including a shortened long address',async()=>{
 assert.deepEqual(await shownText({s:['far@example.com'],k:1,n:1}),['Ny besked fra far@example.com','Åbn Rolff for at læse den.']);
 assert.deepEqual(await shownText({l:'en',s:['dad@example.com'],k:1,n:1}),['New message from dad@example.com','Open Rolff to read it.']);
 assert.deepEqual(await shownText({s:['far@example.com','mor@example.com'],k:2,n:2}),['Nye beskeder fra far@example.com og mor@example.com','Åbn Rolff for at læse dem.']);
 const long='very.long.local.part.of.an.address…@example.invalid';assert(Array.from(long).length>40);const [t]=await shownText({s:[long],k:1,n:1});assert.equal(Array.from(t.replace('Ny besked fra ','')).length,40,'worker caps any name at 40 characters');
});
test('names are cleaned and capped; title never contains message content or markup beyond the name',async()=>{
 const [t]=await shownText({s:['\u202eFar\u200b\u0007 '+'x'.repeat(60)],k:1,n:1});assert.equal(t,'Ny besked fra Far '+'x'.repeat(36));assert(!/[\u202e\u200b\u0007]/.test(t));
 const [t2,b2]=await shownText({s:['Far'],k:1,n:1,body:'SECRET TEXT',message:'SECRET TEXT',text:'SECRET TEXT'});assert(!(t2+b2).includes('SECRET'));
});
test('notification never sets icon or image (no duplicate large logo); only the white badge, no click URL or message data',async()=>{
 const h=harness();await bind(h);await h.push(payload({s:['Far'],k:1,n:1,image:'https://evil.invalid/x.png',icon:'https://evil.invalid/y.png'}));const n=h.shown[0];
 assert(!('icon' in n));assert(!('image' in n));assert.equal(n.badge,'https://synthetic.invalid/app/icons/rolff-badge-96.png?v=4');assert.deepEqual(Object.keys(n.data),['binding']);assert.equal(n.tag,'rolff-ready');
});
test('a new notice replaces the previous one (same tag) so batched names never stack',async()=>{
 const h=harness();await bind(h);await h.push(payload({s:['Far'],k:1,n:1}));await h.push(payload({s:['Far'],k:2,n:2}));assert(h.shown.every(n=>n.tag==='rolff-ready'));
});
test('late old-account pushes dropped after logout; stale notifications closed',async()=>{const h=harness();await bind(h);await h.push(payload());await h.message({type:'IDENTITY',owner:null});assert(h.shown[0].closed);await h.push(payload());assert.equal(h.shown.length,1);});
test('new account cannot receive old binding or stale click',async()=>{const h=harness();await bind(h);await h.push(payload());const notification=h.shown[0];await h.message({type:'IDENTITY',owner:'30000000-0000-4000-8000-000000000003'});await h.push(payload());await h.emit('notificationclick',{notification});assert.equal(h.shown.length,1);assert.equal(h.opened.length,0);});
test('safe click always opens same-origin overview, ignores attacker URL',async()=>{const h=harness();await bind(h);await h.push(payload());h.shown[0].data.url='https://evil.invalid/steal';await h.emit('notificationclick',{notification:h.shown[0]});assert.deepEqual(h.opened,['https://synthetic.invalid/app/']);});
test('expired, future, oversized, malformed or mismatched payload never displayed',async()=>{const h=harness();await bind(h);for(const p of [payload({expires:Date.now()-1}),payload({expires:Date.now()+60000}),payload({body:'A'.repeat(600)}),payload({binding:'wrong'}),payload({v:2})])await h.push(p);await h.emit('push',{data:{text:()=>'{',json:()=>{throw Error('invalid');}}});assert.equal(h.shown.length,0);});
test('worker restart persists opaque local binding, not a token',async()=>{const store={};let h=harness(store);await bind(h);h=harness(store);await h.push(payload());assert.equal(h.shown.length,1);assert.deepEqual(Object.keys(store.value).sort(),['binding','fence','owner']);});
test('stale BIND fence cannot resurrect after CLEAR',async()=>{const h=harness(),s=await bind(h);await h.message({type:'CLEAR',fence:s.fence});assert.equal(await h.message({type:'BIND',fence:s.fence,binding}),false);await h.push(payload());assert.equal(h.shown.length,0);});
test('cross-origin page cannot alter local binding',async()=>{const h=harness();await bind(h);assert.equal(await h.message({type:'IDENTITY',owner:null},'https://evil.invalid/'),undefined);await h.push(payload());assert.equal(h.shown.length,1);});
test('subscription change clears visibility, closes notifications, no background permission prompt',async()=>{const h=harness();await bind(h);await h.push(payload());await h.emit('pushsubscriptionchange');assert(h.shown[0].closed);await h.push(payload());assert.equal(h.shown.length,1);assert.equal(h.storage.value.binding,null);});
test('worker never registers a fetch interception or logs payload',()=>{assert(!source.includes("addEventListener('fetch'"));assert(!/console\.(log|warn|error)/.test(source));assert(!source.includes('requestPermission'));});

// Android status bar: monochrome Rolff badge (white silhouette, transparent background) + full-colour icon.
const zlib=require('node:zlib');
function png(file){const b=fs.readFileSync(path.resolve(__dirname,'../../public/icons',file));assert.equal(b.subarray(1,4).toString(),'PNG');
 const w=b.readUInt32BE(16),h=b.readUInt32BE(20),depth=b[24],type=b[25];let off=8,idat=[];while(off<b.length){const len=b.readUInt32BE(off),t=b.subarray(off+4,off+8).toString();if(t==='IDAT')idat.push(b.subarray(off+8,off+8+len));off+=12+len;}
 assert.equal(depth,8);assert.equal(type,6,'RGBA');const raw=zlib.inflateSync(Buffer.concat(idat)),bpp=4,stride=w*bpp,out=Buffer.alloc(h*stride);
 for(let y=0;y<h;y++){const f=raw[y*(stride+1)];for(let x=0;x<stride;x++){const v=raw[y*(stride+1)+1+x],a=x>=bpp?out[y*stride+x-bpp]:0,u=y?out[(y-1)*stride+x]:0,c=x>=bpp&&y?out[(y-1)*stride+x-bpp]:0;
  let p=0;if(f===1)p=a;else if(f===2)p=u;else if(f===3)p=(a+u)>>1;else if(f===4){const q=a+u-c,pa=Math.abs(q-a),pb=Math.abs(q-u),pc=Math.abs(q-c);p=pa<=pb&&pa<=pc?a:pb<=pc?u:c;}out[y*stride+x]=(v+p)&255;}}
 return {w,h,px:out};}
test('badge PNGs are 96x96 and 72x72 white silhouettes on a transparent background',()=>{for(const [file,n] of [['rolff-badge-96.png',96],['rolff-badge-72.png',72]]){const {w,h,px}=png(file);assert.equal(w,n);assert.equal(h,n);let opaque=0,clear=0;for(let i=0;i<px.length;i+=4){const a=px[i+3];if(a>0){assert.deepEqual([px[i],px[i+1],px[i+2]],[255,255,255],'only white pixels');}if(a===255)opaque++;if(a===0)clear++;}
 assert(clear>w*h*0.2,'transparent background');assert(opaque>w*h*0.25,'solid mark');assert.equal(px[3],0,'corner is transparent');}});
test('notification uses the monochrome badge as a same-origin PNG under the scope; the full-colour app icon is NOT sent as a notification picture',async()=>{const h=harness();await bind(h);await h.push(payload());const n=h.shown[0];
 assert.equal(n.badge,'https://synthetic.invalid/app/icons/rolff-badge-96.png?v=4');assert(!('icon' in n));
 assert(fs.existsSync(path.resolve(__dirname,'../../public/icons',path.basename(n.badge).split('?')[0])));
 const {px}=png('rolff-192.png');let colour=0;for(let i=0;i<px.length;i+=4)if(px[i+3]>0&&(px[i]!==px[i+1]||px[i+1]!==px[i+2]))colour++;assert(colour>1000,'icon is full colour, not a silhouette');
 assert(n.badge.startsWith('https://synthetic.invalid/'));});

// ---- Invitation accepted ("X har accepteret din invitation") ----
const CONV='30000000-0000-4000-8000-000000000003';
test('invitation accepted (da): "<name> har accepteret din invitation" / "Nu kan I chatte på Rolff."; own tag, badge only, no icon',async()=>{
 const h=harness();await bind(h);await h.push(payload({t:'a',c:CONV,s:['Far']}));const n=h.shown[0];
 assert.equal(n.title,'Far har accepteret din invitation');assert.equal(n.body,'Nu kan I chatte på Rolff.');assert.equal(n.lang,'da');
 assert.equal(n.tag,'rolff-accept-'+CONV,'does not replace (or get replaced by) the message notice');
 assert.equal(n.badge,'https://synthetic.invalid/app/icons/rolff-badge-96.png?v=4');assert(!('icon' in n)&&!('image' in n));
 assert.equal(JSON.stringify(n.data),JSON.stringify({binding,c:CONV}));
});
test('invitation accepted (en): "<name> accepted your invitation" / "You can now chat on Rolff."; e-mail fallback name is shown as is',async()=>{
 const h=harness();await bind(h);await h.push(payload({l:'en',t:'a',c:CONV,s:['mor@example.invalid']}));
 assert.equal(h.shown[0].title,'mor@example.invalid accepted your invitation');assert.equal(h.shown[0].body,'You can now chat on Rolff.');assert.equal(h.shown[0].lang,'en');
});
test('invitation accepted without a (valid) name: generic text in the right language',async()=>{
 for(const extra of [{},{s:[]},{s:['']},{s:['\u200b']},{s:[5]},{s:'Far'}]){
  const h=harness();await bind(h);await h.push(payload({t:'a',c:CONV,...extra}));assert.equal(h.shown[0].title,'Din invitation er accepteret',JSON.stringify(extra));assert.equal(h.shown[0].body,'Nu kan I chatte på Rolff.');}
 const h=harness();await bind(h);await h.push(payload({l:'en',t:'a',c:CONV}));assert.equal(h.shown[0].title,'Your invitation was accepted');assert.equal(h.shown[0].body,'You can now chat on Rolff.');
});
test('invitation accepted: only text from the payload name; control characters stripped, 40 characters, never message text, links or read/delivery fields',async()=>{
 const h=harness();await bind(h);await h.push(payload({t:'a',c:CONV,s:['\u202eFar\u200b'+'x'.repeat(60)],body:'MALICIOUS BODY',title:'EVIL',url:'https://evil.invalid',read:true,delivered:true,k:3,n:9}));
 const n=h.shown[0];assert.equal(n.title,('Far'+'x'.repeat(60)).slice(0,40)+' har accepteret din invitation');assert.equal(n.body,'Nu kan I chatte på Rolff.');
 const all=JSON.stringify(n);for(const bad of ['MALICIOUS','EVIL','evil.invalid','read','delivered','Ny besked','nye beskeder'])assert(!all.toLowerCase().includes(bad.toLowerCase()),bad);
 assert.deepEqual(Object.keys(n.data).sort(),['binding','c']);
});
test('invitation accepted: a hostile conversation id is ignored (no id in data, no id in the tag)',async()=>{
 for(const c of ['../../x','https://evil.invalid/','javascript:alert(1)',CONV+'x',5,null]){
  const h=harness();await bind(h);await h.push(payload({t:'a',c,s:['Far']}));assert.equal(h.shown[0].tag,'rolff-accept');assert.deepEqual(Object.keys(h.shown[0].data),['binding']);}
});
test('invitation accepted: a message push still uses the message notice and its own tag; both can be shown together',async()=>{
 const h=harness();await bind(h);await h.push(payload({s:['Far'],k:1,n:1}));await h.push(payload({t:'a',c:CONV,s:['Mor']}));
 assert.equal(h.shown[0].tag,'rolff-ready');assert.equal(h.shown[0].title,'Ny besked fra Far');assert.equal(h.shown[1].title,'Mor har accepteret din invitation');
});
test('tap on an invitation-accepted notice with no open window opens the overview with #open=<conversation> (id built by the worker)',async()=>{
 const h=harness();await bind(h);await h.push(payload({t:'a',c:CONV,s:['Far']}));await h.emit('notificationclick',{notification:h.shown[0]});
 assert.deepEqual(h.opened,['https://synthetic.invalid/app/#open='+CONV]);
});
test('tap with the app already open focuses it and asks it to open that conversation (message carries only the validated uuid)',async()=>{
 const h=harness();await bind(h);const sent=[];let focused=0;h.windows.push({url:'https://synthetic.invalid/app/#x',focus:async()=>{focused++;},postMessage:m=>sent.push(m)});
 await h.push(payload({t:'a',c:CONV,s:['Far']}));await h.emit('notificationclick',{notification:h.shown[0]});
 assert.equal(focused,1);assert.equal(JSON.stringify(sent),JSON.stringify([{type:'ROLFF_OPEN_CONVERSATION',c:CONV}]));assert.deepEqual(h.opened,[]);
 // a message notice only focuses; no navigation message
 sent.length=0;await h.push(payload({s:['Far'],k:1,n:1}));await h.emit('notificationclick',{notification:h.shown[1]});assert.deepEqual(sent,[]);assert.equal(focused,2);
});
test('click: attacker-controlled notification data cannot choose a URL or an id; a stale click after identity change does nothing',async()=>{
 const h=harness();await bind(h);await h.push(payload({t:'a',c:CONV,s:['Far']}));h.shown[0].data.c='../../evil';h.shown[0].data.url='https://evil.invalid/';
 await h.emit('notificationclick',{notification:h.shown[0]});assert.deepEqual(h.opened,['https://synthetic.invalid/app/']);
 const h2=harness();await bind(h2);await h2.push(payload({t:'a',c:CONV,s:['Far']}));const stale=h2.shown[0];await h2.message({type:'IDENTITY',owner:'30000000-0000-4000-8000-000000000003'});await h2.emit('notificationclick',{notification:stale});assert.deepEqual(h2.opened,[]);
});
test('sign-out / identity change closes acceptance notices as well as message notices',async()=>{
 const h=harness();await bind(h);await h.push(payload({t:'a',c:CONV,s:['Far']}));await h.push(payload({s:['Far'],k:1,n:1}));
 await h.message({type:'IDENTITY',owner:'30000000-0000-4000-8000-000000000003'});assert(h.shown.every(n=>n.closed),'all rolff notices closed');
});
test('invitation accepted: expired/foreign-binding pushes are dropped like any other push',async()=>{
 const h=harness();await bind(h);await h.push({...payload({t:'a',c:CONV,s:['Far']}),expires:Date.now()-1});await h.push({...payload({t:'a',c:CONV,s:['Far']}),binding:'40000000-0000-4000-8000-000000000004'});assert.equal(h.shown.length,0);
});

// App icon size: the speech bubble fills most of the icon (like Signal/WhatsApp) and the maskable/monochrome
// artwork still sits inside Android's 80 % safe-zone circle (radius 40 % of the width).
test('app icon: bubble is at least 70 % of the width, and the monochrome/maskable artwork stays inside the safe-zone circle',()=>{
 const extent=(file)=>{const {w,px}=png(file);let x0=w,x1=0,far=0;for(let i=0,p=0;i<px.length;i+=4,p++){if(px[i+3]>128&&px[i]>235&&px[i+1]>235&&px[i+2]>235){const x=p%w,y=(p-x)/w;if(x<x0)x0=x;if(x>x1)x1=x;far=Math.max(far,Math.hypot(x+.5-w/2,y+.5-w/2));}}return {width:(x1-x0+1)/w,far:far/w};};
 assert(extent('rolff-512.png').width>=0.72,'any icon: bubble >= 72 % of icon width');
 assert(extent('rolff-192.png').width>=0.72);
 const m=extent('rolff-monochrome-512.png');assert(m.width>=0.60,'maskable/monochrome bubble >= 60 % of width (was 50 %)');assert(m.far<=0.401,'artwork inside the 80 % safe zone');
});

test('status-bar badge: the bubble fills >= 92 % of the badge canvas (was 85 %), still white on transparent',()=>{
 for(const file of ['rolff-badge-96.png','rolff-badge-72.png']){const {w,h,px}=png(file);let x0=w,x1=0,y0=h,y1=0;for(let i=0,p=0;i<px.length;i+=4,p++){if(px[i+3]>128){const x=p%w,y=(p-x)/w;x0=Math.min(x0,x);x1=Math.max(x1,x);y0=Math.min(y0,y);y1=Math.max(y1,y);}}
  assert((x1-x0+1)/w>=0.92,file+' bubble width');assert(x0>=1&&y0>=1&&x1<=w-2&&y1<=h-2,file+' keeps a small margin');}
});
