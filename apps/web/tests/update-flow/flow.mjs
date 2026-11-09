// Headless update-flow test. Server emulates Hostinger: mode "none" = today's
// production (no Cache-Control on HTML, old Last-Modified -> heuristic caching);
// mode "htaccess" = the rules in public/.htaccess.
import http from "node:http"; import crypto from "node:crypto"; import fs from "node:fs"; import path from "node:path";
import { chromium } from "playwright-core";
const types = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".json": "application/json", ".webmanifest": "text/plain", ".png": "image/png", ".svg": "image/svg+xml", ".ico": "image/x-icon" };
function serve(state) {
  const srv = http.createServer((req, res) => {
    const u = new URL(req.url, "http://x"); let p = u.pathname === "/" ? "/index.html" : u.pathname;
    state.log.push(p);
    const dir = (p.endsWith(".html") && state.staleHtml) ? state.staleHtml : state.root;
    const f = path.join(dir, p);
    if (!fs.existsSync(f) || fs.statSync(f).isDirectory()) { res.writeHead(404); return res.end(); }
    const ext = path.extname(f); const body = fs.readFileSync(f);
    const h = { "content-type": types[ext] || "application/octet-stream", "last-modified": new Date(Date.now() - 2 * 864e5).toUTCString(), etag: `"${crypto.createHash("sha1").update(body).digest("hex")}"` };
    if (state.mode === "htaccess") {
      if (/\.(html|webmanifest|json)$/.test(p)) h["cache-control"] = "no-cache, must-revalidate";
      else if (p.startsWith("/assets/")) h["cache-control"] = "public, max-age=31536000, immutable";
    } else if (p.startsWith("/assets/")) h["cache-control"] = "public, max-age=604800";
    if (req.headers["if-none-match"] === h.etag) { res.writeHead(304, h); return res.end(); }
    res.writeHead(200, h); res.end(body);
  });
  return new Promise((r) => srv.listen(0, "127.0.0.1", () => r(srv)));
}
export { serve };
async function scenario(name, { mode, v1, v2, staleHtml }) {
  const state = { mode, root: v1, log: [] };
  const srv = await serve(state); const url = `http://127.0.0.1:${srv.address().port}/?source=pwa`;
  const ctx = await chromium.launchPersistentContext(fs.mkdtempSync("/tmp/pwprof-"), { executablePath: CHROME, headless: true });
  let navs = 0;
  let page = await ctx.newPage(); await page.goto(url); await page.waitForTimeout(1500);
  const before = await page.title(); await page.close();             // "close the app"
  state.root = v2; if (staleHtml) state.staleHtml = staleHtml;         // deploy v2
  state.log = [];
  page = await ctx.newPage(); page.on("framenavigated", (f) => { if (f === page.mainFrame()) navs++; });
  await page.goto(url);                                                // "reopen"
  await page.waitForTimeout(4000);
  const after = await page.title();
  const build = await page.evaluate(() => [...document.scripts].map((s) => s.src).find((s) => s.includes("main-")));
  await ctx.close(); srv.close();
  const htmlHits = state.log.filter((p) => p.endsWith("index.html")).length;
  console.log(JSON.stringify({ name, before, after, navigations: navs, indexHtmlRequestsAfterReopen: htmlHits, script: build?.split("/").pop() }));
}
// Builds: V/<old|new>-v<1|2> = dist of main (old) / this branch (new), see README.
const V = process.env.UPDATE_FLOW_BUILDS || "/tmp/vt";
const CHROME = process.env.CHROME || "/usr/bin/google-chrome";
await scenario("A today: old code, no headers (bug repro)", { mode: "none", v1: `${V}/old-v1`, v2: `${V}/old-v2` });
await scenario("B fix code only (no headers): version.json safety net", { mode: "none", v1: `${V}/new-v1`, v2: `${V}/new-v2` });
await scenario("C full fix: .htaccess headers + new code", { mode: "htaccess", v1: `${V}/new-v1`, v2: `${V}/new-v2` });
await scenario("D loop guard: server keeps serving stale v1 HTML but version.json says v2", { mode: "none", v1: `${V}/new-v1`, v2: `${V}/new-v2`, staleHtml: `${V}/new-v1` });
await (async function resume() {
  const state = { mode: "htaccess", root: `${V}/new-v1`, log: [] };
  const srv = await serve(state); const url = `http://127.0.0.1:${srv.address().port}/?source=pwa`;
  const ctx = await chromium.launchPersistentContext(fs.mkdtempSync("/tmp/pwprof-"), { executablePath: CHROME, headless: true });
  const page = await ctx.newPage(); await page.goto(url); await page.waitForTimeout(1500);
  const before = await page.title(); state.root = `${V}/new-v2`;
  await page.waitForTimeout(10500);
  await page.evaluate(() => { Object.defineProperty(document, "visibilityState", { value: "visible", configurable: true }); document.dispatchEvent(new Event("visibilitychange")); });
  await page.waitForTimeout(3000);
  console.log(JSON.stringify({ name: "E app left open in background, new deploy, brought back to front", before, after: await page.title() }));
  await ctx.close(); srv.close();
})();
