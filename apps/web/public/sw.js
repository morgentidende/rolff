/* Push-only worker. No fetch handler, no message caching, no token storage, no payload URLs.
   The push may carry the recipient's own private nickname(s) for the sender plus counts, never message text.
   An "invitation accepted" push (t:'a') carries only a conversation id and one name; tapping it opens that conversation.
   A retention notice (t:'r') is a bare flag: fixed text, tapping it opens Privacy and deletion. */
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
// Names come from the recipient's own private nicknames only. Re-validated here; anything odd => generic text.
const JUNK=/[\u0000-\u001f\u007f-\u009f\u200b-\u200f\u202a-\u202e\u2066-\u2069\ufeff]/g;
function cleanName(x){return typeof x==='string'?Array.from(x.replace(JUNK,'').trim()).slice(0,40).join('').trim():'';}
function noticeText(p){
 const en=p.l==='en';
 const generic={title:'ROLFF',body:en?'You have new messages ready.':'Du har nye beskeder klar.'};
 const names=Array.isArray(p.s)?p.s.slice(0,2).map(cleanName).filter(Boolean):[];
 const k=p.k;
 if(!names.length || !Number.isInteger(k) || k<names.length || k>999)return generic;
 const n=Number.isInteger(p.n) && p.n>=k && p.n<=99?p.n:k;
 const one=k===1 && n===1;
 let who;
 if(k===1)who=names[0];
 else if(k===2 && names.length===2)who=names[0]+(en?' and ':' og ')+names[1];
 else{const o=k-1;who=names[0]+(en?' and ':' og ')+(en?(o===1?'1 other':o+' others'):(o===1?'1 anden':o+' andre'));}
 return en?{title:(one?'New message from ':'New messages from ')+who,body:one?'Open Rolff to read it.':'Open Rolff to read them.'}
  :{title:(one?'Ny besked fra ':'Nye beskeder fra ')+who,body:one?'Åbn Rolff for at læse den.':'Åbn Rolff for at læse dem.'};
}
// "<name> accepted your invitation". Name = the inviter's own nickname for the person, else their e-mail (server-side);
// no name -> generic text. Never message text, never read/delivery status.
function acceptText(p){
 const en=p.l==='en';
 const name=Array.isArray(p.s)?cleanName(p.s[0]):'';
 if(!name)return en?{title:'Your invitation was accepted',body:'You can now chat on Rolff.'}:{title:'Din invitation er accepteret',body:'Nu kan I chatte på Rolff.'};
 return en?{title:name+' accepted your invitation',body:'You can now chat on Rolff.'}:{title:name+' har accepteret din invitation',body:'Nu kan I chatte på Rolff.'};
}
// "Some of your old messages will be deleted in 3 days" (only for users who chose a shorter retention). Fixed text,
// no names, counts or message content.
function retentionText(p){
 return p.l==='en'?{title:'Rolff: Some of your old messages will be deleted in 3 days',body:'Export the conversation as a PDF or choose a longer time.'}
  :{title:'Rolff: Nogle af dine gamle beskeder slettes om 3 dage',body:'Eksportér samtalen som PDF eller vælg en længere tid.'};
}
async function closeNotifications(){for(const n of await self.registration.getNotifications())if(typeof n.tag==='string' && n.tag.startsWith('rolff-'))n.close();}
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
  // Title = recipient's own nickname for the sender(s); body is fixed. Never message content.
  // No `icon` and no `image`: Android draws those as a large picture on the right, which duplicated the logo.
  // badge = white silhouette on transparent (Android status bar and notification header).
  const badge=new URL('icons/rolff-badge-96.png?v=4',self.registration.scope).href;
  if(p.t==='a'){
   // Invitation accepted: own tag (never replaces or is replaced by the message notice), conversation id only if a valid uuid.
   const c=typeof p.c==='string' && uuid.test(p.c)?p.c.toLowerCase():null;
   const t=acceptText(p);
   await self.registration.showNotification(t.title,{body:t.body,lang:p.l==='en'?'en':'da',tag:'rolff-accept'+(c?'-'+c:''),badge,data:c?{binding:s.binding,c}:{binding:s.binding}});
   return;
  }
  if(p.t==='r'){
   const t=retentionText(p);
   await self.registration.showNotification(t.title,{body:t.body,lang:p.l==='en'?'en':'da',tag:'rolff-retention',badge,data:{binding:s.binding,r:true}});
   return;
  }
  const t=noticeText(p);
  await self.registration.showNotification(t.title,{body:t.body,lang:p.l==='en'?'en':'da',tag:'rolff-ready',badge,data:{binding:s.binding}});
 }catch{/* Fail closed without logging payload or capabilities. */}
})));
self.addEventListener('notificationclick',event=>{
 event.notification.close();event.waitUntil(serial(async()=>{
  const s=await store();if(!s.binding || s.binding!==event.notification.data?.binding)return;
  // Fixed same-origin overview only. Never trust any URL carried by a push. For an acceptance notice the only extra
  // is a validated conversation id, put in the URL fragment by this worker; the app opens it only for a member.
  const overview=new URL('./',self.registration.scope).href;
  const r=event.notification.data?.r===true;
  const c=!r && typeof event.notification.data?.c==='string' && uuid.test(event.notification.data.c)?event.notification.data.c.toLowerCase():null;
  const windows=await self.clients.matchAll({type:'window',includeUncontrolled:false});
  const existing=windows.find(w=>w.url.split('#')[0]===overview);
  if(existing){await existing.focus();if(c)existing.postMessage({type:'ROLFF_OPEN_CONVERSATION',c});if(r)existing.postMessage({type:'ROLFF_OPEN_PRIVACY'});}
  else await self.clients.openWindow(c?overview+'#open='+c:r?overview+'#privacy':overview);
 }));
});
self.addEventListener('pushsubscriptionchange',event=>event.waitUntil(serial(async()=>{
 const s=await store();await store({owner:s.owner,binding:null,fence:crypto.randomUUID()});await closeNotifications();
 for(const client of await self.clients.matchAll({type:'window'}))client.postMessage({type:'ROLFF_PUSH_CHANGED'});
 // Renewal requires an authenticated explicit enable, not an anonymous background token.
})));
