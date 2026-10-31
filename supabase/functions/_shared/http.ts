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
  const user = createClient(url, Deno.env.get("SUPABASE_ANON_KEY")!, { global: { headers: { authorization: auth } } });
  const { data, error } = await user.auth.getUser();
  if (error || !data.user) return json({ error: "unauthenticated" }, 401);
  const admin = createClient(url, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, { auth: { persistSession: false } });
  return { uid: data.user.id, admin, user };
}
