/** Intentionally narrow documented browser push services. No redirects, custom hosts or IPs. */
export function validEndpoint(raw: unknown): raw is string {
  if (typeof raw !== "string" || raw.length > 2048 || !/^https:\/\/(fcm\.googleapis\.com\/fcm\/send\/|updates\.push\.services\.mozilla\.com\/wpush\/v[12]\/|[a-z0-9-]+\.push\.apple\.com\/)[A-Za-z0-9_:/-]+$/.test(raw)) return false;
  const u = new URL(raw);
  return !u.username && !u.password && !u.port && !u.search && !u.hash && !u.pathname.includes("//") && !u.pathname.includes("/../");
}
export type Prepared = {endpoint: string; keys: {p256dh:string;auth:string};binding:string;lang?:string;prepared_at:string;expires_at:string};
/** Notification language follows the recipient's app language (profiles.locale); default Danish. */
export const pushLang=(p:Pick<Prepared,"lang">):"da"|"en"=>p.lang==="en"?"en":"da";
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
