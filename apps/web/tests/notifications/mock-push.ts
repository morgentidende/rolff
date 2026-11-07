import { PushController, type Binding } from '../../src/pushController';
export const pushBuildEnabled=true;
export let supportedPush=()=>true;
let local:Binding={owner:null,binding:null,fence:'fixture'},permission:NotificationPermission='default';
let state={available:true,public_key:'B'+'A'.repeat(86),offered:false,enabled:false,devices:[] as {id:string;created_at:string;expires_at:string}[]};
const binding='20000000-0000-4000-8000-000000000002',owner='10000000-0000-4000-8000-000000000001';
export const calls:string[]=[];
export const pushController=new PushController({supported:()=>supportedPush(),online:()=>true,permission:()=>permission,requestPermission:async()=>{calls.push('permission');permission='granted';return permission;},identity:async uid=>{local={owner:uid,binding:null,fence:'fixture'};return {...local};},current:async()=>({...local}),bind:async(fence,id)=>{if(local.fence!==fence)return false;local.binding=id;return true;},clear:async()=>{local.binding=null;},subscription:async()=>({endpoint:'https://fcm.googleapis.com/fcm/send/OnlyFabricated',keys:{p256dh:'B'+'A'.repeat(86),auth:'A'.repeat(22)}}),rpc:async(o,n,args)=>{calls.push(n);if(n==='my_push_state')return structuredClone(state);if(n==='decline_my_push'){state.offered=true;return;}if(n==='save_my_push'){state.offered=true;state.enabled=true;state.devices=[{id:binding,created_at:new Date().toISOString(),expires_at:new Date(Date.now()+86400000).toISOString()}];return binding;}if(n==='revoke_my_push'){state.enabled=false;state.devices=[];return;}}});
export function reset(mode:string){calls.length=0;permission=mode==='denied'?'denied':'default';supportedPush=()=>mode!=='unsupported';state={available:mode!=='unavailable',public_key:'B'+'A'.repeat(86),offered:false,enabled:false,devices:[]};pushController.setOwner(null);pushController.setOwner({id:owner,token:'synthetic-only-no-jwt'});}
export function setPushOwner(){}
