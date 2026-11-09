const { test } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const esbuild = require('esbuild');
const { env, delay, button, label, click, back, assertPrivateHistory } = require('./support.cjs');

// Pure placement maths (no DOM): below, side alignment, flip, clamp, keyboard.
let pure;
async function placement() {
    if (pure) return pure;
    const out = await esbuild.build({ entryPoints: [path.resolve(__dirname, '../../src/anchoredPosition.ts')], bundle: true, write: false, format: 'cjs', platform: 'node', external: ['react'], logLevel: 'silent' });
    const m = { exports: {} };
    new Function('module', 'exports', 'require', out.outputFiles[0].text)(m, m.exports, require);
    return pure = m.exports;
}
const phone = { top: 0, left: 0, width: 390, height: 844 };
test('anchored placement: below, aligned to bubble side', async () => {
    const { computeAnchoredPosition: c } = await placement();
    const a = { top: 300, bottom: 360, left: 150, right: 378 };
    assert.deepEqual(c(a, { width: 200, height: 170 }, phone, { align: 'end' }), { top: 368, left: 178, maxHeight: 464, maxWidth: 366, placement: 'below' });
    assert.equal(c(a, { width: 200, height: 170 }, phone, { align: 'start' }).left, 150);
});
test('anchored placement: flips above near the bottom', async () => {
    const { computeAnchoredPosition: c } = await placement();
    const p = c({ top: 700, bottom: 760, left: 150, right: 378 }, { width: 200, height: 170 }, phone, { align: 'end' });
    assert.equal(p.placement, 'above');
    assert.equal(p.top, 700 - 8 - 170);
    assert.ok(p.top + 170 <= 700 - 8, 'panel ends above the bubble');
});
test('anchored placement: clamps inside the viewport with safe margins', async () => {
    const { computeAnchoredPosition: c } = await placement();
    assert.equal(c({ top: 100, bottom: 140, left: -80, right: 60 }, { width: 200, height: 100 }, phone, { align: 'end' }).left, 12);
    assert.equal(c({ top: 100, bottom: 140, left: 330, right: 520 }, { width: 200, height: 100 }, phone, { align: 'start' }).left, 390 - 12 - 200);
    const wide = c({ top: 100, bottom: 140, left: 0, right: 390 }, { width: 900, height: 100 }, phone, { align: 'start' });
    assert.equal(wide.left, 12); assert.equal(wide.maxWidth, 366);
    // No room on either side: larger side wins, panel scrolls inside, stays on screen.
    const tall = c({ top: 200, bottom: 700, left: 100, right: 300 }, { width: 200, height: 600 }, phone, { align: 'start' });
    assert.equal(tall.placement, 'above');
    assert.ok(tall.top >= 12 && tall.top + Math.min(600, tall.maxHeight) <= 844 - 12);
    assert.equal(tall.maxHeight, 200 - 8 - 12);
    // Anchor scrolled off-screen: still fully visible.
    const off = c({ top: 900, bottom: 950, left: 100, right: 300 }, { width: 200, height: 170 }, phone, { align: 'start' });
    assert.ok(off.top >= 12 && off.top + 170 <= 832);
});
test('anchored placement: keyboard (reduced visualViewport) keeps card visible', async () => {
    const { computeAnchoredPosition: c } = await placement();
    const icon = { top: 6, bottom: 50, left: 290, right: 334 };
    const full = c(icon, { width: 360, height: 420 }, phone, { align: 'end', flip: false, gap: 6, minVisible: 120 });
    assert.deepEqual([full.top, full.left, full.maxHeight, full.placement], [56, 12, 776, 'below']);
    const kb = c(icon, { width: 360, height: 420 }, { top: 0, left: 0, width: 390, height: 420 }, { align: 'end', flip: false, gap: 6, minVisible: 120 });
    assert.equal(kb.top, 56); assert.equal(kb.maxHeight, 420 - 12 - 56);
    const panned = c(icon, { width: 360, height: 420 }, { top: 100, left: 0, width: 390, height: 420 }, { align: 'end', flip: false, gap: 6, minVisible: 120 });
    assert.equal(panned.top, 112); assert.equal(panned.maxHeight, 520 - 12 - 112);
});

