// No client-provided plan is trusted. Lookup/unknown values fail closed.
export async function checkPlanLength(admin: { rpc: (name: string, args: Record<string, unknown>) => PromiseLike<{ data: unknown; error: unknown }> }, uid: string, count: number) {
  const r = await admin.rpc("message_char_limit", { uid });
  if (r.error || (r.data !== 160 && r.data !== 480)) return "error" as const;
  return count > r.data ? { status: "plan_length_limit", limit: r.data, count } : null;
}
export function planLengthError(message: string, count: number) {
  const m = /plan_length_limit:(160|480)(?![0-9])/.exec(message);
  return m ? { status: "plan_length_limit", limit: Number(m[1]), count } : null;
}
