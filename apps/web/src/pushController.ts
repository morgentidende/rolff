export type PushOwner={id:string;token:string};
export type PushState={available:boolean;public_key:string|null;offered:boolean;enabled:boolean;devices:{id:string;created_at:string;expires_at:string}[]};
export type Binding={owner:string|null;fence:string;binding:string|null};
export type PushPorts={
 supported:()=>boolean;online:()=>boolean;permission:()=>NotificationPermission;
 requestPermission:()=>Promise<NotificationPermission>;
 identity:(owner:string|null)=>Promise<Binding>;
 current:()=>Promise<Binding>;
 bind:(fence:string,binding:string)=>Promise<boolean>;
 clear:(fence:string)=>Promise<void>;
 subscription:(key:string,replace:boolean,binding:Binding)=>Promise<{endpoint:string;keys:{p256dh:string;auth:string}}>;
 rpc:(owner:PushOwner,name:string,args?:Record<string,unknown>)=>Promise<any>;
};
export class PushController {
 private owner:PushOwner|null=null;private initialized=false;private epoch=0;private identityTask:Promise<Binding>|null=null;
 private busy=false;
 constructor(private ports:PushPorts){}
 setOwner(next:PushOwner|null) {
   if(this.initialized && this.owner?.id===next?.id){this.owner=next;return;}
   this.initialized=true;const before=this.owner, previous=this.identityTask;this.owner=next;this.epoch++;
   // identity() is serialized in the worker, so cross-tab clears invalidate old fences too.
   this.identityTask=this.ports.identity(next?.id??null);
   void this.identityTask.catch(()=>{});
   if(before && previous)void previous.then(b=>b.binding && this.ports.rpc(before,"revoke_my_push",{p_id:b.binding})).catch(()=>{});
 }
 private snapshot(){if(!this.owner)throw Error("auth_changed");return {owner:{...this.owner},epoch:this.epoch};}
 private check(s:{owner:PushOwner;epoch:number}){if(s.epoch!==this.epoch || s.owner.id!==this.owner?.id)throw Error("auth_changed");}
 async state():Promise<{state:PushState;active:boolean}> {
   const s=this.snapshot();const state:PushState=await this.ports.rpc(s.owner,"my_push_state");this.check(s);
   await this.identityTask;const b=await this.ports.current();this.check(s);
   return {state,active:!!(state.available && state.enabled && this.ports.permission()==="granted" && b?.owner===s.owner.id && b?.binding && state.devices.some(d=>d.id===b.binding && Date.parse(d.expires_at)>Date.now()))};
 }
 async decline(){const s=this.snapshot();await this.ports.rpc(s.owner,"decline_my_push");this.check(s);}
 /** Called only by the explicit Ja / Enable click. Permission request occurs before any await. */
 async enable(state:PushState):Promise<void> {
   if(this.busy)throw Error("busy");
   const s=this.snapshot();
   if(!state.available || !state.public_key)throw Error("unavailable");
   if(!this.ports.supported())throw Error("unsupported");
   if(!this.ports.online())throw Error("offline");
   if(this.ports.permission()==="denied")throw Error("denied");
   this.busy=true;let persisted:string|null=null;let b:Binding|null=null;
   try {
     const permission=await (this.ports.permission()==="granted"?Promise.resolve("granted"):this.ports.requestPermission());this.check(s);
     if(permission!=="granted"){await this.decline();throw Error(permission==="denied"?"denied":"not_granted");}
     await this.identityTask;b=await this.ports.current();this.check(s);if(!b || b.owner!==s.owner.id)throw Error("auth_changed");
     const sub=await this.ports.subscription(state.public_key,!b.binding,b);this.check(s);
     persisted=await this.ports.rpc(s.owner,"save_my_push",{p_endpoint:sub.endpoint,p_p256dh:sub.keys.p256dh,p_auth:sub.keys.auth,p_previous:b.binding});this.check(s);
     if(typeof persisted!=="string" || !await this.ports.bind(b.fence,persisted))throw Error("auth_changed");this.check(s);
     this.identityTask=Promise.resolve({...b,binding:persisted});
   } catch(e) {
     if(persisted)void this.ports.rpc(s.owner,"revoke_my_push",{p_id:persisted}).catch(()=>{});
     if(b)void this.ports.clear(b.fence).catch(()=>{});
     throw e;
   } finally {this.busy=false;}
 }
 async disable(id:string|null=null,all=false) {
   const s=this.snapshot();await this.identityTask;const b=await this.ports.current();this.check(s);
   // Local clear first: works offline, closes stale generic notifications.
   if(b && b.owner===s.owner.id && (all || !id || id===b.binding)){await this.ports.clear(b.fence);this.identityTask=this.ports.current();}
   await this.ports.rpc(s.owner,"revoke_my_push",{p_id:id??b?.binding??null,p_all:all});this.check(s);
 }
}
