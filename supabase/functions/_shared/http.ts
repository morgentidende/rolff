import { createClient, type SupabaseClient } from "jsr:@supabase/supabase-js@2";
export const cors = {
  "access-control-allow-origin": "*",
  "access-control-allow-headers": "authorization, x-client-info, apikey, content-type",
  "access-control-allow-methods": "POST, OPTIONS",
};
export const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...cors, "content-type": "application/json" } });

/** Returns the verified caller id and a service client (server only). */
export async function authed(req: Request): Promise<{ uid: string; admin: SupabaseClient; user: SupabaseClient } | Response> {
  const url = Deno.env.get("SUPABASE_URL")!;
  const auth = req.headers.get("authorization") ?? "";
  const jwt = auth.replace(/^Bearer\s+/i, "");
  if (!jwt) return json({ error: "unauthenticated" }, 401);
  const admin = createClient(url, serverKey(), { auth: { persistSession: false } });
  const { data, error } = await admin.auth.getUser(jwt);
  if (error || !data.user) return json({ error: "unauthenticated" }, 401);
  const user = createClient(url, publicKey(), { auth: { persistSession: false }, global: { headers: { authorization: `Bearer ${jwt}` } } });
  return { uid: data.user.id, admin, user };
}

function firstKey(jsonVar: string): string | undefined {
  try { const o = JSON.parse(Deno.env.get(jsonVar) ?? ""); return o?.default ?? Object.values(o ?? {})[0] as string; } catch { return undefined; }
}
// Supports both legacy (anon/service_role) and new (publishable/secret) key env vars.
const serverKey = () => Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || firstKey("SUPABASE_SECRET_KEYS")!;
const publicKey = () => Deno.env.get("SUPABASE_ANON_KEY") || firstKey("SUPABASE_PUBLISHABLE_KEYS")!;
