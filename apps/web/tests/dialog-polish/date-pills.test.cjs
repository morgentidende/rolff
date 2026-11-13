// Date-pill overlap: one sticky pill at a time, sitting below the pending-approval banner.
// Mocked messages only. The scroll simulation reproduces the sibling-sticky overlap and
// checks that section-wrapped pills never stack while scrolling across several days.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { env, delay, click } = require('../back-navigation/support.cjs');

const uid = '10000000-0000-4000-8000-000000000001';
const other = '30000000-0000-4000-8000-000000000001';

function iso(y, mo, d, h, mi) {
  return new Date(y, mo, d, h, mi).toISOString();
}

function fakeMsgs() {
  // Several local calendar days so the conversation is long enough to scroll.
  const days = [
    [2026, 10, 6, ['En opdigtet fredagsbesked.', 'En anden opdigtet fredagsbesked, lidt længere så der er noget at rulle forbi.']],
    [2026, 10, 9, ['Mandagens første testbesked.', 'Ok', 'En kort test.', 'Endnu en opdigtet besked mandag eftermiddag.']],
    [2026, 10, 12, ['En opdigtet besked fra i går.', 'Svar på den opdigtede besked.']],
    [2026, 10, 13, ['En opdigtet besked fra i dag.']],
  ];
  const out = [];
  let n = 1;
  for (const [y, mo, d, bodies] of days) {
    bodies.forEach((body, i) => {
      const mine = i % 2 === 1;
      out.push({
        id: `40000000-0000-4000-8000-${String(n).padStart(12, '0')}`,
        sender_id: mine ? uid : other,
        sender_email: mine ? 'tester@example.invalid' : 'kontakt@example.invalid',
        body,
        created_at: iso(y, mo, d, 12 + i, 10),
        mine,
      });
      n += 1;
    });
  }
  return out;
}

const invites = [
  { id: '50000000-0000-4000-8000-000000000001', role: 'member', invitee_email: 'ny@example.invalid', consents: 1, required: 2, i_consented: true, mine: true },
  { id: '50000000-0000-4000-8000-000000000002', role: 'member', invitee_email: 'anden@example.invalid', consents: 0, required: 2, i_consented: false, mine: false },
];

test('Day groups wrap each sticky pill; pending banner stays outside the scroll area', { timeout: 8000 }, async () => {
  const fx = await env(false); const { w, d } = fx;
  try {
    w.__QA_FIXTURE = { messages: fakeMsgs(), invites };
    await click(d.querySelector('.convbtn')); await delay(60);
    const msgs = d.querySelector('.msgs');
    const groups = [...msgs.querySelectorAll(':scope > .day-group')];
    assert.equal(groups.length, 4, 'one section per day');
    assert.ok(groups.every((g) => g.querySelectorAll(':scope > .day-sep').length === 1), 'one pill per day');
    assert.equal(msgs.querySelectorAll(':scope > .day-sep').length, 0, 'pills are not direct children of the scroller');
    const labels = groups.map((g) => g.querySelector('.day-sep').getAttribute('aria-label'));
    assert.ok(labels.includes('I dag') && labels.includes('I går') && labels.includes('Mandag'), labels.join(','));
    const pend = d.querySelector('.pendbar');
    assert.ok(pend, 'pending banner is shown');
    assert.match(pend.textContent, /2 afventer godkendelse/);
    assert.ok(!msgs.contains(pend), 'banner is not inside the scrolling message list');
    assert.equal(pend.compareDocumentPosition(msgs) & 4, 4, 'banner sits above the messages');
  } finally { await fx.close(); }
});

// Headless scroll over several days: model CSS sticky.
// Sibling stickies (the bug) share one containing block, so every reached pill
// stays pinned at `top` and they overlap. Section-wrapped stickies are clipped
// to their day, so the next pill pushes the previous one away.
function pillBoxes(sections, scrollTop, stickTop) {
  return sections.map((s) => {
    let top = s.start - scrollTop;
    if (top < stickTop) top = stickTop;
    const maxTop = s.end - scrollTop - s.pill;
    if (top > maxTop) top = maxTop;
    const bottom = top + s.pill;
    const visible = bottom > 0 && top < s.viewport && s.end - scrollTop > 0 && (s.start - scrollTop) < s.viewport;
    return { top, bottom, visible, label: s.label };
  });
}

function overlaps(boxes) {
  const vis = boxes.filter((b) => b.visible);
  const hits = [];
  for (let i = 0; i < vis.length; i++) {
    for (let j = i + 1; j < vis.length; j++) {
      if (vis[i].top < vis[j].bottom && vis[i].bottom > vis[j].top) hits.push([vis[i].label, vis[j].label]);
    }
  }
  return hits;
}

function daysToSections(dayHeights, pill, viewport, stickTop, grouped) {
  let y = 8;
  return dayHeights.map((content, i) => {
    const start = y;
    const end = grouped ? start + pill + content : dayHeights.reduce((a, h) => a + pill + h, 8);
    y += pill + content;
    return { start, end, pill, viewport, label: `day-${i}`, stickTop };
  });
}

test('Headless scroll over several days: section stickies never overlap; sibling stickies do', () => {
  const pill = 24, viewport = 400, stickTop = 8;
  const dayHeights = [180, 260, 160, 140, 200]; // five days of mocked content
  const end = 8 + dayHeights.reduce((a, h) => a + pill + h, 0);
  let bugHits = 0, fixHits = 0;
  const bugSample = [], fixSample = [];
  for (let scrollTop = 0; scrollTop <= end; scrollTop += 4) {
    const bug = overlaps(pillBoxes(daysToSections(dayHeights, pill, viewport, stickTop, false), scrollTop, stickTop));
    const fix = overlaps(pillBoxes(daysToSections(dayHeights, pill, viewport, stickTop, true), scrollTop, stickTop));
    if (bug.length) { bugHits += 1; if (bugSample.length < 3) bugSample.push({ scrollTop, bug }); }
    if (fix.length) { fixHits += 1; if (fixSample.length < 3) fixSample.push({ scrollTop, fix }); }
  }
  assert.ok(bugHits > 10, `ungrouped stickies must overlap while scrolling (got ${bugHits} frames)`);
  assert.equal(fixHits, 0, `section-wrapped stickies must never overlap, but got ${JSON.stringify(fixSample)}`);
});
