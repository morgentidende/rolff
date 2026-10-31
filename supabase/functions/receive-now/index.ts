// POST {} – releases the caller's pending, approved messages now. Only affects the caller.
import { authed, cors, json } from "../_shared/http.ts";
Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  const a = await authed(req); if (a instanceof Response) return a;
  const r = await a.user.rpc("receive_now");
  if (r.error) return json({ error: "failed" }, 500);
  return json({ released: r.data });
});
