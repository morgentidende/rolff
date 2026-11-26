import { timezoneCountries } from "./timezoneCountries";
import type { Lang } from "./i18n";
const citiesDa: Record<string,string> = { Copenhagen:"København", Godthab:"Nuuk", Vienna:"Wien", Warsaw:"Warszawa", Rome:"Rom", Prague:"Prag", Athens:"Athen", Lisbon:"Lissabon", Brussels:"Bruxelles", Moscow:"Moskva", Bucharest:"Bukarest" };
export function detectTimezone(): string | null {
  try { const zone=Intl.DateTimeFormat().resolvedOptions().timeZone; if (!zone) return null; new Intl.DateTimeFormat("en",{timeZone:zone}); return zone; } catch { return null; }
}
function countryNames(zone: string, lang: string): string {
  try { const names=new Intl.DisplayNames([lang],{type:"region"}); return (timezoneCountries[zone]??[]).map(c=>names.of(c)??c).join(", "); } catch { return (timezoneCountries[zone]??[]).join(", "); }
}
/** Minutes ahead of UTC at `at` (DST-aware). */
export function timezoneOffsetMinutes(zone: string, at=new Date()): number | null {
  try {
    const dtf=new Intl.DateTimeFormat("en-US",{timeZone:zone,year:"numeric",month:"2-digit",day:"2-digit",hour:"2-digit",minute:"2-digit",second:"2-digit",hourCycle:"h23"});
    const parts=Object.fromEntries(dtf.formatToParts(at).filter(p=>p.type!=="literal").map(p=>[p.type,p.value]));
    const asUTC=Date.UTC(+parts.year,+parts.month-1,+parts.day,+parts.hour,+parts.minute,+parts.second);
    return Math.round((asUTC-at.getTime())/60000);
  } catch { return null; }
}
export function formatUtcOffset(mins: number): string {
  if (mins===0) return "UTC+0";
  const sign=mins>0?"+":"-";
  const abs=Math.abs(mins);
  const h=Math.floor(abs/60);
  const m=abs%60;
  return m?`UTC${sign}${h}:${String(m).padStart(2,"0")}`:`UTC${sign}${h}`;
}
function placeName(zone: string, lang: Lang): string {
  if (zone==="Europe/Copenhagen" && lang==="da") return "København – dansk tid";
  const last=zone.split("/").at(-1)!;
  const city=(lang==="da" ? citiesDa[last] : null) ?? last.replaceAll("_"," ");
  const countries=countryNames(zone,lang);
  return countries ? `${city} – ${countries}` : city;
}
export function timezoneLabel(zone: string, lang: Lang, at=new Date()): string {
  if (!zone) return lang==="da" ? "Vælg tidszone" : "Choose timezone";
  if (zone==="UTC" || zone==="Etc/UTC") return "UTC";
  const offset=timezoneOffsetMinutes(zone,at);
  const prefix=offset===null?"":`${formatUtcOffset(offset)} · `;
  return prefix+placeName(zone,lang);
}
const fold=(s:string)=>s.normalize("NFD").replace(/\p{M}/gu,"").toLocaleLowerCase().replaceAll("ø","o").replaceAll("æ","ae").replaceAll("œ","oe");
function isListedZone(zone: string): boolean {
  if (!zone || zone==="UTC" || zone==="Etc/UTC") return false;
  if (zone==="Factory" || zone.startsWith("Etc/") || zone.startsWith("SystemV/") || zone.startsWith("posix/") || zone.startsWith("right/")) return false;
  return true;
}
function allZones(current: string): string[] {
  const intl=Intl as typeof Intl & {supportedValuesOf?: (key:string)=>string[]};
  let supported:string[]=[]; try { supported=intl.supportedValuesOf?.("timeZone")??[]; } catch { /* Static public-domain fallback below. */ }
  const raw=supported.length?supported:Object.keys(timezoneCountries);
  const set=new Set(raw.filter(isListedZone));
  if (current && current!=="UTC" && current!=="Etc/UTC") set.add(current);
  return [...set];
}
function compareZones(a: string, b: string, lang: Lang, at: Date): number {
  const oa=timezoneOffsetMinutes(a,at)??0, ob=timezoneOffsetMinutes(b,at)??0;
  if (oa!==ob) return oa-ob;
  return placeName(a,lang).localeCompare(placeName(b,lang),lang);
}
function matchesQuery(zone: string, terms: string[], lang: Lang, at: Date): boolean {
  const text=fold([zone,timezoneLabel(zone,lang,at),countryNames(zone,"da"),countryNames(zone,"en")].join(" "));
  return terms.every(term=>text.includes(term));
}
export function searchTimezones(query: string, current: string, lang: Lang, at=new Date()): string[] {
  const terms=fold(query.trim()).split(/\s+/).filter(Boolean);
  const rest=allZones(current).filter(z=>!terms.length||matchesQuery(z,terms,lang,at)).sort((a,b)=>compareZones(a,b,lang,at));
  const includeUtc=!terms.length||matchesQuery("UTC",terms,lang,at);
  return includeUtc?["UTC",...rest]:rest;
}
