// Synthetic UI check: camera/photo permissions are asked only after a tap, with an
// in-app explanation first, and a "turned off" help screen instead of nagging.
const {test}=require('node:test'),assert=require('node:assert/strict'),{JSDOM,VirtualConsole}=require('jsdom'),esbuild=require('esbuild'),path=require('node:path');
const delay=ms=>new Promise(r=>setTimeout(r,ms));let bundle;
async function env({camera='prompt',lang='da',explained=false}={}){
 bundle??=(await esbuild.build({entryPoints:[path.join(__dirname,'entry.tsx')],bundle:true,write:false,format:'iife',jsx:'automatic',logLevel:'silent'})).outputFiles[0].text;
 const errors=[],vc=new VirtualConsole();vc.on('jsdomError',e=>errors.push(e.message));
 const dom=new JSDOM('<div id="root"></div>',{url:'https://synthetic.invalid/',runScripts:'outside-only',pretendToBeVisual:true,virtualConsole:vc,beforeParse(w){
  w.HTMLDialogElement.prototype.showModal=function(){this.open=true};w.HTMLDialogElement.prototype.close=function(){this.open=false};
  w.fetch=()=>{throw Error('Network blocked')};
  Object.defineProperty(w.navigator,'permissions',{value:{query:async()=>({state:camera})}});
  if(explained)w.localStorage.setItem('rolff:perm:camera','explained');
 }});
 dom.window.eval(`window.__lang=${JSON.stringify(lang)}`);dom.window.eval(bundle);
 const w=dom.window,d=w.document;await delay(30);
 return {w,d,async close(){w.QA.unmount();await delay(5);dom.window.close();assert.deepEqual(errors,[]);}};
}
const btn=(d,text)=>{const b=[...d.querySelectorAll('button')].find(b=>b.textContent.trim()===text||b.getAttribute('aria-label')===text);assert.ok(b,text);return b};
const click=async b=>{b.click();await delay(20)};
const clicks=e=>[...e.w.QA.clicks];
const openDialog=d=>[...d.querySelectorAll('dialog')].find(x=>x.open);
test('Paperclip on the web opens the picker straight away (no permission needed)',async()=>{const e=await env();try{await click(btn(e.d,'Vedhæft fil'));assert.deepEqual(clicks(e),['file']);assert.ok(!openDialog(e.d));}finally{await e.close()}});
test('Camera: explanation first, nothing opens until Fortsæt; Ikke nu opens nothing',async()=>{const e=await env();try{
 await click(btn(e.d,'Tag billede'));const dlg=openDialog(e.d);assert.ok(dlg);assert.match(dlg.textContent,/Rolff vil gerne bruge kameraet/);assert.deepEqual(clicks(e),[]);
 await click(btn(e.d,'Ikke nu'));assert.ok(!openDialog(e.d));assert.deepEqual(clicks(e),[]);
 await click(btn(e.d,'Tag billede'));await click(btn(e.d,'Fortsæt'));assert.deepEqual(clicks(e),['camera']);
 await click(btn(e.d,'Tag billede'));assert.deepEqual(clicks(e),['camera','camera'],'explained once per device');
}finally{await e.close()}});
test('Camera blocked: shows how to turn it on and offers the photo picker, never re-prompts',async()=>{const e=await env({camera:'denied',explained:true});try{
 await click(btn(e.d,'Tag billede'));const dlg=openDialog(e.d);assert.match(dlg.textContent,/Adgang til kameraet er slået fra/);assert.ok(dlg.querySelectorAll('ol li').length>=2);assert.deepEqual(clicks(e),[]);
 await click(btn(e.d,'Vælg billede i stedet'));assert.deepEqual(clicks(e),['file']);
}finally{await e.close()}});
test('English texts',async()=>{const e=await env({lang:'en'});try{
 await click(btn(e.d,'Take photo'));assert.match(openDialog(e.d).textContent,/Rolff would like to use the camera/);await click(btn(e.d,'Continue'));assert.deepEqual(clicks(e),['camera']);
}finally{await e.close()}});
test('Android/browser Back closes the explanation and stays in the app',async()=>{const e=await env();try{
 await click(btn(e.d,'Tag billede'));assert.ok(openDialog(e.d));e.w.history.back();await delay(40);assert.ok(!openDialog(e.d));assert.deepEqual(clicks(e),[]);assert.equal(e.w.location.href,'https://synthetic.invalid/');
}finally{await e.close()}});