// Actual App with synthetic geometry (jsdom has no layout).
function geometry(w) {
    const g = { msg: { top: 300, bottom: 360, left: 150, right: 378 }, icon: { top: 6, bottom: 50, left: 290, right: 334 } };
    const rect = r => ({ ...r, x: r.left, y: r.top, width: r.right - r.left, height: r.bottom - r.top, toJSON() { } });
    const orig = w.Element.prototype.getBoundingClientRect;
    w.Element.prototype.getBoundingClientRect = function () {
        if (this.classList.contains('msg') && !this.closest('.message-lifted')) return rect(g.msg);
        if (this.getAttribute('aria-label') === 'Tilføj person') return rect(g.icon);
        return orig.call(this);
    };
    const size = (el, panel, card) => el.classList?.contains('message-panel') ? panel : el.classList?.contains('anchored-card') ? card : 0;
    Object.defineProperty(w.HTMLElement.prototype, 'offsetWidth', { configurable: true, get() { return size(this, 200, 360); } });
    Object.defineProperty(w.HTMLElement.prototype, 'scrollHeight', { configurable: true, get() { return size(this, this.classList.contains('message-info') ? 260 : 170, 420); } });
    const vv = new w.EventTarget();
    Object.assign(vv, { width: 390, height: 844, offsetTop: 0, offsetLeft: 0 });
    Object.defineProperty(w, 'visualViewport', { configurable: true, value: vv });
    let copied = null;
    Object.defineProperty(w.navigator, 'clipboard', { configurable: true, value: { writeText: async t => { copied = t; } } });
    return { g, vv, copied: () => copied };
}
const px = (el, k) => parseFloat(el.style[k]);
async function openChatWithDraft(w, d) {
    await click(d.querySelector('.convbtn'));
    const input = d.querySelector('textarea');
    Object.getOwnPropertyDescriptor(w.HTMLTextAreaElement.prototype, 'value').set.call(input, 'En syntetisk kladde');
    input.dispatchEvent(new w.Event('input', { bubbles: true }));
    await delay(30);
}
async function press(w, d) {
    d.querySelector('.msg').dispatchEvent(new w.KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    await delay(30);
    return d.querySelector('.message-panel');
}

for (const strict of [false, true])
    test(`message menu is anchored under the bubble, flips, clamps and closes (StrictMode=${strict})`, { timeout: 10000 }, async () => {
        const fixture = await env(strict);
        const { w, d } = fixture;
        try {
            const geo = geometry(w);
            await openChatWithDraft(w, d);
            let p = await press(w, d);
            assert.equal(p.getAttribute('role'), 'menu');
            assert.deepEqual([...p.querySelectorAll('[role=menuitem]')].map(b => b.textContent.trim()), ['Besvar', 'Kopiér', 'Information']);
            assert.equal(p.querySelectorAll('[role=menuitem] svg').length, 3);
            assert.equal(p.dataset.placement, 'below');
            assert.equal(px(p, 'top'), 368);
            assert.equal(px(p, 'left'), 378 - 200, 'own message: right-aligned to bubble');
            assert.equal(d.activeElement, p.querySelector('[role=menuitem]'), 'focus moves into menu');
            d.activeElement.dispatchEvent(new w.KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true }));
            assert.equal(d.activeElement.textContent.trim(), 'Kopiér');
            const lifted = d.querySelector('.message-lifted');
            assert.equal(lifted.getAttribute('aria-hidden'), 'true');
            assert.ok(lifted.querySelector('.msg.mine'), 'pressed bubble is drawn above the dim');
            assert.equal(lifted.style.top, '300px');
            assert.equal(lifted.querySelectorAll('[tabindex],[aria-label]').length, 0, 'copy is not interactive');
            // Outside tap closes.
            d.querySelector('.message-overlay').dispatchEvent(new w.Event('pointerdown', { bubbles: true }));
            await delay(30);
            assert.ok(!d.querySelector('.message-panel'));
            assert.equal(d.querySelector('textarea').value, 'En syntetisk kladde');
            // Near the bottom: flip above.
            geo.g.msg = { top: 700, bottom: 760, left: 150, right: 378 };
            p = await press(w, d);
            assert.equal(p.dataset.placement, 'above');
            assert.equal(px(p, 'top'), 700 - 8 - 170);
            // Keyboard shrinks the visible viewport: re-placed and clamped.
            geo.vv.height = 420; geo.vv.dispatchEvent(new w.Event('resize'));
            await delay(20);
            assert.ok(px(p, 'top') >= 12 && px(p, 'top') + Math.min(170, px(p, 'maxHeight')) <= 420 - 12);
            geo.vv.height = 844; geo.vv.dispatchEvent(new w.Event('resize'));
            // Escape closes.
            d.dispatchEvent(new w.KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }));
            await delay(30);
            assert.ok(!d.querySelector('.message-panel'));
            // Off-screen-left bubble is clamped to the safe margin.
            geo.g.msg = { top: 300, bottom: 360, left: -80, right: 60 };
            p = await press(w, d);
            assert.equal(px(p, 'left'), 12);
            // Phone Back closes the menu only; Chat and draft stay.
            await back(w);
            assert.ok(!d.querySelector('.message-panel'));
            assert.ok(d.querySelector('.topbar.chat'));
            assert.equal(d.querySelector('textarea').value, 'En syntetisk kladde');
            assertPrivateHistory(w);
            geo.g.msg = { top: 300, bottom: 360, left: 150, right: 378 };
            // Actions still work: Kopiér, Information, Besvar.
            await press(w, d);
            await click(button(d, 'Kopiér'));
            await delay(20);
            assert.equal(geo.copied(), 'Kun en opdigtet testbesked.');
            assert.ok(!d.querySelector('.message-panel'));
            // Copy feedback is a single floating toast, never inline in the list.
            assert.ok(!d.querySelector('.message-feedback'));
            let region = d.querySelector('.toast-region');
            assert.equal(region.getAttribute('aria-live'), 'polite');
            assert.equal(region.getAttribute('role'), 'status');
            assert.ok(!d.querySelector('.msgs').contains(region), 'toast is outside the message list');
            assert.equal(region.querySelectorAll('.toast-pill').length, 1);
            assert.equal(region.querySelector('.toast-pill').textContent, 'Kopieret');
            await press(w, d);
            await click(button(d, 'Kopiér'));
            await delay(20);
            assert.equal(d.querySelectorAll('.toast-pill').length, 1, 'repeated copy keeps one pill');
            assert.ok(d.querySelector('.toast-pill').classList.contains('is-shown'));
            await press(w, d);
            await click(button(d, 'Information'));
            p = d.querySelector('.message-panel');
            assert.equal(p.getAttribute('role'), 'dialog');
            assert.equal(p.querySelector('h2').textContent, 'Information');
            assert.equal(px(p, 'top'), 368, 'information stays anchored');
            assert.ok(p.textContent.includes('tester@example.invalid'));
            await back(w);
            assert.ok(button(d, 'Besvar'));
            await click(button(d, 'Besvar'));
            assert.ok(!d.querySelector('.message-panel'));
            const rc = d.querySelector('.reply-composer');
            assert.ok(rc);
            assert.ok(rc.textContent.includes('Kun en opdigtet testbesked.'));
            assert.match(rc.querySelector('.reply-composer-who').textContent, /Svarer dig selv/);
            assert.ok(d.querySelector('.composer-entry.has-reply'));
            assert.ok(label(d, 'Annullér svar'));
            assert.equal(d.querySelector('textarea').value, 'En syntetisk kladde');
            assertPrivateHistory(w);
        }
        finally {
            await fixture.close();
        }
    });

