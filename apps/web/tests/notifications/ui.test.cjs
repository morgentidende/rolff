const test=require('node:test'),assert=require('node:assert/strict'),{JSDOM,VirtualConsole}=require('jsdom'),{bundle}=require('./build-fixture.cjs');
const delay=()=>new Promise(r=>setTimeout(r,25));
async function env(){const errors=[],network=[],vc=new VirtualConsole();vc.on('error',e=>errors.push(String(e)));vc.on('jsdomError',e=>errors.push(e.message));const dom=new JSDOM('<div id="root"></div>',{url:'https://synthetic.invalid/',runScripts:'outside-only',virtualConsole:vc,beforeParse(w){w.structuredClone=structuredClone;w.matchMedia=()=>({matches:false,addEventListener(){},removeEventListener(){}});w.fetch=async()=>{network.push('fetch');throw Error('forbidden');};w.XMLHttpRequest=w.WebSocket=w.EventSource=class{constructor(){network.push('network');throw Error('forbidden');}};}});dom.window.eval(await bundle());for(let i=0;i<40;i++){if(dom.window.document.body.textContent.includes('Vil du have besked')||dom.window.document.querySelector('button[role=switch]'))break;await delay();}return {w:dom.window,d:dom.window.document,async click(text){const b=[...dom.window.document.querySelectorAll('button')].find(b=>b.textContent===text);assert(b,'button '+text);b.click();await delay();},async close(){dom.window.QA.unmount();dom.window.close();assert.deepEqual(network,[]);assert.deepEqual(errors,[]);}};}
test('neutral onboarding offers Ja/Ikke nu, no prompt on mount or decline',async()=>{const e=await env();assert(e.d.body.textContent.includes('Vil du have besked'));assert(!e.w.QA.calls.includes('permission'));await e.click('Ikke nu');assert(!e.d.body.textContent.includes('Vil du have besked'));assert(e.w.QA.calls.includes('decline_my_push'));assert(!e.w.QA.calls.includes('permission'));await e.close();});
test('explicit Ja persists and active settings only after confirmation',async()=>{const e=await env();await e.click('Ja');assert(e.w.QA.calls.includes('permission'));assert(e.w.QA.calls.includes('save_my_push'));assert(!e.d.body.textContent.includes('Vil du have besked'));await e.close();});
test('unsupported and unavailable UI makes no working-enable promise',async()=>{const e=await env();await e.click('unsupported');assert(e.d.body.textContent.includes('hjemmeskærmen'));const sw=e.d.querySelector('button[role=switch]');assert(sw&&sw.disabled,'switch cannot be turned on');assert.equal(sw.getAttribute('aria-checked'),'false');assert(e.d.querySelector('.push-lead').textContent.includes('virker ikke her'));await e.click('unavailable');assert(e.d.body.textContent.includes('ikke tilgængelige endnu'));assert(!e.d.querySelector('button[role=switch]'));assert(!e.w.QA.calls.includes('permission'));await e.close();});
test('denied permission honest, no automatic re-request',async()=>{const e=await env();await e.click('denied');e.d.querySelector('button[role=switch]').click();await delay();assert(e.d.body.textContent.includes('Åbn Indstillinger, og tillad notifikationer til Rolff.'));assert(!e.w.QA.calls.includes('permission'));assert(!e.w.QA.calls.includes('save_my_push'));await e.close();});
test('later settings: one switch turns this device on and off, with no device list',async()=>{const e=await env();await e.click('settings');const sw=()=>e.d.querySelector('button[role=switch]');assert.equal(sw().getAttribute('aria-checked'),'false');sw().click();await delay();assert.equal(sw().getAttribute('aria-checked'),'true');
 assert(!e.d.querySelector('details.push-devices'));
 assert(!e.d.body.textContent.includes('Enhed 1'));assert(!e.d.body.textContent.includes('Enheder'));assert(!e.d.body.textContent.includes('Denne enhed'));assert(!e.d.body.textContent.includes('Slå fra på alle enheder'));
 assert(!e.w.QA.calls.includes('revoke_my_push'));
 sw().click();await delay();assert.equal(sw().getAttribute('aria-checked'),'false');
 assert(e.w.QA.calls.includes('revoke_my_push'),'turning off revokes this device');
 assert(!e.d.querySelector('.confirm-card'),'no turn-off-everywhere confirm');
 await e.close();});
test('self-contained file HTML has inline assets, blocked networking and renders mocked offer without a server',async()=>{
 const fs=require('node:fs/promises'),os=require('node:os'),path=require('node:path'),{pathToFileURL}=require('node:url'),{build}=require('./build-fixture.cjs');
 const dir=await fs.mkdtemp(path.join(os.tmpdir(),'rolff-push-fixture-'));await build(dir);const html=await fs.readFile(path.join(dir,'self-contained.html'),'utf8');const network=[],errors=[],vc=new VirtualConsole();vc.on('jsdomError',e=>errors.push(e.message));vc.on('error',e=>errors.push(String(e)));
 const dom=new JSDOM(html,{url:pathToFileURL(path.join(dir,'self-contained.html')).href,runScripts:'dangerously',virtualConsole:vc,beforeParse(w){w.structuredClone=structuredClone;w.fetch=()=>{network.push('fetch');throw Error('forbidden');};w.XMLHttpRequest=w.WebSocket=w.EventSource=class{constructor(){network.push('network');throw Error('forbidden');}};}});await delay();
 assert(dom.window.document.body.textContent.includes('Vil du have besked'));assert.equal(dom.window.document.querySelectorAll('script[src],link[href]').length,0);assert(html.includes("connect-src 'none'"));assert(html.includes("worker-src 'none'"));assert(!dom.window.QA.calls.includes('permission'));
 dom.window.QA.unmount();dom.window.close();assert.deepEqual(network,[]);assert.deepEqual(errors,[]);await fs.rm(dir,{recursive:true,force:true});
});
test('settings sheet content has no second "Notifikationer" heading (the sheet title is the only one)',async()=>{const e=await env();await e.click('settings');assert(![...e.d.querySelectorAll('h1,h2,h3')].some(h=>/^Notifi(kationer|cations)$/.test(h.textContent.trim())));assert(!e.d.querySelector('details.more'));await e.close();});
test('denied settings show one short line on how to turn notifications back on, without re-prompting',async()=>{const e=await env();e.w.Notification={permission:'denied'};await e.click('denied');assert(!e.w.QA.calls.includes('permission'));assert.equal(e.d.querySelectorAll('.permission-steps li').length,0);assert.equal(e.d.querySelector('.push-lead').textContent,'Åbn Indstillinger, og tillad notifikationer til Rolff.');assert(!e.d.body.textContent.includes('Adgang til notifikationer er slået fra'));await e.close();});

