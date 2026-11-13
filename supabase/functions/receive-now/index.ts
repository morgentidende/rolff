// POST { conv? } – releases the caller's pending, approved messages now.
// If conv is set, only that conversation is released. Only affects the caller.
import { authed, cors, json } from "../_shared/http.ts";
Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  const a = await authed(req); if (a instanceof Response) return a;
  let conv: string | null = null;
  try {
    const body = await req.json();
    if (typeof body?.conv === "string" && body.conv.length > 0) conv = body.conv;
  } catch { /* empty body is still "release all" */ }
  const r = await a.user.rpc("receive_now", { p_conv: conv });
  if (r.error) return json({ error: "failed" }, 500);
  return json({ released: r.data });
});
