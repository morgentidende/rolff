import React from 'react';
import { createRoot } from 'react-dom/client';
import { App } from '../../src/App';
import { setNextSend, calls, changeUser, cid, resolveInitial, emitInitial, pauseAlias, resolveAlias, TOKEN_A, TOKEN_B, holdSends, releaseSends, setPendingInvites, allowMemberInvite } from './mock-supabase';
// Fixture storage never reads/writes actual browser preferences, drafts or IndexedDB.
function storage() { const m = new Map<string, string>(); return { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: any) => m.set(k, String(v)), removeItem: (k: string) => m.delete(k), clear: () => m.clear(), key: (n: number) => [...m.keys()][n] ?? null, get length() { return m.size; } }; }
Object.defineProperty(window, 'localStorage', { value: storage(), configurable: true });
Object.defineProperty(window, 'sessionStorage', { value: storage(), configurable: true });
Object.defineProperty(window, 'indexedDB', { value: { open() { throw Error('Synthetic fixture: real cache disabled'); }, deleteDatabase() { const r: any = {}; queueMicrotask(() => r.onsuccess?.()); return r; } }, configurable: true });
localStorage.setItem('lang', 'da');
localStorage.setItem('nameHintSeen', '1');
let root = createRoot(document.getElementById('root')!);
const strict = new URLSearchParams(location.search).has('strict');
root.render(strict ? <React.StrictMode><App /></React.StrictMode> : <App />);
(window as any).QA = { setPendingInvites, allowMemberInvite, setNextSend, holdSends, releaseSends, calls, changeUser, cid, resolveInitial, emitInitial, pauseAlias, resolveAlias, TOKEN_A, TOKEN_B, unmount: () => root.unmount(), strict };