test('sheet shows one Notifikationer toggle and one short line, with no Mere or long copy',async()=>{const e=await env();await e.click('settings');
 const root=e.d.querySelector('.push-settings'),text=root.textContent;
 assert.equal(root.querySelectorAll('button[role=switch]').length,1);
 assert.equal(root.querySelector('.setting-title').textContent,'Notifikationer');
 assert.equal(root.querySelectorAll('p.push-lead').length,1);
 assert.equal(root.querySelector('p.push-lead').textContent,'Du får besked, når der kommer nye beskeder.');
 assert(!e.d.querySelector('details.more'));assert(!text.includes('Tilmeldte enheder'));assert(!text.includes('Forny'));assert(!text.includes('Slå fra på alle'));assert(!text.includes('90 dage'));assert(!text.includes('fornyes'));assert(!text.includes('beskedteksten'));assert(!text.includes('lydløs'));assert(!text.includes('Enheder'));
 await e.close();});
test('after turning on, the sheet stays short: toggle and one line, no devices or turn-off-everywhere',async()=>{const e=await env();await e.click('settings');e.d.querySelector('button[role=switch]').click();await delay();
 const root=e.d.querySelector('.push-settings');
 assert.equal(root.querySelector('button[role=switch]').getAttribute('aria-checked'),'true');
 assert.equal(root.querySelector('p.push-lead').textContent,'Du får besked, når der kommer nye beskeder.');
 assert(!root.querySelector('details.push-devices'));
 const text=root.textContent;
 assert(!text.includes('Enhed 1'));assert(!text.includes('Enheder'));assert(!text.includes('Denne enhed'));assert(!text.includes('Fjern'));assert(!text.includes('Slå fra på alle enheder'));assert(!text.includes('fornyes'));assert(!text.includes('90 dage'));assert(!text.includes('Ny besked fra Far'));assert(!text.includes('Udløber'));assert(!text.includes('Forny'));
 await e.close();});

test('settings switch flips instantly while subscribe is still pending, and ignores a second tap',async()=>{
 const e=await env();await e.click('settings');
 e.w.QA.holdNextSave();
 const sw=()=>e.d.querySelector('button[role=switch]');
 assert.equal(sw().getAttribute('aria-checked'),'false');
 const t0=performance.now();
 sw().click();
 // React 18 flushes the click update on the next microtask in jsdom; that is still the same frame for the user.
 while(sw().getAttribute('aria-checked')!=='true' && performance.now()-t0<30)await Promise.resolve();
 const ms=performance.now()-t0;
 assert.equal(sw().getAttribute('aria-checked'),'true','visual flip is immediate');
 assert.ok(ms<30,'time-to-visual-flip '+ms+'ms');
 console.log('time-to-visual-flip-ms',ms.toFixed(2));
 assert.equal(sw().disabled,false,'pending does not freeze the switch');
 assert.equal(sw().getAttribute('aria-busy'),'true');
 assert(!e.w.QA.calls.includes('save_my_push'));
 sw().click();
 assert.equal(sw().getAttribute('aria-checked'),'true','second tap ignored while pending');
 e.w.QA.releaseHeldSave();
 await delay();
 assert(e.w.QA.calls.includes('save_my_push'));
 assert.equal(sw().getAttribute('aria-checked'),'true');
 assert.notEqual(sw().getAttribute('aria-busy'),'true');
 await e.close();
});

test('failed enable reverts the switch and shows a short message',async()=>{
 const e=await env();await e.click('settings');
 e.w.QA.failNextSave();
 const sw=e.d.querySelector('button[role=switch]');
 const t0=performance.now();
 sw.click();
 while(sw.getAttribute('aria-checked')!=='true' && performance.now()-t0<30)await Promise.resolve();
 assert.equal(sw.getAttribute('aria-checked'),'true');
 await delay();
 assert.equal(sw.getAttribute('aria-checked'),'false');
 assert.match(e.d.querySelector('.err').textContent,/Ændringen kunne ikke bekræftes\. Prøv igen\./);
 await e.close();
});

test('styles hide the Android tap square but keep a keyboard focus-visible ring',async()=>{
 const fs=require('node:fs'),path=require('node:path');
 const css=fs.readFileSync(path.join(__dirname,'../../src/styles.css'),'utf8');
 assert.match(css,/-webkit-tap-highlight-color:\s*transparent/);
 assert.match(css,/button:focus:not\(:focus-visible\)[^}]*outline:\s*none/);
 assert.match(css,/button:focus-visible\{[^}]*outline:\s*2px solid var\(--accent\)/);
});
