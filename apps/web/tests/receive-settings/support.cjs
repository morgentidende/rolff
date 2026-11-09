const assert = require('node:assert/strict');
const path = require('node:path');
const { JSDOM, VirtualConsole } = require('jsdom');
const esbuild = require('esbuild');
const webRoot = path.resolve(__dirname, '../..');
let bundle;
async function appBundle() {
    return bundle ??= esbuild.build({
        entryPoints: [path.join(__dirname, 'entry.tsx')], bundle: true, write: false,
        format: 'iife', jsx: 'automatic', logLevel: 'silent',
        plugins: [{ name: 'synthetic-only', setup(b) {
                    b.onResolve({ filter: /^\.\/supabase$/ }, () => ({ path: path.join(__dirname, 'mock-supabase.ts') }));
                    b.onResolve({ filter: /^\.\/receiveTimezone$/ }, () => ({ path: path.join(__dirname, 'mock-timezone.ts') }));
                } }],
    }).then(r => r.outputFiles[0].text);
}
const delay = ms => new Promise(r => setTimeout(r, ms));
async function env(strict = false, pauseAuth = false) {
    const errors = [], network = [], vc = new VirtualConsole();
    vc.on('jsdomError', e => errors.push(e.message));
    vc.on('error', (...args) => errors.push(args.map(String).join(' | ')));
    vc.on('warn', (...args) => errors.push(args.map(String).join(' | ')));
    const dom = new JSDOM('<!doctype html><div id="root"></div>', {
        url: 'https://synthetic.invalid/fixture' + (strict ? '?strict=1' : ''),
        runScripts: 'outside-only', pretendToBeVisual: true, virtualConsole: vc,
        // No resources option: jsdom never loads subresources. Only bundled code runs.
        beforeParse(w) {
            w.__QA_PAUSE_AUTH = pauseAuth;
            w.matchMedia = () => ({ matches: false, addEventListener() { }, removeEventListener() { } });
            w.HTMLElement.prototype.scrollIntoView = function () { };
            // Not an Android close-request emulator: tests explicitly dispatch cancel.
            w.HTMLDialogElement.prototype.showModal = function () { this.open = true; };
            w.HTMLDialogElement.prototype.close = function () {
                if (!this.open)
                    return;
                this.open = false;
                this.dispatchEvent(new w.Event('close'));
            };
            w.ResizeObserver = class {
                observe() { }
                disconnect() { }
            };
            const blocked = name => { network.push(name); throw new Error('Unexpected network: ' + name); };
            w.fetch = async () => blocked('fetch');
            for (const name of ['XMLHttpRequest', 'WebSocket', 'EventSource'])
                w[name] = class {
                    constructor() { blocked(name); }
                };
            w.navigator.sendBeacon = () => blocked('sendBeacon');
        },
    });
    dom.window.eval(await appBundle());
    await delay(70);
    return {
        dom, w: dom.window, d: dom.window.document, errors,
        async close() {
            dom.window.QA?.unmount();
            await delay(10);
            dom.window.close();
            assert.deepEqual(network, [], 'No network capability may be used');
            assert.deepEqual(errors, [], 'React warnings, console errors and jsdom errors fail CI');
        },
    };
}
function button(d, text) {
    const b = [...d.querySelectorAll('button')].find(b => b.textContent.trim() === text);
    assert.ok(b, 'button: ' + text);
    return b;
}
function label(d, name) {
    const b = d.querySelector(`[aria-label="${name}"]`);
    assert.ok(b, 'aria-label: ' + name);
    return b;
}
async function click(b) { b.click(); await delay(25); }
async function back(w) { w.history.back(); await delay(40); }
async function forward(w) { w.history.forward(); await delay(40); }
function assertPrivateHistory(w) {
    const state = w.history.state;
    assert.deepEqual(Object.keys(state), ['__rolffBack']);
    const marker = state.__rolffBack;
    assert.deepEqual(Object.keys(marker).sort(), ['doc', 'kind', 'v']);
    assert.equal(marker.v, 1);
    assert.equal(typeof marker.doc, 'string');
    assert.ok(['base', 'guard'].includes(marker.kind));
    assert.ok(!/example\.invalid|synthetic|kladde|testbesked|40000000|30000000|20000000|10000000/i.test(JSON.stringify(state)));
    assert.ok(Object.values(marker).every(v => typeof v !== 'function' && typeof v !== 'object'), 'No callbacks or payload objects in history');
}
module.exports = { webRoot, env, delay, button, label, click, back, forward, assertPrivateHistory };
