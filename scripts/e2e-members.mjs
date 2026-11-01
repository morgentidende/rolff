// Live E2E for extra participants. Step 1 (no TOKEN): inviter asks to add a reader, outsider is refused, the other member approves;
// a writer request is declined. Step 2 (TOKEN): reader signs up, accepts, sees no history and cannot send.
// env: SUPABASE_URL, PK, INVITER_EMAIL, INVITER_PW, MEMBER_EMAIL, MEMBER_PW, OUTSIDER_EMAIL, OUTSIDER_PW, READER_EMAIL, [TOKEN, READER_PW]
const { SUPABASE_URL: U, PK } = process.env; const e = process.env;
let n = 0, fail = 0; const ok = (c, m) => { n++; if (!c) fail++; console.log(`${c ? "ok" : "FEJL"} - ${m}`); };
const login = async (email, password) => (await (await fetch(`${U}/auth/v1/token?grant_type=password`, { method: "POST", headers: { apikey: PK, "content-type": "application/json" }, body: JSON.stringify({ email, password }) })).json()).access_token;
const fn = async (jwt, name, body) => { const r = await fetch(`${U}/functions/v1/${name}`, { method: "POST", headers: { apikey: PK, authorization: `Bearer ${jwt}`, "content-type": "application/json" }, body: JSON.stringify(body) }); return { status: r.status, data: await r.json().catch(() => null) }; };
const rpc = async (jwt, name, body) => { const r = await fetch(`${U}/rest/v1/rpc/${name}`, { method: "POST", headers: { apikey: PK, authorization: `Bearer ${jwt ?? PK}`, "content-type": "application/json" }, body: JSON.stringify(body) }); return { status: r.status, data: await r.json().catch(() => null) }; };
const a = await login(e.INVITER_EMAIL, e.INVITER_PW), m = await login(e.MEMBER_EMAIL, e.MEMBER_PW), o = await login(e.OUTSIDER_EMAIL, e.OUTSIDER_PW);
const conv = (await rpc(a, "list_my_conversations", {})).data.find((c) => c.others.some((x) => x.email === e.MEMBER_EMAIL.toLowerCase())).id;
if (!e.TOKEN) {
  const pre = await fn(a, "send-message", { conversation_id: conv, body: "Testbesked: husk madpakke og regntøj fredag.", idempotency_key: crypto.randomUUID() });
  ok(pre.status === 200 && pre.data?.status === "accepted", "besked før tilføjelse sendt");
  const r = await fn(a, "invite-email", { action: "member", conversation_id: conv, email: e.READER_EMAIL, role: "reader" });
  ok(r.status === 200 && r.data?.data?.status === "pending" && r.data.data.notified === 1, "anmodning oprettet; modpart får mail");
  const po = await rpc(o, "list_pending_invitations", { conv }); ok(po.status === 200 && po.data.length === 0, "uvedkommende ser ingen anmodninger");
  const pm = (await rpc(m, "list_pending_invitations", { conv })).data.find((x) => x.invitee_email === e.READER_EMAIL.toLowerCase());
  ok(pm && pm.consents === 1 && pm.required === 2 && !pm.i_consented, "afventer-status synlig (1/2)");
  const oc = await fn(o, "invite-email", { action: "consent", invitation_id: pm.id }); ok(oc.status === 400, "uvedkommende kan ikke godkende");
  const oi = await fn(o, "invite-email", { action: "member", conversation_id: conv, email: e.OUTSIDER_EMAIL, role: "writer" }); ok(oi.status === 400, "uvedkommende kan ikke tilføje sig selv");
  const c = await fn(m, "invite-email", { action: "consent", invitation_id: pm.id }); ok(c.status === 200 && c.data?.data?.status === "sent", "enstemmig godkendelse -> invitation mailet");
  const w = await fn(a, "invite-email", { action: "member", conversation_id: conv, email: "morgentidende-rapport+afvist5@mail.grokbot.com", role: "writer" });
  const wid = (await rpc(m, "list_pending_invitations", { conv })).data.find((x) => x.invitee_email.includes("afvist5"))?.id;
  const d = await fn(m, "invite-email", { action: "decline", invitation_id: wid }); ok(w.status === 200 && d.status === 200, "skriver-anmodning afvist");
  ok(!(await rpc(a, "list_pending_invitations", { conv })).data.some((x) => x.invitee_email.includes("afvist5")), "ét afslag stopper invitationen");
} else {
  const s = await (await fetch(`${U}/auth/v1/signup`, { method: "POST", headers: { apikey: PK, "content-type": "application/json" }, body: JSON.stringify({ email: e.READER_EMAIL, password: e.READER_PW, data: {} }) })).json();
  const r = s.access_token ?? await login(e.READER_EMAIL, e.READER_PW); ok(!!r, "læser opretter konto");
  const oa = await fn(o, "invitation", { action: "accept", token: e.TOKEN }); ok(oa.status === 400, "andre kan ikke bruge linket");
  const ra = await fn(r, "invitation", { action: "accept", token: e.TOKEN }); ok(ra.status === 200 && ra.data?.data === conv, "læser kommer ind");
  const msgs = await rpc(r, "get_messages", { conv }); ok(msgs.status === 200 && msgs.data.length === 0, "ingen historik fra før");
  const sm = await fn(r, "send-message", { conversation_id: conv, body: "Test", idempotency_key: crypto.randomUUID() }); ok(sm.status !== 200 && sm.data?.error === "read_only", "læser kan ikke sende (server)");
  const ins = await fetch(`${U}/rest/v1/messages`, { method: "POST", headers: { apikey: PK, authorization: `Bearer ${r}`, "content-type": "application/json" }, body: JSON.stringify({ conversation_id: conv, sender_id: "00000000-0000-0000-0000-000000000000", body: "x" }) });
  ok(ins.status >= 400, "direkte indsættelse afvises (RLS)");
  const after = await fn(a, "send-message", { conversation_id: conv, body: "Testbesked: afhentning kl. 16 torsdag.", idempotency_key: crypto.randomUUID() });
  ok(after.status === 200, "ny besked efter tilføjelse");
}
console.log(`${n - fail}/${n} ok`); process.exit(fail ? 1 : 0);
