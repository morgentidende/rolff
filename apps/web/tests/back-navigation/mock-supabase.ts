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
// Pending invitation fixture (window.__QA_PENDING = 'live' | 'nomail'): nobody has accepted yet, the owner's own nickname is stored per invitation.
export const inv = '50000000-0000-4000-8000-000000000001';
export const inv2 = '50000000-0000-4000-8000-000000000002';
const pendingAliases = new Map<string, string | null>();
const pendingConv = () => ({ id: cid, role: 'parent', members: 1, others: [], color: 'teal',
    pending_invitee: (globalThis as any).__QA_PENDING === 'nomail' ? null : 'afventer@example.invalid',
    pending_invitation_id: inv, pending_alias: pendingAliases.get(inv) ?? null });
const conv = () => (globalThis as any).__QA_PENDING ? pendingConv() : ({ id: cid, role: 'parent', members: 2, others: [{ user_id: other, email: 'kontakt@example.invalid', alias: aliases.get(session?.user.id) ?? null }], color: 'teal' });
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
    if (name === 'list_my_conversations_v2')
        data = [(globalThis as any).__QA_PENDING ? { ...conv(), last_at: null, last_body: null, last_mine: false, last_sender_name: null, last_att_mime: null } : { ...conv(), last_at: '2026-11-07T08:00:00Z', last_body: 'Kun en opdigtet testbesked.', last_mine: true, last_sender_name: null, last_att_mime: null }];
    // QA-only: __QA_PENDING = 'list' returns a realistic front page (two waiting rows and one accepted contact).
    if ((name === 'list_my_conversations' || name === 'list_my_conversations_v2') && (globalThis as any).__QA_PENDING === 'list') {
        const base = { role: 'parent', color: 'teal', last_at: null, last_body: null, last_mine: false, last_sender_name: null, last_att_mime: null };
        data = [
            { ...base, id: cid, members: 1, others: [], pending_invitee: 'far@example.invalid', pending_invitation_id: inv, pending_alias: pendingAliases.get(inv) ?? null },
            { ...base, id: '20000000-0000-4000-8000-000000000002', color: 'violet', members: 1, others: [], pending_invitee: null, pending_invitation_id: inv2, pending_alias: pendingAliases.get(inv2) ?? null },
            { ...base, id: '20000000-0000-4000-8000-000000000003', color: 'blue', members: 2, others: [{ user_id: other, email: 'kontakt@example.invalid', alias: 'Mor' }], pending_invitee: null, pending_invitation_id: null, pending_alias: null,
              last_at: '2026-11-18T08:00:00Z', last_body: 'Kun en opdigtet testbesked.', last_mine: false },
        ];
    }
    if (name === 'get_my_public_name')
        data = 'Testperson';
    if (name === 'get_my_plan')
        data = [{ plan: 'text', price: 49 }];
    if (name === 'get_my_send_limits')
        data = [{ next_at: null }];
    const qa = (globalThis as any).__QA_FIXTURE as { messages?: any[]; invites?: any[] } | undefined;
    if (name === 'get_messages_v2' || name === 'get_messages_v3')
        data = qa?.messages?.map((m: any) => ({ ...m })) ?? [{ id: '40000000-0000-4000-8000-000000000001', sender_id: uid, sender_email: 'tester@example.invalid', body: 'Kun en opdigtet testbesked.', created_at: '2026-11-07T08:00:00Z', mine: true }];
    // Delayed-message edit-hold (fabricated). __QA_HOLD_RESULT = 'sent' simulates "already delivered".
    if (name === 'hold_delayed_message' || name === 'resume_delayed_message' || name === 'cancel_delayed_message') {
        const m = qa?.messages?.find((x: any) => x.id === args?.p_id);
        if (name === 'hold_delayed_message' && (globalThis as any).__QA_HOLD_RESULT === 'sent') {
            const failed: any = Promise.resolve({ data: null, error: { message: 'no_longer_pending' } });
            failed.setHeader = () => failed;
            return failed;
        }
        if (m && name === 'hold_delayed_message') { m.held = true; m.deliver_after = null; data = true; }
        if (m && name === 'resume_delayed_message') { m.held = false; m.deliver_after = new Date(Date.now() + 30000).toISOString(); data = m.deliver_after; }
        if (m && name === 'cancel_delayed_message') qa!.messages = qa!.messages!.filter((x: any) => x !== m);
    }
    if (name === 'toggle_message_thumb') {
        const msgs = qa?.messages;
        const m = msgs?.find((x: any) => x.id === args?.p_message);
        if (m) {
            m.i_thumbed = !m.i_thumbed;
            m.thumb_count = Math.max(0, (m.thumb_count ?? 0) + (m.i_thumbed ? 1 : -1));
            data = [{ message_id: m.id, i_thumbed: m.i_thumbed, thumb_count: m.thumb_count }];
        } else {
            data = [{ message_id: args?.p_message, i_thumbed: true, thumb_count: 1 }];
        }
    }
    // "Lydløs" (own mute only). Entirely fabricated; the real storage is server-side and owner-only.
    const mutes: any[] = ((globalThis as any).__QA_MUTES ??= []);
    if (name === 'my_conversation_mutes')
        data = mutes.map(m => ({ ...m }));
    if (name === 'set_my_conversation_mute' || name === 'clear_my_conversation_mute') {
        const fail = (globalThis as any).__QA_MUTE_ERROR;
        if (fail) {
            const failed: any = Promise.resolve({ data: null, error: { message: 'synthetic failure' } });
            failed.setHeader = () => failed;
            return failed;
        }
        const i = mutes.findIndex(m => m.conversation_id === args.conv);
        if (i >= 0) mutes.splice(i, 1);
        if (name === 'set_my_conversation_mute') {
            const hours: any = { '8h': 8, '24h': 24, '1w': 168 };
            const until = args.p_duration === 'always' ? null : new Date(Date.now() + hours[args.p_duration] * 3600e3).toISOString();
            const row = { conversation_id: args.conv, mute_until: until, always: until === null };
            mutes.push(row);
            data = { muted: true, mute_until: until, always: until === null };
        } else data = null;
    }
    if (name === 'list_pending_invitations')
        data = qa?.invites ?? [];
    if (name === 'my_pending_count')
        data = 0;
    if (name === 'list_conversation_members')
        data = [{ user_id: uid, label: 'Testperson', role: 'parent', me: true }, { user_id: other, label: 'Testkontakt', role: 'parent', me: false }];
    if (name === 'set_invitation_alias' && (globalThis as any).__QA_ALIAS_ERROR) {
        const failed: any = Promise.resolve({ data: null, error: { message: 'synthetic failure' } });
        failed.setHeader = (key: string, value: string) => { call.headers[key] = value; return failed; };
        return failed;
    }
    const result: any = name === 'set_contact_alias' && aliasPaused
        ? new Promise(resolve => { pendingAlias = () => resolve({ data, error: null }); })
        : Promise.resolve({ data, error: null });
    if (name === 'set_invitation_alias')
        result.then(() => { pendingAliases.set(String(args.p_invitation), String(args.p_alias ?? '').trim() || null); });
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
export async function callFn(name: string, args: any) {
    calls.push({ function: name, args });
    if (name === 'invite-email' && args?.action === 'member')
        return { status: 403, data: { error: 'plan_required' } };
    return { status: 200, data: { status: 'accepted' } };
}
