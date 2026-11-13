const {test}=require('node:test'),assert=require('node:assert/strict'),{JSDOM,VirtualConsole}=require('jsdom'),esbuild=require('esbuild'),path=require('node:path');
const delay=ms=>new Promise(r=>setTimeout(r,ms));let bundle;
async function env(){
 bundle??=(await esbuild.build({entryPoints:[path.join(__dirname,'entry.tsx')],bundle:true,write:false,format:'iife',jsx:'automatic',define:{'import.meta.env.VITE_SUPABASE_URL':'"https://synthetic.invalid"','import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY':'"fabricated-key"'},logLevel:'silent'})).outputFiles[0].text;
 const errors=[],vc=new VirtualConsole();vc.on('jsdomError',e=>errors.push(e.message));vc.on('error',e=>errors.push(String(e)));
 const dom=new JSDOM('<div id="root"></div>',{url:'https://synthetic.invalid/fixture',runScripts:'outside-only',pretendToBeVisual:true,virtualConsole:vc,beforeParse(w){w.HTMLDialogElement.prototype.showModal=function(){this.open=true};w.HTMLDialogElement.prototype.close=function(){this.open=false};w.fetch=()=>{throw Error('Network blocked')};}});
 dom.window.eval(bundle);const w=dom.window,d=w.document;
 const deadline=Date.now()+1500;while(!d.querySelector("section li")){if(Date.now()>deadline)throw Error("Synthetic initial list did not load");await delay(5);}
 return {w,d,async close(){w.QA.unmount();await delay(5);dom.window.close();assert.deepEqual(errors,[]);}};
}
const btn=(d,text)=>{const b=[...d.querySelectorAll('button')].find(b=>b.textContent.trim()===text);assert.ok(b,text);return b};
async function click(b){b.click();await delay(20)}
function input(w,id,value){const el=w.document.getElementById(id);Object.getOwnPropertyDescriptor(w.HTMLInputElement.prototype,'value').set.call(el,value);el.dispatchEvent(new w.Event('input',{bubbles:true}));}
const list=d=>[...d.querySelector('section').querySelectorAll('li span')].map(x=>x.textContent);
function pointer(w,el,type,props={}){const e=new w.Event(type,{bubbles:true});Object.assign(e,{isPrimary:true,button:0,clientX:0,clientY:0,...props});el.dispatchEvent(e);}
test('Danish order, true creation timestamps, stable ties, display sort does not save',async()=>{const e=await env();try{assert.deepEqual(list(e.d),['æble','åben aftale','ønske']);const select=e.d.querySelector('select');for(const [value,expected]of [['alphabetical',['æble','ønske','åben aftale']],['newest',['ønske','åben aftale','æble']],['oldest',['æble','åben aftale','ønske']]]){select.value=value;select.dispatchEvent(new e.w.Event('change',{bubbles:true}));await delay(5);assert.deepEqual(list(e.d),expected);}assert.ok(e.w.QA.requests.every(x=>x.method==='GET'||String(x.url).includes('get_my_attachment_blocks')));}finally{await e.close()}});
test('Accessible trash removes just one word; topic list unchanged',async()=>{const e=await env();try{const trash=e.d.querySelector('[aria-label="Fjern æble"]');assert.ok(trash.querySelector('svg'));await click(trash);assert.deepEqual(list(e.d),['åben aftale','ønske']);assert.match(e.d.querySelectorAll('section')[1].textContent,/omtaler mine forældre/);}finally{await e.close()}});
test('Reset confirmation cancel/Escape preserve words and both typed drafts',async()=>{const e=await env();try{input(e.w,'blocked-word','udkast');input(e.w,'blocked-topic','omtaler min cykel');await click(btn(e.d,'Nulstil blokeringsliste'));assert.ok(e.d.querySelector('dialog[open]'));assert.equal(e.w.QA.requests.filter(x=>x.method!=='GET'&&!String(x.url).includes('get_my_attachment_blocks')).length,0);await click(btn(e.d,'Annuller'));await click(btn(e.d,'Nulstil blokeringsliste'));e.d.dispatchEvent(new e.w.KeyboardEvent('keydown',{key:'Escape',bubbles:true}));await delay(10);assert.ok(!e.d.querySelector('dialog'));assert.equal(e.d.getElementById('blocked-word').value,'udkast');assert.equal(e.d.getElementById('blocked-topic').value,'omtaler min cykel');assert.equal(list(e.d).length,3);}finally{await e.close()}});
test('Confirmed reset clears only words and only owner/conversation RPC',async()=>{const e=await env();try{await click(btn(e.d,'Nulstil blokeringsliste'));await click(btn(e.d,'Nulstil'));assert.deepEqual(list(e.d),[]);assert.match(e.d.querySelectorAll('section')[1].textContent,/omtaler mine forældre/);const request=e.w.QA.requests.find(x=>x.url.includes('reset_blocked_words'));assert.deepEqual(JSON.parse(JSON.stringify(request.body)),{conv:'synthetic-conversation'});assert.equal(request.token,'Bearer fabricated-synthetic-owner-a');}finally{await e.close()}});
test('Failed single delete and reset retain existing list and report unconfirmed',async()=>{const e=await env();try{e.w.QA.fail=true;await click(e.d.querySelector('[aria-label="Fjern æble"]'));assert.equal(list(e.d).length,3);assert.match(e.d.querySelector('[role=alert]').textContent,/kunne ikke bekræftes/);await click(btn(e.d,'Nulstil blokeringsliste'));await click(btn(e.d,'Nulstil'));assert.equal(list(e.d).length,3);}finally{await e.close()}});
test('Failed topic add retains draft, successful add loads actual timestamp separately',async()=>{const e=await env();try{input(e.w,'blocked-topic','omtaler min cykel');await delay(5);e.w.QA.fail=true;await click(btn(e.d,'Tilføj emne'));assert.equal(e.d.getElementById('blocked-topic').value,'omtaler min cykel');e.w.QA.fail=false;await click(btn(e.d,'Tilføj emne'));assert.equal(e.d.getElementById('blocked-topic').value,'');assert.match(e.d.querySelectorAll('section')[1].textContent,/omtaler min cykel/);assert.equal(list(e.d).length,3);}finally{await e.close()}});
test('Info tap/keyboard opens, Back closes only modal and draft/history remain private',async()=>{const e=await env();try{input(e.w,'blocked-topic','privat kladde');await click(e.d.querySelector('[aria-label="Om blokerede emner"]'));assert.match(e.d.querySelector('dialog').textContent,/AI kan tage fejl/);assert.ok(!JSON.stringify(e.w.history.state).includes('privat'));e.w.history.back();await delay(35);assert.ok(!e.d.querySelector('dialog'));assert.equal(e.d.getElementById('blocked-topic').value,'privat kladde');const info=e.d.querySelector('[aria-label="Om blokerede ord"]');info.dispatchEvent(new e.w.KeyboardEvent('keydown',{key:'Enter',bubbles:true}));await click(info);assert.match(e.d.querySelector('dialog').textContent,/Ord, udtryk/);}finally{await e.close()}});
test('Longpress opens once and suppresses subsequent synthetic click',async()=>{const e=await env();try{const b=e.d.querySelector('[aria-label="Om blokerede ord"]');pointer(e.w,b,'pointerdown');await delay(520);assert.equal(e.d.querySelectorAll('dialog').length,1);pointer(e.w,b,'pointerup');await click(btn(e.d,'Luk'));await click(b);assert.equal(e.d.querySelectorAll('dialog').length,0);}finally{await e.close()}});
for(const kind of ['move','scroll','pointercancel'])test(`Longpress ${kind} cancels and suppresses accidental click`,async()=>{const e=await env();try{const b=e.d.querySelector('[aria-label="Om blokerede ord"]');pointer(e.w,b,'pointerdown');if(kind==='move')pointer(e.w,b,'pointermove',{clientX:20});else if(kind==='scroll')e.d.dispatchEvent(new e.w.Event('scroll'));else pointer(e.w,b,'pointercancel');await delay(520);await click(b);assert.equal(e.d.querySelectorAll('dialog').length,0);}finally{await e.close()}});
test('Save in flight remains pinned to account A after switch B, stale DOM/draft not applied',async()=>{const e=await env();try{e.w.QA.pause=true;await click(e.d.querySelector('[aria-label="Fjern æble"]'));assert.equal(e.w.QA.pending.length,1);e.w.QA.changeAccount('synthetic-owner-b');await delay(10);const old=e.w.QA.requests.find(x=>x.url.includes('remove_blocked_word'));assert.equal(old.token,'Bearer fabricated-synthetic-owner-a');assert.ok(e.w.QA.requests.filter(x=>x.url.includes('owner-b')).every(x=>x.token==='Bearer fabricated-synthetic-owner-b'));e.w.QA.pending.splice(0).forEach(f=>f());await delay(20);assert.equal(e.d.getElementById('blocked-topic').value,'');assert.ok(!e.d.querySelector('[role=alert]'));}finally{await e.close()}});

