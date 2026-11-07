import { timezoneCountries } from "./timezoneCountries";
import type { Lang } from "./i18n";
const citiesDa: Record<string,string> = { Copenhagen:"København", Godthab:"Nuuk", Vienna:"Wien", Warsaw:"Warszawa", Rome:"Rom", Prague:"Prag", Athens:"Athen", Lisbon:"Lissabon", Brussels:"Bruxelles", Moscow:"Moskva", Bucharest:"Bukarest" };
export function detectTimezone(): string | null {
  try { const zone=Intl.DateTimeFormat().resolvedOptions().timeZone; if (!zone) return null; new Intl.DateTimeFormat("en",{timeZone:zone}); return zone; } catch { return null; }
}
function countryNames(zone: string, lang: string): string {
  try { const names=new Intl.DisplayNames([lang],{type:"region"}); return (timezoneCountries[zone]??[]).map(c=>names.of(c)??c).join(", "); } catch { return (timezoneCountries[zone]??[]).join(", "); }
}
export function timezoneLabel(zone: string, lang: Lang): string {
  if (!zone) return lang==="da" ? "Vælg tidszone" : "Choose timezone";
  if (zone==="Europe/Copenhagen" && lang==="da") return "København – dansk tid";
  if (zone==="UTC" || zone==="Etc/UTC") return "UTC";
  const last=zone.split("/").at(-1)!; const city=(lang==="da" ? citiesDa[last] : null) ?? last.replaceAll("_"," "); const countries=countryNames(zone,lang);
  return countries ? `${city} – ${countries}` : city;
}
const fold=(s:string)=>s.normalize("NFD").replace(/\p{M}/gu,"").toLocaleLowerCase().replaceAll("ø","o").replaceAll("æ","ae").replaceAll("œ","oe");
export function searchTimezones(query: string, current: string, lang: Lang): string[] {
  const intl=Intl as typeof Intl & {supportedValuesOf?: (key:string)=>string[]};
  let supported:string[]=[]; try { supported=intl.supportedValuesOf?.("timeZone")??[]; } catch { /* Static public-domain fallback below. */ }
  const all=[...new Set([current,"UTC",...supported,...Object.keys(timezoneCountries)].filter(Boolean))];
  const terms=fold(query.trim()).split(/\s+/).filter(Boolean);
  if (!terms.length) return [...new Set([current,"Europe/Copenhagen","Europe/London","Europe/Berlin","Europe/Stockholm","Europe/Oslo","America/New_York","UTC"].filter(Boolean))];
  return all.filter(z=>{ const text=fold([z,timezoneLabel(z,lang),countryNames(z,"da"),countryNames(z,"en")].join(" ")); return terms.every(term=>text.includes(term)); }).sort((a,b)=>timezoneLabel(a,lang).localeCompare(timezoneLabel(b,lang),lang));
}
