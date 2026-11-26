import { CACHE_LIMIT, normalizeCached, retentionMs, withinRetention, wrapCache } from "../../apps/web/src/localCache.ts";

function eq(a: unknown, b: unknown) { if (JSON.stringify(a) !== JSON.stringify(b)) throw new Error(`${JSON.stringify(a)} !== ${JSON.stringify(b)}`); }

const now = Date.parse("2026-11-26T13:00:00Z");
const msg = (id: string, created: string) => ({ id, created_at: created, body: "hemmelig" });

Deno.test("1 year is the default and the shortest official retention", () => {
  eq(retentionMs("1y"), retentionMs("nope"));
  if (!(retentionMs("5y") > retentionMs("1y"))) throw new Error("5y");
  if (Number.isFinite(retentionMs("unlimited"))) throw new Error("unlimited");
});

Deno.test("messages older than the chosen retention are dropped; unlimited keeps them", () => {
  const rows = [
    msg("old", "2024-11-26T13:00:00Z"), // 2 years earlier
    msg("mid", "2025-12-26T13:00:00Z"), // 11 months earlier
    msg("new", "2026-11-26T12:00:00Z"),
  ];
  eq(withinRetention(rows, "1y", now).map((m) => m.id), ["mid", "new"]);
  eq(withinRetention(rows, "5y", now).map((m) => m.id), ["old", "mid", "new"]);
  eq(withinRetention(rows, "unlimited", now).map((m) => m.id), ["old", "mid", "new"]);
});

Deno.test("a legacy bare array is treated as 1 year; an envelope keeps its retention", () => {
  const rows = [msg("old", "2024-11-26T13:00:00Z"), msg("new", "2026-11-26T12:00:00Z")];
  eq(normalizeCached(rows, now).messages.map((m) => (m as { id: string }).id), ["new"]);
  eq(normalizeCached(wrapCache(rows, "5y", now), now).messages.map((m) => (m as { id: string }).id), ["old", "new"]);
  eq(normalizeCached(wrapCache(rows, "5y", now), now).retention, "5y");
});

Deno.test("only the most recent CACHE_LIMIT messages are kept, oldest first", () => {
  // id i is i seconds older than `now`, so id 0 is the newest.
  const rows = Array.from({ length: CACHE_LIMIT + 25 }, (_, i) => msg(String(i), new Date(now - i * 1000).toISOString()));
  const boxed = wrapCache(rows, "unlimited", now);
  if (boxed.messages.length !== CACHE_LIMIT) throw new Error(String(boxed.messages.length));
  eq((boxed.messages[0] as { id: string }).id, String(CACHE_LIMIT - 1));
  eq((boxed.messages[CACHE_LIMIT - 1] as { id: string }).id, "0");
});
