// System notices in the conversation, e.g. "X har lavet en udskrift af samtalen". Read-only.
import { useCallback, useEffect, useState } from "react";
import { supabase } from "./supabase";
export type ConvEvent = { id: string; kind: string; actor_label: string; mine: boolean; created_at: string };
export function useConversationEvents(conv: string, tick: unknown): ConvEvent[] {
  const [ev, setEv] = useState<ConvEvent[]>([]);
  const load = useCallback(async () => { const { data } = await supabase.rpc("get_conversation_events", { conv }); if (Array.isArray(data)) setEv(data as ConvEvent[]); }, [conv]);
  useEffect(() => { load(); }, [load, tick]);
  return ev;
}
export const eventText = (e: ConvEvent, da: boolean) => e.kind === "export"
  ? (e.mine ? (da ? "Du har lavet en udskrift af samtalen" : "You made a transcript of the conversation") : (da ? `${e.actor_label} har lavet en udskrift af samtalen` : `${e.actor_label} made a transcript of the conversation`))
  : "";
/** Events that belong before message i (after message i-1); i === msgs.length gives the trailing ones. */
export function eventsBefore(events: ConvEvent[], msgs: { created_at: string }[], i: number): ConvEvent[] {
  const lo = i > 0 ? Date.parse(msgs[i - 1].created_at) : -Infinity, hi = i < msgs.length ? Date.parse(msgs[i].created_at) : Infinity;
  return events.filter((e) => { const t = Date.parse(e.created_at); return t >= lo && t < hi; });
}
export function EventNotice({ e, lang }: { e: ConvEvent; lang: string }) {
  const da = lang === "da"; const at = new Date(e.created_at).toLocaleString(da ? "da-DK" : "en-GB", { dateStyle: "medium", timeStyle: "short" });
  return <p className="conv-event meta" role="note"><span>{eventText(e, da)}</span> · <time dateTime={e.created_at}>{at}</time></p>;
}