for (const strict of [false, true])
    test(`Tilføj person opens anchored under its icon, survives keyboard, closes on Back (StrictMode=${strict})`, { timeout: 10000 }, async () => {
        const fixture = await env(strict);
        const { w, d } = fixture;
        try {
            const geo = geometry(w);
            await openChatWithDraft(w, d);
            const icon = label(d, 'Tilføj person');
            assert.equal(icon.getAttribute('aria-expanded'), 'false');
            await click(icon);
            const card = d.querySelector('.sheet.anchored-card');
            assert.ok(card, 'anchored card');
            assert.ok(d.querySelector('.overlay.anchored-overlay'));
            assert.equal(icon.getAttribute('aria-expanded'), 'true');
            assert.equal(card.getAttribute('role'), 'dialog');
            assert.equal(card.querySelector('h2').textContent, 'Tilføj person');
            assert.equal(px(card, 'top'), 50 + 6, 'directly under the icon');
            assert.equal(px(card, 'left'), 12, 'right-aligned, clamped to margin');
            assert.equal(px(card, 'maxHeight'), 844 - 12 - 56);
            assert.ok(card.querySelector('input[type=email]'));
            assert.ok(button(d, 'Send til godkendelse'));
            assert.ok(card.textContent.includes('Kun læse') && card.textContent.includes('Læse og skrive'));
            // Keyboard opens on the email field.
            card.querySelector('input[type=email]').focus();
            geo.vv.height = 420; geo.vv.dispatchEvent(new w.Event('resize'));
            await delay(30);
            assert.equal(px(card, 'top'), 56);
            assert.equal(px(card, 'maxHeight'), 420 - 12 - 56, 'card ends above the keyboard and scrolls inside');
            geo.vv.offsetTop = 100; geo.vv.dispatchEvent(new w.Event('scroll'));
            await delay(30);
            assert.equal(px(card, 'top'), 112, 'follows a panned visual viewport');
            geo.vv.offsetTop = 0; geo.vv.height = 844; geo.vv.dispatchEvent(new w.Event('resize'));
            await back(w);
            assert.ok(!d.querySelector('.sheet'));
            assert.ok(d.querySelector('.topbar.chat'));
            assert.equal(d.querySelector('textarea').value, 'En syntetisk kladde');
            assertPrivateHistory(w);
            // Escape and the X button close it too.
            await click(label(d, 'Tilføj person'));
            d.dispatchEvent(new w.KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }));
            await delay(30);
            assert.ok(!d.querySelector('.sheet'));
            await click(label(d, 'Tilføj person'));
            await click(label(d, 'Luk'));
            await delay(30);
            assert.ok(!d.querySelector('.sheet'));
            await click(label(d, 'Tilføj person'));
            d.querySelector('.overlay.anchored-overlay').dispatchEvent(new w.Event('pointerdown', { bubbles: true }));
            await delay(30);
            assert.ok(!d.querySelector('.sheet'), 'outside tap closes');
            assert.equal(d.querySelector('textarea').value, 'En syntetisk kladde');
            assertPrivateHistory(w);
        }
        finally {
            await fixture.close();
        }
    });


