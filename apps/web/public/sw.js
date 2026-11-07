/* Push-only worker. No fetch handler, no message caching, no token storage, no payload URLs. */
'use strict';
const uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
let queue=Promise.resolve();
function serial(fn){const task=queue.then(fn);queue=task.catch(()=>{});return task;}
function store(write){return new Promise((resolve,reject)=>{
 const open=indexedDB.open('rolff-push-binding',1);
 open.onupgradeneeded=()=>open.result.createObjectStore('binding');
 open.onerror=()=>reject(Error('storage_failed'));
 open.onsuccess=()=>{const db=open.result,tx=db.transaction('binding',write?'readwrite':'readonly'),s=tx.objectStore('binding');let value;
 if(write){value=write;s.put(write,'current');}else{const r=s.get('current');r.onsuccess=()=>{value=r.result??{owner:null,binding:null,fence:crypto.randomUUID()};};}
 tx.oncomplete=()=>{db.close();resolve(value);};tx.onerror=()=>{db.close();reject(Error('storage_failed'));};
 };
});}
async function closeNotifications(){for(const n of await self.registration.getNotifications({tag:'rolff-ready'}))n.close();}
self.addEventListener('install',event=>event.waitUntil(self.skipWaiting()));
self.addEventListener('activate',event=>event.waitUntil(self.clients.claim()));
self.addEventListener('message',event=>{
 // Only same-origin controlled pages can change the local binding.
 if(!event.source?.url || new URL(event.source.url).origin!==self.location.origin)return;
 event.waitUntil(serial(async()=>{
  try{
   const m=event.data??{};let s=await store();let value;
   if(m.type==='READ'){value=s;}else if(m.type==='IDENTITY' && (m.owner===null || uuid.test(m.owner))){
    if(s.owner!==m.owner){s={owner:m.owner,binding:null,fence:crypto.randomUUID()};await store(s);await closeNotifications();}
    value=s;
   }else if(m.type==='BIND' && m.fence===s.fence && s.owner && uuid.test(m.binding)){
    s.binding=m.binding;await store(s);value=true;
   }else if(m.type==='CLEAR' && m.fence===s.fence){s.binding=null;s.fence=crypto.randomUUID();await store(s);await closeNotifications();value=true;
   }else value=false;
   event.ports?.[0]?.postMessage({ok:true,value});
  }catch{event.ports?.[0]?.postMessage({ok:false});}
 }));
});
self.addEventListener('push',event=>event.waitUntil(serial(async()=>{
 try{
  if(!event.data || event.data.text().length>512)return;
  const p=event.data.json(),s=await store();
  if(p.v!==1 || !uuid.test(p.binding) || s.binding!==p.binding || !s.owner || !Number.isFinite(p.expires) || p.expires<Date.now() || p.expires>Date.now()+31000)return;
  await self.registration.showNotification('ROLFF',{body:'Du har nye beskeder klar.',tag:'rolff-ready',icon:new URL('icons/rolff-192.png',self.registration.scope).href,data:{binding:s.binding}});
 }catch{/* Fail closed without logging payload or capabilities. */}
})));
self.addEventListener('notificationclick',event=>{
 event.notification.close();event.waitUntil(serial(async()=>{
  const s=await store();if(!s.binding || s.binding!==event.notification.data?.binding)return;
  // Fixed same-origin overview only. Never trust any URL carried by a push.
  const overview=new URL('./',self.registration.scope).href;
  const windows=await self.clients.matchAll({type:'window',includeUncontrolled:false});
  const existing=windows.find(w=>w.url===overview);
  if(existing)await existing.focus();else await self.clients.openWindow(overview);
 }));
});
self.addEventListener('pushsubscriptionchange',event=>event.waitUntil(serial(async()=>{
 const s=await store();await store({owner:s.owner,binding:null,fence:crypto.randomUUID()});await closeNotifications();
 for(const client of await self.clients.matchAll({type:'window'}))client.postMessage({type:'ROLFF_PUSH_CHANGED'});
 // Renewal requires an authenticated explicit enable, not an anonymous background token.
})));
