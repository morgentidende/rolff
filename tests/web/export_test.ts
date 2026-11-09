import { csvCell, findHits } from "../../apps/web/src/exportUtil.ts";
const eq = (a: unknown, b: unknown) => { if (JSON.stringify(a) !== JSON.stringify(b)) throw new Error(`${JSON.stringify(a)} != ${JSON.stringify(b)}`); };
Deno.test("CSV: formelinjektion neutraliseres", () => {
  eq(csvCell("=HYPERLINK(\"x\")"), `"'=HYPERLINK(""x"")"`);
  for (const p of ["+1", "-2", "@SUM(A1)", "\tx", "\rx"]) eq(csvCell(p).startsWith(`"'`), true);
  eq(csvCell("Hej, \"du\""), `"Hej, ""du"""`);
});
Deno.test("Søgning finder kun hits i synlige beskeder", () => {
  eq(findHits(["Hent kl 16", "ok", "HENT tasken"], "hent"), [0, 2]);
  eq(findHits(["a"], "  "), []);
});
import { crc32, makeZip, myDataFiles } from "../../apps/web/src/exportUtil.ts";
Deno.test("ZIP: gyldig signatur, CRC32 og filnavne", () => {
  eq(crc32(new TextEncoder().encode("123456789")), 0xcbf43926);
  const z = makeZip([{ name: "a.txt", data: "hej" }, { name: "b.csv", data: "x" }]);
  eq([z[0], z[1], z[2], z[3]], [0x50, 0x4b, 3, 4]);
  const tail = new DataView(z.buffer, z.length - 22); eq(tail.getUint32(0, true), 0x06054b50); eq(tail.getUint16(10, true), 2);
});
Deno.test("Mine data: CSV med BOM, formel-escaping, kun input-data", () => {
  const f = myDataFiles({ account: { email: "me@x.test" }, conversations: [{ conversation_id: "c", messages: [{ created_at: "t", from: "me", text: "=1+1" }] }], feedback: [] });
  const m = f.find((x) => x.name === "messages.csv")!.data;
  eq(m.charCodeAt(0), 0xfeff); eq(m.includes(`"'=1+1"`), true);
  eq(f.some((x) => x.name === "rolff-data.json"), true);
});