// Long-press must not leave "Besvar" text-selected, and the releasing finger
// must not activate the first menu item (Android Chrome selection handles).
function pointer(w, el, type, props = {}) {
    const e = new w.Event(type, { bubbles: true, cancelable: true });
    Object.assign(e, { isPrimary: true, button: 0, clientX: 200, clientY: 330, pointerId: 1, pointerType: 'touch', ...props });
    el.dispatchEvent(e);
}
async function longPress(w, d, el) {
    pointer(w, el, 'pointerdown');
    await delay(520);
    return d.querySelector('.message-panel');
}

for (const strict of [false, true])
    test(`long-press opens menu without selecting Besvar or firing it (StrictMode=${strict})`, { timeout: 10000 }, async () => {
        const fixture = await env(strict);
        const { w, d } = fixture;
        try {
            geometry(w);
            await openChatWithDraft(w, d);
            const bubble = d.querySelector('.msg');
            // Simulate a native selection landing on the first menu label as Android does.
            const p = await longPress(w, d, bubble);
            assert.ok(p, 'menu opens from long-press');
            assert.equal(p.getAttribute('data-armed'), 'true', 'panel is armed while finger is still down');
            assert.ok(p.classList.contains('is-armed'));
            const besvar = button(d, 'Besvar');
            const label = besvar.querySelector('span') || besvar;
            const range = d.createRange();
            range.selectNodeContents(label);
            const sel = w.getSelection();
            sel.removeAllRanges();
            sel.addRange(range);
            assert.ok(sel.toString().includes('Besvar') || sel.rangeCount === 1);
            // Our selectionchange guard clears it.
            await delay(30);
            assert.equal(sel.rangeCount, 0, 'selection cleared while menu is open');
            assert.equal(sel.toString(), '');
            // Trailing release must not click Besvar.
            let replied = d.querySelector('.reply-composer');
            assert.ok(!replied);
            pointer(w, w, 'pointerup', { clientY: 380 });
            besvar.click(); // synthetic click that Android might deliver on release
            await delay(80);
            assert.ok(!d.querySelector('.reply-composer'), 'armed click on Besvar is ignored');
            assert.equal(p.getAttribute('data-armed'), null);
            // After arm clears, a real intentional click still works.
            await click(button(d, 'Besvar'));
            assert.ok(d.querySelector('.reply-composer'));
            assertPrivateHistory(w);
        } finally {
            await fixture.close();
        }
    });

