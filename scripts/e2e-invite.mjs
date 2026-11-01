// Live E2E for e-mail invitations. Step 1 (no TOKEN): inviter sends invite. Step 2 (TOKEN set): outsider fails, invitee signs up + accepts, reuse fails.
// env: SUPABASE_URL, PK, INVITER_EMAIL, INVITER_PW, INVITEE_EMAIL, OUTSIDER_EMAIL, OUTSIDER_PW, [TOKEN, INVITEE_PW]
const { SUPABASE_URL: U, PK } = process.env; const e = process.env;
let n = 0, fail = 0; const ok = (c, m) => { n++; if (!c) fail++; console.log(`${c ? "ok" : "FEJL"} - ${m}`); };
const login = async (email, password) => (await (await fetch(`${U}/auth/v1/token?grant_type=password`, { method: "POST", headers: { apikey: PK, "content-type": "application/json" }, body: JSON.stringify({ email, password }) })).json()).access_token;
const fn = async (jwt, name, body) => { const r = await fetch(`${U}/functions/v1/${name}`, { method: "POST", headers: { apikey: PK, authorization: `Bearer ${jwt}`, "content-type": "application/json" }, body: JSON.stringify(body) }); return { status: r.status, data: await r.json().catch(() => null) }; };
const rpc = async (jwt, name, body) => { const r = await fetch(`${U}/rest/v1/rpc/${name}`, { method: "POST", headers: { apikey: PK, authorization: `Bearer ${jwt ?? PK}`, "content-type": "application/json" }, body: JSON.stringify(body) }); return { status: r.status, data: await r.json().catch(() => null) }; };
if (!e.TOKEN) {
  const a = await login(e.INVITER_EMAIL, e.INVITER_PW); ok(!!a, "inviterende logger ind");
  const r = await fn(a, "invite-email", { name: "Testmodtager", email: e.INVITEE_EMAIL });
  ok(r.status === 200 && r.data?.data?.sent && r.data?.data?.copy_sent, "invitation + kopi sendt");
  const bad = await fn(a, "invite-email", { name: "X", email: "ikke-en-mail" }); ok(bad.status === 400, "ugyldig e-mail afvises");
} else {
  const p = await rpc(null, "peek_invitation", { p_token: e.TOKEN }); ok(p.data?.[0]?.invitee_email === e.INVITEE_EMAIL.toLowerCase(), "landingsside kan læse invitationen anonymt");
  const o = await login(e.OUTSIDER_EMAIL, e.OUTSIDER_PW);
  const ro = await fn(o, "invitation", { action: "accept", token: e.TOKEN }); ok(ro.status === 400 && ro.data?.error === "invalid_invitation", "ikke-inviteret konto kan ikke acceptere");
  const s = await (await fetch(`${U}/auth/v1/signup`, { method: "POST", headers: { apikey: PK, "content-type": "application/json" }, body: JSON.stringify({ email: e.INVITEE_EMAIL, password: e.INVITEE_PW, data: { display_name: "Testmodtager" } }) })).json();
  const b = s.access_token ?? await login(e.INVITEE_EMAIL, e.INVITEE_PW); ok(!!b, "inviteret opretter konto");
  const rb = await fn(b, "invitation", { action: "accept", token: e.TOKEN }); ok(rb.status === 200, "inviteret accepterer");
  const convs = await rpc(b, "list_my_conversations", {}); ok(convs.data?.some((c) => c.id === rb.data?.data && c.members === 2), "lander i samme samtale (2 medlemmer)");
  const rr = await fn(b, "invitation", { action: "accept", token: e.TOKEN }); ok(rr.status === 400, "linket kan ikke bruges igen");
  const m = await rpc(b, "get_messages", { conv: rb.data?.data }); ok(m.status === 200 && Array.isArray(m.data) && m.data.length === 0, "ingen historik fra før tilmelding");
}
console.log(`\n${n - fail}/${n} bestået`); process.exit(fail ? 1 : 0);