test('Failed word add retains draft and acknowledgment, successful retry preserves topic list',async()=>{const e=await env();try{input(e.w,'blocked-word','min sætning');await click(e.d.querySelector('.blocking-ack input'));e.w.QA.fail=true;await click(btn(e.d,'Tilføj'));assert.equal(e.d.getElementById('blocked-word').value,'min sætning');assert.equal(e.d.querySelector('.blocking-ack input').checked,true);e.w.QA.fail=false;await click(btn(e.d,'Tilføj'));assert.ok(list(e.d).includes('min sætning'));assert.equal(e.d.getElementById('blocked-word').value,'');assert.match(e.d.querySelectorAll('section')[1].textContent,/omtaler mine forældre/);}finally{await e.close()}});
test('New-account failed load shows accurate error and never exposes stale old list or enables resets',async()=>{const e=await env();try{e.w.QA.fail=true;e.w.QA.changeAccount('synthetic-owner-b');await delay(20);assert.match(e.d.querySelector('[role=alert]').textContent,/kunne ikke hentes/);assert.ok(!e.d.querySelector('li'));assert.ok(![...e.d.querySelectorAll('button')].some(b=>b.textContent.trim()==='Nulstil blokeringsliste'),'no reset offered without a confirmed list');}finally{await e.close()}});
test('Space is an accessible info activation and Escape closes without clearing draft',async()=>{const e=await env();try{input(e.w,'blocked-word','min kladde');const info=e.d.querySelector('[aria-label="Om blokerede emner"]');info.dispatchEvent(new e.w.KeyboardEvent('keydown',{key:' ',bubbles:true}));await click(info);assert.ok(e.d.querySelector('dialog'));e.d.dispatchEvent(new e.w.KeyboardEvent('keydown',{key:'Escape',bubbles:true}));await delay(10);assert.ok(!e.d.querySelector('dialog'));assert.equal(e.d.getElementById('blocked-word').value,'min kladde');}finally{await e.close()}});