test('message menu CSS blocks native text selection and callout', async () => {
    const css = require('node:fs').readFileSync(path.resolve(__dirname, '../../src/styles.css'), 'utf8');
    assert.match(css, /\.message-panel\{[^}]*-webkit-user-select:\s*none/);
    assert.match(css, /\.message-panel\{[^}]*user-select:\s*none/);
    assert.match(css, /\.message-panel\{[^}]*-webkit-touch-callout:\s*none/);
    assert.match(css, /\.message-panel\.is-armed\{[^}]*pointer-events:\s*none/);
    assert.match(css, /\.msg\{[^}]*-webkit-user-select:\s*none/);
    assert.match(css, /\.message-overlay\{[^}]*user-select:\s*none/);
    const src = require('node:fs').readFileSync(path.resolve(__dirname, '../../src/MessageBubble.tsx'), 'utf8');
    assert.match(src, /selectionchange/);
    assert.match(src, /removeAllRanges/);
    assert.match(src, /openActions\(true\)/);
    assert.match(src, /is-armed/);
});


// Besvar must scroll/focus the composer every time, including a repeat on the
// same message, a second Besvar while a reply is already active, and after cancel.
for (const strict of [false, true])
    test(`Besvar scrolls to composer and focuses every time (StrictMode=${strict})`, { timeout: 10000 }, async () => {
        const fixture = await env(strict);
        const { w, d } = fixture;
        try {
            geometry(w);
            await openChatWithDraft(w, d);
            const scrolls = [];
            const orig = w.HTMLElement.prototype.scrollIntoView;
            w.HTMLElement.prototype.scrollIntoView = function (...args) {
                scrolls.push({ tag: this.tagName, className: String(this.className || ''), args });
                return orig.apply(this, args);
            };
            const focusCalls = [];
            const taProto = w.HTMLTextAreaElement.prototype;
            const origFocus = taProto.focus;
            taProto.focus = function (...args) {
                focusCalls.push({ preventScroll: args[0] && args[0].preventScroll });
                return origFocus.apply(this, args);
            };

            async function besvarOnce() {
                const beforeScroll = scrolls.length;
                const beforeFocus = focusCalls.length;
                await press(w, d);
                await click(button(d, 'Besvar'));
                await delay(40);
                assert.ok(d.querySelector('.reply-composer'), 'reply preview visible');
                assert.match(d.querySelector('.reply-composer-who').textContent, /Svarer dig selv/);
                assert.ok(d.querySelector('.composer-entry.has-reply'));
                assert.equal(d.activeElement, d.querySelector('textarea'), 'composer focused');
                assert.ok(scrolls.length > beforeScroll, 'scrollIntoView ran');
                assert.ok(focusCalls.length > beforeFocus, 'focus ran');
            }

            // First Besvar.
            await besvarOnce();
            // Repeat on the same message while reply already active.
            await besvarOnce();
            // Cancel, then Besvar again.
            await click(label(d, 'Annullér svar'));
            await delay(20);
            assert.ok(!d.querySelector('.reply-composer'));
            await besvarOnce();
            // Compact Signal-style UI: no separate big ghost X, close is inside preview.
            assert.ok(d.querySelector('.reply-composer-close'));
            assert.ok(![...d.querySelectorAll('.reply-composer .ghost')].length);
            assertPrivateHistory(w);
        } finally {
            await fixture.close();
        }
    });

