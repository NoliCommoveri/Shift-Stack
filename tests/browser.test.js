/* The page actually loads. Run with:  npm test
 *
 * Everything else in tests/ requires the modules directly, which means every
 * one of them goes down a path the phone never takes. The browser loads nine
 * plain scripts into one shared scope instead, and that difference is not
 * academic: `merge.js` threw on every page load, because it looked for
 * sites.js's `whereKey` on `globalThis` and a top-level `const` is not a
 * property of the global object. 231 unit tests passed while the Setup screen
 * was dead, and this is the test that noticed.
 *
 * Skipped, not failed, when Playwright or a browser is not installed — the
 * app has no build step and no dependencies, and `npm test` has to keep
 * working on a machine that has not downloaded a browser to run it.
 */
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');

function chromium(){
  let pw;
  try { pw = require('playwright'); } catch { return null; }
  // The bundled default first, then whatever PLAYWRIGHT_BROWSERS_PATH holds —
  // a preinstalled browser is often a different build than this Playwright
  // expects, and launching it by path is the documented way through that.
  const candidates = [undefined];
  const base = process.env.PLAYWRIGHT_BROWSERS_PATH;
  if(base && fs.existsSync(base)){
    for(const d of fs.readdirSync(base).filter(d => d.startsWith('chromium-'))){
      const exe = path.join(base, d, 'chrome-linux', 'chrome');
      if(fs.existsSync(exe)) candidates.push(exe);
    }
  }
  return { pw, candidates };
}

async function open(){
  const found = chromium();
  if(!found) return null;
  for(const executablePath of found.candidates){
    try {
      const browser = await found.pw.chromium.launch(executablePath ? { executablePath } : {});
      return browser;
    } catch { /* try the next one */ }
  }
  return null;
}

