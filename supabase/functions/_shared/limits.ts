// Per-person FREQUENCY limits (set by a recipient for one sender). Checked BEFORE prepare_send/AI so a rejected
// message is not stored, costs nothing and does not count against the rate limit. Only the binding
// limit and the member who set it are returned (never other settings).
// deno-lint-ignore no-explicit-any
export async function checkPersonLimits(admin: any, conv: string, uid: string, _chars: number): Promise<Record<string, unknown> | null | "error"> {
  const mem = await admin.from("memberships").select("role").eq("conversation_id", conv).eq("user_id", uid).is("left_at", null).maybeSingle();
  if (mem.error) return "error";
  if (!mem.data || mem.data.role === "reader") return null; // prepare_send gives the proper read_only / forbidden error
  const r = await admin.rpc("_send_limits", { conv, p_sender: uid });
  if (r.error) return "error";
  const s = r.data?.[0]; if (!s) return null;
  if (s.next_at) {
    const secs = Math.max(1, Math.ceil((new Date(s.next_at).getTime() - Date.now()) / 1000));
    return { status: "frequency_limit", by: s.next_by, retry_after_s: secs, next_at: s.next_at };
  }
  return null;
}