test('Topic trash uses scoped RPC, preserves words and reports failure without losing entry',async()=>{const e=await env();try{e.w.QA.fail=true;await click(e.d.querySelector('[aria-label="Fjern omtaler mine forældre"]'));assert.ok(e.d.querySelector('[aria-label="Fjern omtaler mine forældre"]'));e.w.QA.fail=false;await click(e.d.querySelector('[aria-label="Fjern omtaler mine forældre"]'));assert.ok(!e.d.querySelector('[aria-label="Fjern omtaler mine forældre"]'));assert.equal(list(e.d).length,3);const request=e.w.QA.requests.find(x=>x.url.includes('remove_blocked_topic'));assert.equal(request.method,'POST');assert.deepEqual(JSON.parse(JSON.stringify(request.body)),{conv:'synthetic-conversation',p_id:'4'});assert.equal(request.token,'Bearer fabricated-synthetic-owner-a');}finally{await e.close()}});

test('Tilføj without the "Jeg forstår" tick explains why, focuses the checkbox and clears once ticked',async()=>{const e=await env();try{
 input(e.w,'blocked-word','biler');const add=btn(e.d,'Tilføj');assert.equal(add.disabled,false,'button stays tappable');assert.equal(add.getAttribute('aria-disabled'),'true');
 await click(add);assert.equal(e.w.QA.requests.filter(x=>x.method!=='GET'&&!String(x.url).includes('get_my_attachment_blocks')).length,0,'nothing sent');
 const hint=e.d.getElementById('blocked-ack-hint');assert.ok(hint);assert.equal(hint.getAttribute('role'),'alert');assert.equal(hint.textContent,'Sæt flueben i ”Jeg forstår …” for at tilføje.');
 const box=e.d.querySelector('.blocking-ack input');assert.equal(e.d.activeElement,box,'focus moves to the checkbox');assert.equal(box.getAttribute('aria-describedby'),'blocked-ack-hint');assert.ok(box.closest('label').classList.contains('needs-attention'));
 await click(box);assert.ok(!e.d.getElementById('blocked-ack-hint'),'message cleared when ticked');assert.ok(!box.hasAttribute('aria-describedby'));
 assert.equal(e.d.getElementById('blocked-word').value,'biler','typing kept');
}finally{await e.close()}});
test('Enter adds, input clears and keeps focus; too-short word and topic are explained',async()=>{const e=await env();try{
 input(e.w,'blocked-word','x');e.d.getElementById('blocked-word').form.requestSubmit();await delay(20);assert.equal(e.d.getElementById('blocked-word-hint').textContent,'Skriv mindst 2 tegn.');
 input(e.w,'blocked-word','biler');assert.ok(!e.d.getElementById('blocked-word-hint'));await click(e.d.querySelector('.blocking-ack input'));
 e.d.getElementById('blocked-word').form.requestSubmit();await delay(40);assert.ok(list(e.d).includes('biler'));assert.equal(e.d.getElementById('blocked-word').value,'');assert.equal(e.d.activeElement,e.d.getElementById('blocked-word'));
 await click(btn(e.d,'Tilføj emne'));assert.match(e.d.getElementById('blocked-topic-hint').textContent,/mindst 2 tegn/);assert.equal(e.d.activeElement,e.d.getElementById('blocked-topic'));
}finally{await e.close()}});
test('Calm layout: sort only with 2+ words, small labelled remove buttons, reset is a quiet action at the bottom',async()=>{const e=await env();try{
 assert.ok(e.d.querySelector('.blocking-sort select'),'sort shown for 3 words');assert.equal(e.d.querySelectorAll('.blocking-card').length,3);assert.ok(e.d.querySelector('#blocked-attachments-title'));
 const trash=e.d.querySelector('[aria-label="Fjern æble"]');assert.ok(trash.classList.contains('blocking-trash'));
 const reset=btn(e.d,'Nulstil blokeringsliste');assert.ok(reset.classList.contains('text-danger'));assert.ok(reset.closest('.blocking-foot'));
 assert.ok(e.d.querySelector('.blocking-add').compareDocumentPosition(reset)&4,'reset sits below the add form');
 await click(e.d.querySelector('[aria-label="Fjern æble"]'));await click(e.d.querySelector('[aria-label="Fjern ønske"]'));assert.ok(!e.d.querySelector('.blocking-sort'),'no sort for a single word');
 assert.ok(e.d.getElementById('blocked-word').getAttribute('autocomplete')==='off');
}finally{await e.close()}});

