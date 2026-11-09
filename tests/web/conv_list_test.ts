import { assertEquals } from "jsr:@std/assert@1";
import { listTime, previewText } from "../../apps/web/src/convList.ts";

const now = new Date(2026, 10, 9, 13, 45);
Deno.test("list time: today HH:MM, yesterday I går, older date (browser-local)", () => {
  assertEquals(listTime(new Date(2026, 10, 9, 8, 5).toISOString(), "da", now), "08.05");
  assertEquals(listTime(new Date(2026, 10, 9, 0, 1).toISOString(), "en", now), "00:01");
  assertEquals(listTime(new Date(2026, 10, 8, 23, 59).toISOString(), "da", now), "I går");
  assertEquals(listTime(new Date(2026, 10, 8, 0, 0).toISOString(), "en", now), "Yesterday");
  assertEquals(listTime(new Date(2026, 10, 7, 12, 0).toISOString(), "da", now), "07.11.26");
  assertEquals(listTime(null, "da", now), "");
  assertEquals(listTime("not a date", "da", now), "");
});
Deno.test("list time: yesterday across month boundary", () => {
  assertEquals(listTime(new Date(2026, 9, 31, 22, 0).toISOString(), "da", new Date(2026, 10, 1, 9, 0)), "I går");
});
Deno.test("preview: own prefix, line breaks collapsed", () => {
  assertEquals(previewText({ last_at: "x", last_body: "Hej\nmed  dig", last_mine: true, members: 2 }, true), "Dig: Hej med dig");
  assertEquals(previewText({ last_at: "x", last_body: "Hi", last_mine: true }, false), "You: Hi");
});
Deno.test("preview: sender name only in groups", () => {
  assertEquals(previewText({ last_at: "x", last_body: "Hej", last_mine: false, members: 2, last_sender_name: "Maya" }, true), "Hej");
  assertEquals(previewText({ last_at: "x", last_body: "Hej", last_mine: false, members: 3, last_sender_name: "Maya" }, true), "Maya: Hej");
});
Deno.test("preview: attachments", () => {
  assertEquals(previewText({ last_at: "x", last_body: null, last_att_mime: "image/png" }, true), "📷 Billede");
  assertEquals(previewText({ last_at: "x", last_body: "Ugeplan", last_att_mime: "image/jpeg" }, true), "📷 Ugeplan");
  assertEquals(previewText({ last_at: "x", last_body: null, last_att_mime: "application/pdf", last_mine: true }, true), "Dig: 📎 PDF");
});
Deno.test("preview: nothing visible gives null", () => {
  assertEquals(previewText({ last_at: null, last_body: "skjult" }, true), null);
  assertEquals(previewText({}, true), null);
});
Deno.test("Home uses v2 list with v1 fallback and keeps nickname + colour", async () => {
  const a = await Deno.readTextFile("apps/web/src/App.tsx");
  for (const s of ['rpc("list_my_conversations_v2")', 'rpc("list_my_conversations")', "rename(c.others)", "<ColorDot", "previewText(", "listTime("]) if (!a.includes(s)) throw new Error("missing " + s);
});
Deno.test("Status bar and manifest are black", async () => {
  const h = await Deno.readTextFile("apps/web/index.html");
  const m = JSON.parse(await Deno.readTextFile("apps/web/public/manifest.webmanifest"));
  for (const f of ["apps/web/index.html", "apps/web/tjek.html"]) {
    const x = await Deno.readTextFile(f);
    const metas = [...x.matchAll(/<meta name="theme-color"[^>]*>/g)].map(m => m[0]);
    if (metas.length !== 3 || !metas.every(m => m.includes('content="#000000"'))) throw new Error("theme-color " + f);
    if (!metas.some(m => m.includes("(prefers-color-scheme: dark)")) || !metas.some(m => m.includes("(prefers-color-scheme: light)"))) throw new Error("media " + f);
  }
  if (!h.includes('apple-mobile-web-app-status-bar-style" content="black"')) throw new Error("ios status bar");
  assertEquals(m.theme_color, "#000000"); assertEquals(m.background_color, "#000000");
});
