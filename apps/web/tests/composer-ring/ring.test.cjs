// Geometry/visual test: the countdown ring around the Send button is exactly concentric with the round button
// at several device pixel ratios, widths, font scales and in light + dark. Synthetic fixture, loopback only.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { findChrome, startVite, startChrome, decodePng, webRoot } = require('./support.cjs');

const read = (f) => fs.readFileSync(path.join(webRoot, 'src', f), 'utf8');
const css = read('styles.css');
const tsx = read('ComposerInput.tsx');

test('ring CSS/markup: laid out against the button box, inset fixed, no transform/offset drift', () => {
  const rule = (sel) => { const m = css.match(new RegExp(sel.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '\\{([^}]*)\\}')); assert.ok(m, sel); return m[1]; };
  const btn = rule('.composer-send.is-countdown');
  assert.match(btn, /position:relative/); assert.match(btn, /padding:0/);
  const face = rule('.send-now-face'); const ring = rule('.send-now-ring'); const stack = rule('.send-now-stack');
  for (const r of [face, ring, stack]) { assert.match(r, /position:absolute/); assert.match(r, /inset:0/); assert.doesNotMatch(r, /transform|margin|translate|top:|left:/); }
  assert.match(ring, /width:100%/); assert.match(ring, /height:100%/);
  assert.doesNotMatch(css.match(/\.send-now-count\{[^}]*\}/)[0], /margin/);
  // Pulse must not use a transform (it used to scale the whole button).
  assert.doesNotMatch(css.match(/@keyframes send-now-pulse\{.*\}\}/)[0], /transform/);
  // Circle centre = viewBox centre; the stroke stays inside the button box.
  const vb = +tsx.match(/RING_VIEWBOX = (\d+)/)[1], r = +tsx.match(/RING_R = ([\d.]+)/)[1], sw = +tsx.match(/RING_STROKE = ([\d.]+)/)[1];
  assert.equal(vb, 48); assert.match(css, new RegExp(`stroke-width:${sw}[;,}]`));
  assert.ok(r + sw / 2 <= vb / 2 && vb / 2 - (r + sw / 2) >= 1, 'stroke fully inside the 48px button with >= 1px inset');
  assert.match(tsx, /cx=\{RING_VIEWBOX \/ 2\} cy=\{RING_VIEWBOX \/ 2\}/);
  assert.match(tsx, /rotate\(-90 \$\{RING_VIEWBOX \/ 2\} \$\{RING_VIEWBOX \/ 2\}\)/);
});

const chrome = findChrome();
if (!chrome && process.env.CI === 'true') throw new Error('Chrome is required in CI for the ring geometry test');