test('the app loads with no uncaught errors, and writes a real calendar', async (t) => {
  const browser = await open();
  if(!browser) return t.skip('no Playwright browser available');

  try {
    const page = await browser.newPage();
    const errors = [];
    page.on('pageerror', e => errors.push(e.message));
    page.on('console', m => {
      // A file:// page cannot register a service worker; that failure is the
      // environment, not the app.
      if(m.type() === 'error' && !/ERR_|service worker|Failed to load resource/i.test(m.text()))
        errors.push(m.text());
    });

    await page.goto('file://' + path.join(ROOT, 'index.html'));
    // Bare `S`, not `window.S` — app.js declares it with `let`, so it is a
    // global lexical binding and not a property of the window. Getting this
    // wrong is the same mistake the test exists to catch.
    await page.waitForFunction(() => typeof S === 'object' && S !== null, null, { timeout: 15000 });

    // Every collaborator the extracted modules reach for has to have resolved.
    // This is the assertion that `const` versus `function` broke.
    const wired = await page.evaluate(() => ({
      feedICS: typeof feedICS, mergeCalendar: typeof mergeCalendar,
      icsFold: typeof icsFold, whereKey: typeof whereKey, buildICS: typeof buildICS
    }));
    assert.deepEqual(wired, { feedICS: 'function', mergeCalendar: 'function',
                              icsFold: 'function', whereKey: 'function', buildICS: 'function' });

    // The Setup screen's Server section exists and says something true.
    await page.click('nav button[data-tab="setup"]');
    const setup = await page.evaluate(() => ({
      token: !!document.getElementById('pushtoken'),
      migrate: !!document.getElementById('srvmigrate'),
      note: (document.getElementById('srvnote') || {}).textContent || ''
    }));
    assert.ok(setup.token && setup.migrate, 'the Server section is on the page');
    assert.match(setup.note, /No push token yet/);

    // And the file the page writes is a calendar, not a row of stringified
    // objects — §31's bug, asserted where it actually happened.
    const ics = await page.evaluate(() => {
      S.companies = [{ id: 'c1', name: 'Trupoint', color: '#333' }];
      S.sites = [{ id: 's1', companyId: 'c1', name: 'Rosemont', address: '9501 W Devon' }];
      S.roles = [{ id: 'r1', companyId: 'c1', name: 'Security Officer' }];
      S.settings.leads = [2];
      S.shifts = [{ id: 'sh1', companyId: 'c1', date: '2026-09-04', start: '19:00', end: '07:00',
                    siteId: 's1', roleId: 'r1', label: 'Security Officer @ Rosemont' }];
      return buildICS(S.shifts);
    });
    assert.ok(!/\[object /.test(ics), 'no property line is a stringified object');
    assert.match(ics, /\r\nUID:sh1@shiftdeck\r\n/);
    assert.match(ics, /\r\nSUMMARY:[^\r\n]*Rosemont/);
    assert.match(ics, /\r\nLOCATION:[^\r\n]*Devon/);
    assert.match(ics, /\r\nDTEND:20260905T070000\r\n/);
    assert.match(ics, /\r\nTRIGGER:-PT2H\r\n/);

    assert.deepEqual(errors, [], 'the page loaded with no uncaught errors');
  } finally {
    await browser.close();
  }
});

/* §14.7's pass two, and the setting the cron cannot run without.
 *
 * Both are page-only: `icsFeed` is written by a checkbox and read by
 * worker/guards.js, and `pullFromServer` merges two lists using `applyNames`,
 * `S` and `renderAll` — none of which exist outside a loaded page. The unit
 * tests cannot reach either, and the gap between them was a Worker that
 * refused every fifteen minutes while 243 tests passed.
 */
test('the feed job can be ticked, and only one job at a time', async (t) => {
  const browser = await open();
  if(!browser) return t.skip('no Playwright browser available');

  try {
    const page = await browser.newPage();
    const errors = [];
    page.on('pageerror', e => errors.push(e.message));
    await page.goto('file://' + path.join(ROOT, 'index.html'));
    await page.waitForFunction(() => typeof S === 'object' && S !== null, null, { timeout: 15000 });

    await page.click('nav button[data-tab="setup"]');
    await page.click('#addco');
    await page.click('#addco');

    // The checkbox is on the card, whatever fold it is sitting in.
    const boxes = await page.evaluate(() =>
      document.querySelectorAll('input[data-k="icsFeed"]').length);
    assert.equal(boxes, 2, 'every job offers the tick');

    // Ticked through the handler the page actually binds, not by assignment.
    const one = await page.evaluate(() => {
      const b = document.querySelectorAll('input[data-k="icsFeed"]')[0];
      b.checked = true; b.dispatchEvent(new Event('input', { bubbles: true }));
      return S.companies.map(c => !!c.icsFeed);
    });
    assert.deepEqual(one, [true, false]);

    // Ticking the other releases the first. Two ticked would leave `feedJob`
    // to choose by store order and say nothing about having chosen.
    const two = await page.evaluate(() => {
      const b = document.querySelectorAll('input[data-k="icsFeed"]')[1];
      b.checked = true; b.dispatchEvent(new Event('input', { bubbles: true }));
      return S.companies.map(c => !!c.icsFeed);
    });
    assert.deepEqual(two, [false, true]);

    // And the tick survives the redraw it triggers, which is the part that
    // would break silently: the handler rewrites the whole Setup screen.
    const drawn = await page.evaluate(() =>
      [...document.querySelectorAll('input[data-k="icsFeed"]')].map(b => b.checked));
    assert.deepEqual(drawn, [false, true], 'the redrawn boxes agree with the store');

    // With a token and nothing ticked, Setup says so rather than waiting six
    // hours for the Worker to report the symptom.
    const warned = await page.evaluate(() => {
      S.companies.forEach(c => { c.icsFeed = false; });
      S.settings.pushToken = 'tok';
      renderSetup();
      const a = document.getElementById('srvalarm');
      return { hidden: a.hidden, text: a.textContent };
    });
    assert.equal(warned.hidden, false);
    assert.match(warned.text, /No job is set for the server to poll/);

    assert.deepEqual(errors, [], 'the page loaded with no uncaught errors');
  } finally {
    await browser.close();
  }
});

test('the server\u2019s shifts are read back down, and are read only here', async (t) => {
  const browser = await open();
  if(!browser) return t.skip('no Playwright browser available');

  try {
    const page = await browser.newPage();
    const errors = [];
    page.on('pageerror', e => errors.push(e.message));
    await page.goto('file://' + path.join(ROOT, 'index.html'));
    await page.waitForFunction(() => typeof S === 'object' && S !== null, null, { timeout: 15000 });

    const after = await page.evaluate(async () => {
      S.companies = [{ id: 'c1', name: 'Trupoint', color: '#333' },
                     { id: 'c2', name: 'DSI', color: '#666', icsFeed: true }];
      S.sites = [{ id: 's2', companyId: 'c2', name: 'Rosemont', address: '9501 W Devon', names: ['Rosemont'] }];
      S.settings.pushToken = 'tok';
      // What this phone owns: one typed shift and one stale row from an
      // earlier fetch. Only the second is the server's to replace.
      S.shifts = [
        { id: 'mine', companyId: 'c1', date: '2026-09-07', start: '19:00', end: '07:00',
          label: 'Station', source: 'ocr', sent: true },
        { id: 'old',  companyId: 'c2', date: '2026-09-01', start: '08:00', end: '16:00',
          label: 'Rosemont', source: 'feed' }
      ];
      window.fetch = async () => ({
        ok: true, status: 200,
        json: async () => ({ shifts: [
          { id: 'f1', companyId: 'c2', date: '2026-09-09', start: '15:00', end: '23:00',
            label: 'Rosemont', source: 'feed', extUid: 'g1@google.com', seq: 0 }
        ] })
      });
      const n = await pullFromServer();
      return {
        n,
        ids: S.shifts.map(s => s.id).sort(),
        // Resolved against this phone's site table, not left as the text the
        // Worker matched against whatever cfg it last held.
        siteId: (S.shifts.find(s => s.id === 'f1') || {}).siteId,
        pulled: !!S.settings.lastPull
      };
    });

    assert.equal(after.n, 1);
    // The stale feed row is gone and the typed one is untouched: each side
    // replaces the column it owns, whole.
    assert.deepEqual(after.ids, ['f1', 'mine']);
    assert.equal(after.siteId, 's2', 'names are resolved again on arrival');
    assert.ok(after.pulled);

    // A server that has no tables yet is not a server saying "no shifts".
    const kept = await page.evaluate(async () => {
      window.fetch = async () => ({ ok: true, status: 200,
        json: async () => ({ needsSetup: true, shifts: [] }) });
      const n = await pullFromServer();
      return { n, ids: S.shifts.map(s => s.id).sort() };
    });
    assert.equal(kept.n, null);
    assert.deepEqual(kept.ids, ['f1', 'mine'], 'an unmigrated server deletes nothing');

    // `sent` is this phone's record of what it wrote into a calendar file, and
    // the server has never had an opinion about it. Dropped on every pull, the
    // same events would go into the next manual-import export and duplicate.
    const flags = await page.evaluate(async () => {
      S.shifts.find(s => s.id === 'f1').sent = true;
      window.fetch = async () => ({ ok: true, status: 200,
        json: async () => ({ shifts: [
          { id: 'f1', companyId: 'c2', date: '2026-09-09', start: '15:00', end: '23:00',
            label: 'Rosemont', source: 'feed', seq: 3 },
          { id: 'f2', companyId: 'c2', date: '2026-09-10', start: '15:00', end: '23:00',
            label: 'Rosemont', source: 'feed', seq: 0 }
        ] })
      });
      await pullFromServer();
      const by = id => S.shifts.find(s => s.id === id);
      return { keptSent: by('f1').sent, freshSent: by('f2').sent, seq: by('f1').seq };
    });
    assert.equal(flags.keptSent, true, 'a shift already exported stays exported');
    assert.equal(flags.freshSent, false, 'one the phone has never seen has not been sent');
    // `seq` is the Worker's, though: it is the one that bumps it when the
    // employer moves a shift, and a calendar may ignore a revision no newer
    // than the one it already holds (§22).
    assert.equal(flags.seq, 3, 'the revision number comes down from the server');

    // Opening a feed shift shows it and offers no way to change it — the next
    // poll would undo the edit within fifteen minutes.
    const dlg = await page.evaluate(() => {
      editShift('f1');
      const body = document.getElementById('dlgbody');
      return { text: body.textContent, save: !!document.getElementById('e-save'),
               del: !!document.getElementById('e-del'), close: !!document.getElementById('e-close') };
    });
    assert.equal(dlg.save, false, 'nothing here saves');
    assert.equal(dlg.del, false, 'nothing here deletes');
    assert.equal(dlg.close, true);
    assert.match(dlg.text, /read\s*only/i);
    assert.match(dlg.text, /9501 W Devon/, 'the address is still one tap away');

    // And it is marked on the Schedule, so the two kinds are told apart
    // without opening either.
    const marked = await page.evaluate(() => {
      renderSchedule();
      return document.getElementById('sched').innerHTML;
    });
    assert.match(marked, /class="fromfeed">from the calendar</);

    assert.deepEqual(errors, [], 'the page loaded with no uncaught errors');
  } finally {
    await browser.close();
  }
});
