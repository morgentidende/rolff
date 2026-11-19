/** Intentionally narrow documented browser push services. No redirects, custom hosts or IPs. */
export function validEndpoint(raw: unknown): raw is string {
  if (typeof raw !== "string" || raw.length > 2048 || !/^https:\/\/(fcm\.googleapis\.com\/fcm\/send\/|updates\.push\.services\.mozilla\.com\/wpush\/v[12]\/|[a-z0-9-]+\.push\.apple\.com\/)[A-Za-z0-9_:/-]+$/.test(raw)) return false;
  const u = new URL(raw);
  return !u.username && !u.password && !u.port && !u.search && !u.hash && !u.pathname.includes("//") && !u.pathname.includes("/../");
}
export type Who = {s?:unknown;k?:unknown;n?:unknown};
export type Prepared = {endpoint: string; keys: {p256dh:string;auth:string};binding:string;lang?:string;who?:Who|null;prepared_at:string;expires_at:string};
/** Notification language follows the recipient's app language (profiles.locale); default Danish. */
export const pushLang=(p:Pick<Prepared,"lang">):"da"|"en"=>p.lang==="en"?"en":"da";
/** Display-name fields for the notification title: only the recipient's own private nicknames
 *  (max 2, max 40 characters, no control/bidi characters) plus sender and message COUNTS.
 *  Never message text. Anything malformed yields null and the generic text is shown instead. */
const NAME_JUNK=/[\u0000-\u001f\u007f-\u009f\u200b-\u200f\u202a-\u202e\u2066-\u2069\ufeff]/g;
export function cleanName(x:unknown):string {
  if(typeof x!=="string")return "";
  return Array.from(x.replace(NAME_JUNK,"").trim()).slice(0,40).join("").trim();
}
export function pushWho(p:Pick<Prepared,"who">):{s:string[];k:number;n:number}|null {
  const w=p.who;if(!w || typeof w!=="object" || !Array.isArray(w.s))return null;
  const s=w.s.slice(0,2).map(cleanName).filter(Boolean);
  const k=w.k,n=w.n;
  if(!s.length || typeof k!=="number" || !Number.isInteger(k) || k<s.length || k>999)return null;
  const msgs=typeof n==="number" && Number.isInteger(n) && n>=k && n<=99?n:k;
  return {s:k===2?s:s.slice(0,1),k,n:msgs};
}
/** The exact (pre-encryption) push payload: binding, language, expiry and, if valid, nickname(s)+counts. */
export const pushPayload=(p:Prepared,now=Date.now())=>JSON.stringify({v:1,binding:p.binding,l:pushLang(p),...(pushWho(p)??{}),expires:now+30000});
export type Outcome = "accepted" | "gone" | "permanent" | "retry" | "deferred" | "expired";
export function outcome(status:number):Outcome {
  if (status>=200 && status<300) return "accepted";
  if (status===404 || status===410) return "gone";
  if (status===408 || status===429 || status>=500) return "retry";
  return "permanent"; // Includes redirects and bad VAPID configuration. No repeated storm.
}
export function validPrepared(p: Prepared, now=Date.now()):boolean {
  return validEndpoint(p.endpoint) && /^B[A-Za-z0-9_-]{86}$/.test(p.keys?.p256dh) && /^[A-Za-z0-9_-]{22}$/.test(p.keys?.auth) && /^[0-9a-f-]{36}$/.test(p.binding)
    && Number.isFinite(Date.parse(p.expires_at)) && Date.parse(p.expires_at)>now && Date.parse(p.prepared_at)<=now+1000 && now-Date.parse(p.prepared_at)<30000;
}

export type Handoff = {id:string;valid_for_ms:number};
export type Authorize = (requestHash:string)=>Promise<Handoff|null>;
/** The interval starts BEFORE the RPC, not on receipt. Clock offsets never extend it. */
export function handoffFresh(intent:Handoff|null,startMono:number,startWall:number,mono:number,wall:number):boolean {
  if(!intent || !/^[0-9a-f-]{36}$/.test(intent.id) || !Number.isInteger(intent.valid_for_ms) || intent.valid_for_ms<=50 || intent.valid_for_ms>750)return false;
  if(mono<startMono || wall<startWall-50)return false; // backward jumps fail closed
  const elapsed=Math.max(mono-startMono,wall-startWall);
  return elapsed<intent.valid_for_ms-50; // reserve drift/processing margin; no promise about OS scheduling
}
