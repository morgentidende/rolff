// Synthetic fixture: export dialog, upgrade offer, conversation notices and the public verify page.
import { createRoot } from "react-dom/client";
import { ConversationExport } from "../../src/ConversationExport";
import { EventNotice, eventsBefore, type ConvEvent } from "../../src/ConversationEvents";
import { VerifyPage } from "../../src/verify";
const w = window as any; const QA = (w.QA ??= {}); QA.calls = []; QA.plans = 0;
QA.response ??= { status: 200, data: { data: { status: "sent", recipient: "a@x.test", verify_code: "0123-4567-89AB-CDEF-0123" } } };
const call = async (name: string, body: unknown) => { QA.calls.push({ name, body }); return QA.response; };
const root = createRoot(document.getElementById("root")!);
QA.mount = (mode: string, opt: any = {}) => {
  if (mode === "export") root.render(<ConversationExport lang="da" conv="cccccccc-0000-4000-8000-000000000001" plan={opt.plan ?? "text_attachments"} ownEmail="a@x.test" openPlans={() => QA.plans++} call={call} />);
  if (mode === "events") {
    const msgs = [{ id: "m1", created_at: "2026-11-06T08:00:00Z" }, { id: "m2", created_at: "2026-11-06T09:00:00Z" }];
    const ev: ConvEvent[] = [{ id: "e1", kind: "export", actor_label: "Mor (alias)", mine: false, created_at: "2026-11-06T08:30:00Z" }, { id: "e2", kind: "export", actor_label: "a@x.test", mine: true, created_at: "2026-11-06T10:00:00Z" }];
    root.render(<div>{msgs.map((m, i) => <div key={m.id}>{eventsBefore(ev, msgs, i).map((e) => <EventNotice key={e.id} e={e} lang="da" />)}<p className="msg">{m.id}</p></div>)}{eventsBefore(ev, msgs, msgs.length).map((e) => <EventNotice key={e.id} e={e} lang="da" />)}</div>);
  }
  if (mode === "verify") root.render(<VerifyPage initialCode={opt.code ?? ""} run={async (q) => { QA.calls.push({ name: "verify", body: q }); return opt.result; }} />);
};
QA.unmount = () => root.unmount();
