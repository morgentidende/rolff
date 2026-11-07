import { useCallback, useEffect, useId, useLayoutEffect, useRef, useState, type SetStateAction } from "react";
import { flushSync } from "react-dom";

type Layer={id:string;kind:"view"|"overlay";dismiss:()=>void};
type Marker={v:1;doc:string;kind:"base"|"guard"};
const KEY="__rolffBack";
/** A single guard represents the visible in-memory window stack. No route,
 * conversation, contact, token or message is written to browser history.
 * Every Back consumes one visible window. At bare Home there is no guard.
 */
class BackNavigation {
  private doc=crypto.randomUUID(); private layers:Layer[]=[]; private attached=false; private pruning:string|null=null; private boundary=false; private retired=new Set<string>(); private revision=0;
  epoch=()=>this.revision;
  private marker():Marker|null {const m=history.state?.[KEY];return m?.v===1&&(m.kind==="base"||m.kind==="guard")?m:null;}
  private state(kind:"base"|"guard") {const old=history.state;return {...(old&&typeof old==="object"?old:{}),[KEY]:{v:1,doc:this.doc,kind}};}
  attach=()=>{
    if(this.attached)return;this.attached=true;
    window.addEventListener("popstate",this.pop);document.addEventListener("keydown",this.key,true);
    // A restored guard might have no predecessor. Normalize ONLY the current
    // entry, without a traversal that could strand pruning or claim a stranger.
    const old=this.marker();if(old)this.retired.add(old.doc);
    history.replaceState(this.state("base"),"");
  };
  private reconcile=()=>{
    if(!this.attached||this.pruning||this.boundary)return;
    const m=this.marker();
    if(this.layers.length){
      if(m?.kind==="guard"&&m.doc===this.doc)return;
      history.replaceState(this.state("base"),"");history.pushState(this.state("guard"),"");
    }else if(m?.kind==="guard"&&m.doc===this.doc) {this.pruning=this.doc;history.back();}
  };
  private pop=()=>{
    const m=this.marker();
    if(this.pruning){
      const expected=this.pruning;this.pruning=null;
      if(m?.kind==="base"&&m.doc===expected)this.reconcile();
      else this.boundary=true; // An unexpected traversal is not ours to rewrite.
      return;
    }
    if(m?.kind==="guard"){
      // Forward is dismissal-only: it must never resurrect private UI.
      if(m.doc===this.doc&&!this.layers.length){this.pruning=this.doc;history.back();}
      else if(m.doc!==this.doc&&this.retired.has(m.doc)){this.pruning=this.doc;history.back();}
      else if(m.doc!==this.doc)this.boundary=true;
      return;
    }
    if(m?.doc!==this.doc){
      // Skip at most one known old baseline after reload, never an unknown entry.
      // No pending flag is needed: Back at the start of history may be a no-op.
      if(m?.kind==="base"&&this.retired.delete(m.doc))history.back();
      else this.boundary=true;
      return;
    }
    const top=this.layers.at(-1);
    if(top)flushSync(()=>top.dismiss());
    this.reconcile();
  };
  private key=(e:KeyboardEvent)=>{
    const top=this.layers.at(-1);
    if(e.key!=="Escape"||!top||top.kind==="view")return;
    e.preventDefault();e.stopImmediatePropagation();flushSync(()=>top.dismiss());
  };
  register=(layer:Layer)=>{
    this.attach();
    // Only a new app-window opening may establish a fresh boundary after an
    // unexpected/external traversal, never a cleanup or popstate callback.
    if(this.boundary){this.boundary=false;this.doc=crypto.randomUUID();history.replaceState(this.state("base"),"");}
    this.revision++;this.layers=this.layers.filter(x=>x.id!==layer.id);
    if(layer.kind==="view")this.layers.unshift(layer);else this.layers.push(layer);
    this.reconcile();
    return()=>{this.revision++;this.layers=this.layers.filter(x=>x.id!==layer.id);queueMicrotask(this.reconcile);};
  };
  reset=()=>{
    const old=this.layers;this.layers=[];
    for(const layer of [...old].reverse())layer.dismiss();
    queueMicrotask(this.reconcile);
  };
}
let navigation:BackNavigation|null=null;
const nav=()=>navigation??(navigation=new BackNavigation());
export function useBackNavigationRoot():void {useEffect(()=>{nav().attach();},[]);}
export function resetBackNavigation():void {navigation?.reset();}
export function useBackLayer(active:boolean,dismiss:()=>void,kind:"view"|"overlay"="overlay"):void {
  const id=useId(), latest=useRef(dismiss);latest.current=dismiss;
  useLayoutEffect(()=>{
    if(!active)return;
    const previous=document.activeElement instanceof HTMLElement?document.activeElement:null;
    const unregister=nav().register({id,kind,dismiss:()=>latest.current()});
    return()=>{unregister();const epoch=nav().epoch();if(kind==="overlay")queueMicrotask(()=>{
      if(nav().epoch()!==epoch)return;
      const modal=document.querySelector<HTMLDialogElement>("dialog[open]");
      if(previous?.isConnected&&!previous.closest("[inert]")&&(!modal||modal.contains(previous)))previous.focus({preventScroll:true});
    });};
  },[active,id,kind]);
}
/** Remember prior subpanels in memory, not URLs; both X and Back unwind once. */
export function usePanelState<T>(initial:T|null=null) {
  const [value,setValue]=useState<T|null>(initial), current=useRef(value), parents=useRef<T[]>([]);
  const set=useCallback((action:SetStateAction<T|null>)=>{
    const before=current.current;const next=typeof action==="function"?(action as (x:T|null)=>T|null)(before):action;
    if(next===before)return;
    if(next===null){current.current=parents.current.pop()??null;setValue(current.current);}
    else {if(before!==null)parents.current.push(before);current.current=next;setValue(next);}
  },[]);
  const reset=useCallback(()=>{parents.current=[];current.current=null;setValue(null);},[]);
  return [value,set,reset] as const;
}