test('Attachment toggles default off, only your settings, and persist independently of words',async()=>{
 const e=await env();try{
  const card=e.d.querySelector('#blocked-attachments-title').closest('section');
  assert.equal(e.d.getElementById('blocked-attachments-title').textContent,'Vedhæftninger');
  assert.match(card.textContent,/Kun du ser indstillingen/);
  const switches=[...card.querySelectorAll('button[role=switch]')];
  assert.equal(switches.length,2);
  assert.equal(switches[0].getAttribute('aria-checked'),'false');
  assert.equal(switches[1].getAttribute('aria-checked'),'false');
  assert.equal(e.d.getElementById('block-photos-label').textContent,'Blokér fotos');
  assert.equal(e.d.getElementById('block-files-label').textContent,'Blokér filer (PDF)');
  await click(switches[0]);
  assert.equal(switches[0].getAttribute('aria-checked'),'true');
  assert.equal(switches[1].getAttribute('aria-checked'),'false');
  const request=e.w.QA.requests.find(x=>x.url.includes('set_my_attachment_blocks'));
  assert.deepEqual(JSON.parse(JSON.stringify(request.body)),{conv:'synthetic-conversation',p_block_photos:true,p_block_files:false});
  assert.equal(request.token,'Bearer fabricated-synthetic-owner-a');
  assert.equal(list(e.d).length,3);
 }finally{await e.close()}
});

test('Failed attachment toggle stays at the last confirmed value',async()=>{
 const e=await env();try{
  const photo=e.d.querySelector('#block-photos-label').closest('.setting-row').querySelector('button[role=switch]');
  e.w.QA.fail=true;await click(photo);
  assert.equal(photo.getAttribute('aria-checked'),'false');
  assert.match(e.d.querySelector('[role=alert]').textContent,/kunne ikke bekræftes/);
  e.w.QA.fail=false;await click(photo);
  assert.equal(photo.getAttribute('aria-checked'),'true');
 }finally{await e.close()}
});

test('Attachment info opens in Danish and English close label path stays on the lists',async()=>{
 const e=await env();try{
  await click(e.d.querySelector('[aria-label="Om blokerede vedhæftninger"]'));
  const dialog=e.d.querySelector('dialog');
  assert.match(dialog.textContent,/kun du ser den/i);
  assert.match(dialog.textContent,/ikke om beskeder er læst eller modtaget/);
  assert.ok(!/Luna|han |hun |he |she /i.test(dialog.textContent));
  await click(btn(e.d,'Luk'));
  const file=e.d.querySelector('#block-files-label').closest('.setting-row').querySelector('button[role=switch]');
  await click(file);
  assert.equal(file.getAttribute('aria-checked'),'true');
  await click(btn(e.d,'Nulstil blokeringsliste'));
  await click(btn(e.d,'Nulstil'));
  assert.equal(list(e.d).length,0);
  assert.equal(file.getAttribute('aria-checked'),'true');
 }finally{await e.close()}
});
