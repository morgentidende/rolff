import { csvCell, findHits, toCsv } from "../../apps/web/src/exportUtil.ts";
const eq = (a: unknown, b: unknown) => { if (JSON.stringify(a) !== JSON.stringify(b)) throw new Error(`${JSON.stringify(a)} != ${JSON.stringify(b)}`); };
Deno.test("CSV: formelinjektion neutraliseres", () => {
  eq(csvCell("=HYPERLINK(\"x\")"), `"'=HYPERLINK(""x"")"`);
  for (const p of ["+1", "-2", "@SUM(A1)", "\tx", "\rx"]) eq(csvCell(p).startsWith(`"'`), true);
  eq(csvCell("Hej, \"du\""), `"Hej, ""du"""`);
});
Deno.test("CSV: BOM, CRLF og header med eksportør og dato", () => {
  const c = toCsv([{ sender: "Dig", time: "01.11.2026 10.00", text: "æøå\nlinje 2" }], "a@x.test", "1. november 2026", "da");
  eq(c.charCodeAt(0), 0xfeff);
  eq(c.includes("Eksporteret af a@x.test"), true);
  eq(c.includes("1. november 2026"), true);
  eq(c.split("\r\n").length, 4);
  eq(c.includes('"æøå\nlinje 2"'), true);
});
Deno.test("Søgning finder kun hits i synlige beskeder", () => {
  eq(findHits(["Hent kl 16", "ok", "HENT tasken"], "hent"), [0, 2]);
  eq(findHits(["a"], "  "), []);
});
