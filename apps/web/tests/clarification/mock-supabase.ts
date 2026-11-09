// Entirely fabricated auth/contact data. This module never imports the Supabase SDK.
export const uid = '10000000-0000-4000-8000-000000000001';
export const cid = '20000000-0000-4000-8000-000000000001';
export const other = '30000000-0000-4000-8000-000000000001';
export const TOKEN_A = 'synthetic-token-A', TOKEN_B = 'synthetic-token-B';
const initial = { user: { id: uid, email: 'tester@example.invalid' }, access_token: TOKEN_A };
let session: any = initial, callbackIssued = false;
const aliases = new Map<string, string | null>();
const listeners = new Set<any>(), pendingInitial: any[] = [];
let aliasPaused = false, pendingAlias: (() => void) | null = null;
export const calls: any[] = [];
const seedMsg = { id: '40000000-0000-4000-8000-000000000001', sender_id: uid, sender_email: 'tester@example.invalid', body: 'Kun en opdigtet testbesked.', created_at: '2026-11-07T08:00:00Z', mine: true };
let messages: any[] = [{ ...seedMsg }];
let msgSeq = 2;
let currentPlan = 'text_attachments';
export function pauseAlias() { aliasPaused = true; }
export function resolveAlias() { pendingAlias?.(); pendingAlias = null; aliasPaused = false; }
export function resolveInitial() { pendingInitial.splice(0).forEach(r => r({ data: { session: initial } })); }
export function emitInitial() { listeners.forEach(f => f('INITIAL_SESSION', initial)); }
export function changeUser(id: string | null) {
    callbackIssued = true;
    session = id ? { user: { id, email: 'synthetic@example.invalid' }, access_token: id === uid ? TOKEN_A : TOKEN_B } : null;
    listeners.forEach(f => f(id ? 'SIGNED_IN' : 'SIGNED_OUT', session));
}
async function getSession() {
    if ((globalThis as any).__QA_PAUSE_AUTH && !callbackIssued)
        return await new Promise<any>(r => pendingInitial.push(r));
    return { data: { session } };
}
const conv = () => ({ id: cid, role: 'parent', members: 2, others: [{ user_id: other, email: 'kontakt@example.invalid', alias: aliases.get(session?.user.id) ?? null }], color: 'teal' });
function query() {
    const p: any = Promise.resolve({ data: [], error: null });
    for (const k of ['select', 'eq', 'order', 'maybeSingle', 'delete', 'update', 'insert'])
        p[k] = () => p;
    return p;
}
function rpc(name: string, args: any) {
    const call: any = { name, args, headers: {} };
    calls.push(call);
    let data: any = [];
    if (name === 'list_my_conversations')
        data = [conv()];
    if (name === 'get_my_public_name')
        data = 'Testperson';
    if (name === 'get_my_plan')
        data = [{ plan: currentPlan, price: currentPlan === 'text' ? 49 : 79, pending_plan: null, period_end: '2026-12-09T00:00:00Z', test_switch: true }];
    if (name === 'set_my_plan_test') { currentPlan = args?.p_plan ?? currentPlan; data = [{ plan: currentPlan, pending_plan: null, period_end: '2026-12-09T00:00:00Z' }]; }
    if (name === 'get_my_send_limits')
        data = [{ next_at: null }];
    if (name === 'get_messages_v2')
        data = messages.map(m => ({ ...m }));
    if (name === 'my_pending_count')
        data = 0;
    if (name === 'list_conversation_members')
        data = [{ user_id: uid, label: 'Testperson', role: 'parent', me: true }, { user_id: other, label: 'Testkontakt', role: 'parent', me: false }];
    const result: any = name === 'set_contact_alias' && aliasPaused
        ? new Promise(resolve => { pendingAlias = () => resolve({ data, error: null }); })
        : name === 'list_my_conversations_v2'
            // Simulates the v2 migration not being deployed yet: Home must fall back to v1.
            ? Promise.resolve({ data: null, error: { code: 'PGRST202', message: 'synthetic: function not found' } })
            : Promise.resolve({ data, error: null });
    if (name === 'set_contact_alias')
        result.then(() => { const owner = call.headers.Authorization === `Bearer ${TOKEN_A}` ? uid : session?.user.id; aliases.set(owner, args.p_alias.trim() || null); });
    result.setHeader = (key: string, value: string) => { call.headers[key] = value; return result; };
    return result;
}
export const supabase: any = {
    auth: {
        getSession,
        onAuthStateChange: (f: any) => { listeners.add(f); return { data: { subscription: { unsubscribe: () => listeners.delete(f) } } }; },
        signOut: async () => { changeUser(null); return { error: null }; },
        verifyOtp: async () => ({ error: null }), getUser: async () => ({ data: { user: session?.user } }),
    }, from: query, rpc,
};
// Optional: hold send-* calls open so tests can observe the "checking" state.
let holdSend = false; const heldSends: ((status: string) => void)[] = [];
export function holdSends() { holdSend = true; }
export function releaseSends(status: string) { holdSend = false; heldSends.splice(0).forEach(r => r(status)); }
function acceptSend(args: any) {
    const id = `50000000-0000-4000-8000-${String(msgSeq++).padStart(12, '0')}`;
    const body = typeof args?.body === 'string' ? args.body
        : (typeof args?.caption === 'string' && args.caption.trim() ? args.caption : 'Opdigtet godkendt besked.');
    messages = [...messages, {
        id, sender_id: uid, sender_email: session?.user?.email ?? 'tester@example.invalid', body,
        created_at: new Date(Date.UTC(2026, 10, 9, 12, 0, msgSeq)).toISOString(), mine: true,
    }];
    return { status: 200, data: { status: 'accepted', message_id: id } };
}
// Optional: next send-* call returns this exact response body (e.g. a blocked result with an explanation).
let nextSend: any = null;
export function setNextSend(data: any) { nextSend = data; }
export async function callFn(name: string, args: any) {
    calls.push({ function: name, args });
    if (nextSend && name.startsWith('send-')) { const data = nextSend; nextSend = null; return { status: 200, data }; }
    if (holdSend && name.startsWith('send-')) {
        const status = await new Promise<string>(r => heldSends.push(r));
        if (status === 'accepted') return acceptSend(args);
        return { status: 200, data: { status } };
    }
    if (name === 'invite-email' && args?.action === 'member')
        return { status: 403, data: { error: 'plan_required' } };
    return { status: 200, data: { status: name.startsWith('send-') ? 'clarification_required' : 'accepted' } };
}