test('reply composer CSS is attached inside the composer surface', async () => {
    const css = require('node:fs').readFileSync(path.resolve(__dirname, '../../src/styles.css'), 'utf8');
    assert.match(css, /\.reply-composer-who\{[^}]*color:\s*var\(--accent\)/);
    assert.match(css, /\.reply-composer-text\{[^}]*text-overflow:\s*ellipsis/);
    assert.match(css, /\.reply-composer-close\{[^}]*border-radius:\s*50%/);
    assert.match(css, /\.reply-composer-close\{[^}]*min-width:\s*44px/);
    assert.match(css, /\.msgs\{[^}]*margin:\s*0 -16px/);
    assert.match(css, /\.msg\.mine\.tailed::before/);
    assert.match(css, /\.msg\.theirs\.tailed::before/);
    assert.match(css, /\.composer-entry\.has-reply/);
    const src = require('node:fs').readFileSync(path.resolve(__dirname, '../../src/App.tsx'), 'utf8');
    assert.match(src, /setReplyFocus/);
    assert.match(src, /replyFocus/);
    assert.match(src, /beginReply/);
});

test('chat column pins the composer: only the list scrolls, never scrollIntoView on new messages', async () => {
    const css = require('node:fs').readFileSync(path.resolve(__dirname, '../../src/styles.css'), 'utf8');
    assert.match(css, /\.wrap\.chat-wrap\{[^}]*height:var\(--app-h,100dvh\)[^}]*overflow:hidden/);
    assert.match(css, /\.chat-wrap > \.msgs\{[^}]*min-height:0[^}]*overflow-y:auto/);
    assert.match(css, /\.toast-region\{[^}]*position:fixed/);
    assert.match(css, /prefers-reduced-motion:reduce\)\{\.toast-pill/);
    const src = require('node:fs').readFileSync(path.resolve(__dirname, '../../src/App.tsx'), 'utf8');
    assert.doesNotMatch(src, /endRef\.current\?\.scrollIntoView/);
    assert.match(src, /"wrap chat-wrap"/);
});

test('frameless WhatsApp chat: no msgs card, tails on first of each sender group', async () => {
    const css = require('node:fs').readFileSync(path.resolve(__dirname, '../../src/styles.css'), 'utf8');
    assert.match(css, /\.msgs\{[^}]*border:\s*0/);
    assert.doesNotMatch(css, /\.card\.msgs\{/);
    assert.match(css, /\.msg\.mine\.tailed/);
    assert.match(css, /\.msg\.theirs\.tailed/);
    const app = require('node:fs').readFileSync(path.resolve(__dirname, '../../src/App.tsx'), 'utf8');
    assert.match(app, /className="msgs"/);
    assert.doesNotMatch(app, /className="card msgs"/);
    assert.match(app, /tailed=\{/);
    assert.match(app, /sameSender/);
});
