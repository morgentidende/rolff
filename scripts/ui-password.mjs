// Browser check (mobile size) of password eye + repeat field. Usage: SITE=https://... node scripts/ui-password.mjs (needs playwright)
// Never submits a valid signup; uses a synthetic invite token for the invite landing check.
import { chromium } from "playwright";
const SITE = process.env.SITE; let n = 0, fail = 0;
const ok = (c, m) => { n++; if (!c) fail++; console.log(`${c ? "ok" : "FEJL"} - ${m}`); };
const b = await chromium.launch();
for (const [locale, show, hide, mism] of [["da-DK", "Vis kodeord", "Skjul kodeord", "Kodeordene er ikke ens"], ["en-US", "Show password", "Hide password", "do not match"]]) {
  const p = await b.newPage({ viewport: { width: 390, height: 844 }, locale, hasTouch: true, isMobile: true });
  await p.goto(SITE); await p.evaluate(() => { localStorage.clear(); sessionStorage.clear(); }); await p.reload(); await p.waitForSelector("#p");
  const eye = p.getByRole("button", { name: show });
  ok(await p.getAttribute("#p", "type") === "password" && await p.getAttribute("#p", "autocomplete") === "current-password", `${locale} login: skjult + autocomplete`);
  await p.fill("#p", "x"); await eye.tap();
  ok(await p.getAttribute("#p", "type") === "text", `${locale} login: øjet viser kodeord`);
  const eye2 = p.getByRole("button", { name: hide });
  ok(await eye2.getAttribute("aria-pressed") === "true", `${locale} login: aria-pressed=true + label "${hide}"`);
  await eye2.tap(); ok(await p.getAttribute("#p", "type") === "password", `${locale} login: øjet skjuler igen`);
  await p.locator("button.ghost", { hasText: locale === "da-DK" ? "Opret konto" : "Create account" }).tap();
  ok(await p.locator("#p2").count() === 1 && await p.getAttribute("#p2", "autocomplete") === "new-password", `${locale} signup: gentag-felt findes`);
  ok(await p.locator(".pw button.eye").count() === 2, `${locale} signup: øje på begge felter`);
  await p.fill("#n", "UI Test"); await p.fill("#e", "ui-test@rolff-test.invalid"); await p.fill("#p", "hemmelig1"); await p.fill("#p2", "hemmelig2");
  await p.locator("input[type=checkbox]").check();
  let posted = false; p.on("request", (r) => { if (r.url().includes("/auth/v1/signup")) posted = true; });
  await p.locator("button[type=submit]").tap(); await p.waitForTimeout(1000);
  ok(!posted && (await p.getByText(mism).count()) > 0, `${locale} signup: uens kodeord afvises med fejltekst, intet sendt`);
  await p.goto(SITE + "#invite=" + "ab".repeat(24)); await p.waitForSelector("#p");
  await p.close();
}
await b.close(); console.log(`\n${n - fail}/${n} bestået`); process.exit(fail ? 1 : 0);