test('ring geometry in a real browser: centre, inset and size match the button (DPR 1-3, widths, font scale, themes)', { skip: !chrome && 'no Chrome available', timeout: 120000 }, async () => {
  const vite = await startVite(); let br = null;
  try {
    br = await startChrome(chrome);
    const cases = [];
    for (const theme of ['light', 'dark']) for (const dpr of [1, 2, 2.625, 3]) for (const width of [360, 390]) cases.push({ theme, dpr, width, scale: 1 });
    cases.push({ theme: 'light', dpr: 2.75, width: 390, scale: 1.3 }, { theme: 'dark', dpr: 3, width: 360, scale: 1.5 });
    for (const c of cases) {
      await br.open({ url: `${vite.url}/delayed-send-fixture.html?lang=da&theme=${c.theme}`, width: c.width, height: 844, dpr: c.dpr });
      await br.evaluate(`(() => { const s = document.createElement('style'); s.textContent = \`
        html{font-size:${c.scale * 100}% !important} *{animation:none !important;transition:none !important}
        .send-now-ring-track,.send-now-ring-value{stroke:#f00 !important;stroke-dashoffset:0 !important}
        .send-now-stack{visibility:hidden !important}\`; document.head.appendChild(s); document.querySelector('.composer-send').scrollIntoView(); })()`);
      await new Promise((r) => setTimeout(r, 200));
      const g = JSON.parse(await br.evaluate(`JSON.stringify((() => {
        const b = document.querySelector('.composer-send.is-countdown'); const svg = b.querySelector('.send-now-ring'); const circ = b.querySelector('.send-now-ring-track');
        const R = (e) => { const r = e.getBoundingClientRect(); return { x: r.x, y: r.y, w: r.width, h: r.height }; };
        return { btn: R(b), svg: R(svg), circ: R(circ), vw: innerWidth };
      })())`));
      const tag = JSON.stringify(c);
      const cx = (r) => r.x + r.w / 2, cy = (r) => r.y + r.h / 2;
      assert.ok(Math.abs(g.btn.w - 48) < 0.01 && Math.abs(g.btn.h - 48) < 0.01, 'button is 48px round ' + tag);
      assert.ok(Math.abs(cx(g.svg) - cx(g.btn)) < 0.05 && Math.abs(cy(g.svg) - cy(g.btn)) < 0.05, 'svg centre = button centre ' + tag);
      assert.ok(Math.abs(g.svg.w - g.btn.w) < 0.05 && Math.abs(g.svg.h - g.btn.h) < 0.05, 'svg fills the button ' + tag);
      assert.ok(Math.abs(cx(g.circ) - cx(g.btn)) < 0.05 && Math.abs(cy(g.circ) - cy(g.btn)) < 0.05, 'circle centre = button centre ' + tag);
      // Pixel check: only the ring is red; its weighted centroid and four insets must match the button.
      const pad = 6; const clip = { x: Math.floor(g.btn.x - pad), y: Math.floor(g.btn.y - pad), width: 48 + 2 * pad + 2, height: 48 + 2 * pad + 2 };
      const png = decodePng(await br.shot(clip)); const k = c.dpr;
      let sum = 0, sx = 0, sy = 0, minx = 1e9, maxx = -1, miny = 1e9, maxy = -1;
      for (let y = 0; y < png.h; y++) for (let x = 0; x < png.w; x++) {
        const o = (y * png.w + x) * png.bpp; const r = png.data[o], gg = png.data[o + 1], b = png.data[o + 2];
        const wgt = Math.max(0, Math.min(1, (r - Math.max(gg, b)) / 200)); if (wgt < 0.02) continue;
        sum += wgt; sx += wgt * (x + 0.5); sy += wgt * (y + 0.5);
        if (wgt > 0.5) { minx = Math.min(minx, x); maxx = Math.max(maxx, x + 1); miny = Math.min(miny, y); maxy = Math.max(maxy, y + 1); }
      }
      assert.ok(sum > 50, 'ring pixels found ' + tag);
      const ox = clip.x * k, oy = clip.y * k; // clip origin is css px, so convert; Chrome clips on css px with scale 1 -> output is css*dpr
      const centreX = (g.btn.x - clip.x) * k + 24 * k, centreY = (g.btn.y - clip.y) * k + 24 * k;
      const ringCx = sx / sum, ringCy = sy / sum;
      assert.ok(Math.abs(ringCx - centreX) <= 0.75 && Math.abs(ringCy - centreY) <= 0.75, `ring pixel centroid off by (${(ringCx - centreX).toFixed(2)}, ${(ringCy - centreY).toFixed(2)}) device px ${tag}`);
      const left = minx - (g.btn.x - clip.x) * k, right = (g.btn.x - clip.x) * k + 48 * k - maxx, top = miny - (g.btn.y - clip.y) * k, bottom = (g.btn.y - clip.y) * k + 48 * k - maxy;
      const ins = [left, right, top, bottom];
      assert.ok(Math.max(...ins) - Math.min(...ins) <= 1.5, `unequal insets ${ins.map((v) => v.toFixed(2))} ${tag}`);
      assert.ok(ins.every((v) => v / k >= 0.9 && v / k <= 2.4), `inset should be ~1.5 css px, got ${ins.map((v) => (v / k).toFixed(2))} ${tag}`);
      void ox; void oy;
    }
  } finally { if (br) br.close(); await vite.close(); }
});
