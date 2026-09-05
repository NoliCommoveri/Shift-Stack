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
    // §39, on the path that matters: ics.js and feed.js are separate <script>
    // tags sharing one global scope, and `icsColor` has to have been found by
    // name there, not just by require in the unit tests.
    assert.match(ics, /\r\nCOLOR:darkslategray\r\n/);

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

/* §14.10, from the end that produced the symptom.
 *
 * The zone was designed as a per-job field and no input was ever built for
 * it, so `normalizeTimezone` in the Worker fell back to America/Toronto for
 * everybody. On a phone in Central that is every Homebase shift filed an hour
 * late — on the Schedule, in the pay figures, on the calendar and in the
 * alarms — and no screen disagreed, because they were all reading the same
 * wrong number. The page is the only place that knows which zone he is in, so
 * these assertions are here: the field exists, it starts as the phone's own,
 * and a server reading the feed on a different clock is said out loud.
 */
test('a job is born in the phone\u2019s own time zone, and a server on another says so', async (t) => {
  const browser = await open();
  if(!browser) return t.skip('no Playwright browser available');

  try {
    // The phone is in Central. That is the whole premise of the bug.
    const page = await browser.newPage({ timezoneId: 'America/Chicago' });
    const errors = [];
    page.on('pageerror', e => errors.push(e.message));
    await page.goto('file://' + path.join(ROOT, 'index.html'));
    await page.waitForFunction(() => typeof S === 'object' && S !== null, null, { timeout: 15000 });

    await page.click('nav button[data-tab="setup"]');
    await page.click('#addco');

    const born = await page.evaluate(() => ({
      stored: S.companies[0].zone,
      field: (document.querySelector('input[data-k="zone"]') || {}).value,
      note: (document.querySelector('.zonenote') || {}).textContent || ''
    }));
    assert.equal(born.stored, 'America/Chicago', 'a new job takes the phone\u2019s zone');
    assert.equal(born.field, 'America/Chicago', 'and the box on the screen shows it');
    assert.match(born.note, /America\/Chicago/);

    // A store written before the field existed. Filled on load rather than
    // asked about: an empty zone is the Worker's Eastern fallback, and the job
    // nobody opens is the one it costs the most.
    const filled = await page.evaluate(() => {
      delete S.companies[0].zone;
      fillZones();
      return S.companies[0].zone;
    });
    assert.equal(filled, 'America/Chicago');

    // Typed through the handler the page binds, not by assignment — and an
    // offset is refused in words rather than stored to be thrown away by the
    // Worker six hours later.
    const typed = await page.evaluate(() => {
      const box = document.querySelector('input[data-k="zone"]');
      box.value = 'UTC-6'; box.dispatchEvent(new Event('input', { bubbles: true }));
      return { stored: S.companies[0].zone,
               note: document.querySelector('.zonenote').textContent };
    });
    assert.equal(typed.stored, 'UTC-6');
    assert.match(typed.note, /not an IANA zone name/);

    // The line the whole fix hangs on: the server says which clock it reads
    // the feed on, and disagreeing with this phone is loud.
    const zoneLine = st => page.evaluate(s => {
      renderServer(s);
      const z = document.getElementById('srvzone');
      return { hidden: z.hidden, cls: z.className, text: z.textContent };
    }, st);

    await page.evaluate(() => {
      S.companies[0].zone = 'America/Chicago';
      S.companies[0].icsFeed = true;
    });

    const clash = await zoneLine({ shifts: {}, polls: [], zone: 'America/Toronto',
                                   zoneDefaulted: true, zoneSource: 'fallback' });
    assert.equal(clash.hidden, false);
    assert.equal(clash.cls, 'flag');
    assert.match(clash.text, /America\/Toronto/);
    assert.match(clash.text, /America\/Chicago/);
    assert.match(clash.text, /last resort/);

    // Told at deploy time and agreeing with the phone: quiet, and it still
    // says where the answer came from, because "the job has not pushed one
    // yet" is a thing worth knowing before the job's zone is changed.
    const told = await zoneLine({ shifts: {}, polls: [], zone: 'America/Chicago',
                                  zoneDefaulted: true, zoneSource: 'env' });
    assert.equal(told.hidden, false);
    assert.equal(told.cls, 'tiny soft');
    assert.match(told.text, /set on the Worker/);

    // Agreeing outright is quiet too, and still says which zone, because "an
    // hour out" is not a thing anybody notices without a number to check
    // against.
    const agreed = await zoneLine({ shifts: {}, polls: [], zone: 'America/Chicago',
                                    zoneDefaulted: false, zoneSource: 'job' });
    assert.equal(agreed.hidden, false);
    assert.equal(agreed.cls, 'tiny soft');
    assert.match(agreed.text, /read in America\/Chicago\.$/);

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

    // `sent` means "the calendar has this", and which calendar decides the
    // answer. Two shifts, one the phone has seen before and one it has not.
    const twoRows = () => ({ ok: true, status: 200,
      json: async () => ({ shifts: [
        { id: 'f1', companyId: 'c2', date: '2026-09-09', start: '15:00', end: '23:00',
          label: 'Rosemont', source: 'feed', seq: 3 },
        { id: 'f2', companyId: 'c2', date: '2026-09-10', start: '15:00', end: '23:00',
          label: 'Rosemont', source: 'feed', seq: 0 }
      ] })
    });

    // Subscription: the feed ICSx⁵ reads is built from the server's own rows,
    // so a shift that came from there is in the calendar already. Marked false,
    // the Schedule would warn about a shift the calendar was showing — a
    // permanent amber about nothing (§19.1).
    const sub = await page.evaluate(async (rows) => {
      S.settings.feedMode = 'subscribe';
      window.fetch = new Function('return ' + rows)();
      await pullFromServer();
      const by = id => S.shifts.find(s => s.id === id);
      return { f1: by('f1').sent, f2: by('f2').sent, seq: by('f1').seq };
    }, twoRows.toString().replace('twoRows', 'async function'));
    assert.equal(sub.f1, true);
    assert.equal(sub.f2, true, 'in subscription mode the server\u2019s feed already holds it');
    // `seq` is the Worker's either way: it is the one that bumps it when the
    // employer moves a shift, and a calendar may ignore a revision no newer
    // than the one it already holds (§22).
    assert.equal(sub.seq, 3, 'the revision number comes down from the server');

    // Manual import: the calendar is fed by files this phone writes, so the
    // local flag is the only record of whether one was in a file. Dropped, the
    // same events go into the next export and duplicate (§13).
    const imp = await page.evaluate(async (rows) => {
      S.settings.feedMode = 'import';
      S.shifts.find(s => s.id === 'f1').sent = true;
      S.shifts.find(s => s.id === 'f2').sent = false;
      window.fetch = new Function('return ' + rows)();
      await pullFromServer();
      const by = id => S.shifts.find(s => s.id === id);
      return { f1: by('f1').sent, f2: by('f2').sent };
    }, twoRows.toString().replace('twoRows', 'async function'));
    assert.equal(imp.f1, true, 'a shift already written into a file stays written');
    assert.equal(imp.f2, false, 'one that was never in a file has not been sent');

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

/* Shifts go out without the button.
 *
 * The failure this replaces is silent by nature — a shift added on a phone at
 * the end of twelve hours, never sent, and no alarm at five the next morning —
 * so what has to be asserted is not that a push happens but exactly when one
 * does not: nothing to say, and no marking on a write that failed.
 */
test('a change sends itself, and a failed send is not marked sent', async (t) => {
  const browser = await open();
  if(!browser) return t.skip('no Playwright browser available');

  try {
    const page = await browser.newPage();
    const errors = [];
    page.on('pageerror', e => errors.push(e.message));
    await page.goto('file://' + path.join(ROOT, 'index.html'));
    await page.waitForFunction(() => typeof S === 'object' && S !== null, null, { timeout: 15000 });

    // A counting stub, so "did not push" is as visible as "pushed".
    await page.evaluate(() => {
      window.posts = [];
      window.fetch = async (url, opts) => {
        window.posts.push(JSON.parse(opts.body));
        return { ok: true, status: 200, json: async () => ({ ok: true, shifts: 1 }) };
      };
      S.companies = [{ id: 'c1', name: 'Trupoint', color: '#333' }];
      S.settings.pushToken = 'tok';
      S.shifts = [{ id: 'a', companyId: 'c1', date: '2026-09-07', start: '19:00',
                    end: '07:00', label: 'Station', source: 'ocr' }];
    });

    const first = await page.evaluate(async () => {
      await autoPush();
      return { posts: window.posts.length, sent: S.shifts[0].sent,
               shipped: window.posts[0].shifts.length };
    });
    assert.equal(first.posts, 1, 'the change went out');
    assert.equal(first.shipped, 1);
    assert.equal(first.sent, true, 'a confirmed write marks it sent');

    // Nothing has changed, so nothing is said. `save()` runs on every keystroke
    // in Setup and on every fold opened; without this they would each be a
    // request.
    const quiet = await page.evaluate(async () => {
      await autoPush();
      await autoPush();
      return window.posts.length;
    });
    assert.equal(quiet, 1, 'an unchanged payload is not sent again');

    // `sent` is this phone's bookkeeping and must not itself be a change, or
    // marking one would ask for a push to say so, for ever.
    assert.ok(!('sent' in (await page.evaluate(() => window.posts[0].shifts[0]))),
      'the sent flag is stripped from the payload');

    // A real change does go.
    const second = await page.evaluate(async () => {
      S.shifts.push({ id: 'b', companyId: 'c1', date: '2026-09-08', start: '07:00',
                      end: '19:00', label: 'Station', source: 'ocr' });
      await autoPush();
      return { posts: window.posts.length, shipped: window.posts[1].shifts.length };
    });
    assert.equal(second.posts, 2);
    assert.equal(second.shipped, 2);

    // The one that matters. A push that failed must leave the shifts unmarked,
    // or §23's warning goes quiet about a calendar that never received them and
    // the alarms simply never fire.
    const failed = await page.evaluate(async () => {
      window.fetch = async () => { throw new Error('offline'); };
      S.shifts.push({ id: 'c', companyId: 'c1', date: '2026-09-09', start: '07:00',
                      end: '19:00', label: 'Station', source: 'ocr' });
      const r = await autoPush();
      return { r, sent: S.shifts.map(s => !!s.sent) };
    });
    assert.equal(failed.r, null, 'a failed push is quiet, not thrown');
    assert.deepEqual(failed.sent, [true, true, false], 'the unsent shift stays unsent');

    // And it is retried rather than forgotten: `sentBody` was not advanced, so
    // the next nudge carries it.
    const retried = await page.evaluate(async () => {
      window.fetch = async (url, opts) => {
        window.posts.push(JSON.parse(opts.body));
        return { ok: true, status: 200, json: async () => ({ ok: true, shifts: 3 }) };
      };
      await autoPush();
      return { posts: window.posts.length, sent: S.shifts.map(s => !!s.sent) };
    });
    assert.equal(retried.posts, 3, 'the next attempt picks it up');
    assert.deepEqual(retried.sent, [true, true, true]);

    // Drawing the screen must not change what gets sent. `renderPatterns` used
    // to fill in a missing `patterns` array on the way past, so a job saved
    // before §18 would have pushed itself once more after every launch — for
    // ever, and over a difference nothing asked for. Any render that writes to
    // the store does this, so the assertion is on the whole render.
    const stable = await page.evaluate(() => {
      S.companies.push({ id: 'c9', name: 'Old job', color: '#999' });  // no patterns key
      const before = pushBody();
      renderAll(); renderAll();
      return { before, after: pushBody() };
    });
    assert.equal(stable.after, stable.before, 'rendering does not change the payload');

    // With no token nothing leaves the device, which is §4's rule and is not
    // negotiable just because the sending is automatic now.
    const noToken = await page.evaluate(async () => {
      S.settings.pushToken = '';
      S.shifts.push({ id: 'd', companyId: 'c1', date: '2026-09-10', start: '07:00',
                      end: '19:00', label: 'Station', source: 'ocr' });
      await autoPush();
      return window.posts.length;
    });
    assert.equal(noToken, 3, 'no token, no request');

    assert.deepEqual(errors, [], 'the page loaded with no uncaught errors');
  } finally {
    await browser.close();
  }
});

/* The teardown (§34).
 *
 * Page-only, like everything else in this file, and for the sharpest version
 * of the reason: what it does is a sequence — cancel, clear, verify, wipe —
 * and the whole value of it is the order. A unit test can assert that
 * `resetPlan` names four tables. Only a loaded page can assert that the token
 * is still there when the server is called and gone by the time it finishes,
 * and that nothing pushed the schedule back up in between.
 */
test('the teardown cancels, clears, verifies, and only then wipes', async (t) => {
  const browser = await open();
  if(!browser) return t.skip('no Playwright browser available');

  try {
    const page = await browser.newPage();
    const errors = [];
    page.on('pageerror', e => errors.push(e.message));
    await page.goto('file://' + path.join(ROOT, 'index.html'));
    await page.waitForFunction(() => typeof S === 'object' && S !== null, null, { timeout: 15000 });
    await page.click('nav button[data-tab="setup"]');

    const run = await page.evaluate(async () => {
      const calls = [], files = [];
      window.confirm = () => true;
      window.download = (name, text) => files.push({ name, text });

      S.companies = [{ id: 'c1', name: 'Trupoint', color: '#333', icsFeed: true },
                     { id: 'c2', name: 'DSI', color: '#666' }];
      S.settings.pushToken = 'tok';
      S.settings.feedMode = 'subscribe';
      S.shifts = [
        // The cron's half. `sent` is true in subscription mode by
        // construction, and these are events in the calendar like any other.
        { id: 'f1', companyId: 'c1', date: '2026-09-09', start: '15:00', end: '23:00',
          label: 'Rosemont', source: 'feed', sent: true, seq: 2 },
        // The phone's half, and an overnight one, so the cancellation has to
        // carry tomorrow's date as its end.
        { id: 'm1', companyId: 'c2', date: '2026-09-10', start: '19:00', end: '07:00',
          label: 'De la Montagne', source: 'ocr', sent: true },
        // Never sent: there is no event out there, so nothing to cancel.
        { id: 'm2', companyId: 'c2', date: '2026-09-11', start: '08:00', end: '16:00',
          label: 'Nowhere', source: 'ocr', sent: false }
      ];
      S.tombstones = [];

      let pushedDuring = 0;
      window.fetch = async (path, opts) => {
        calls.push({ path, method: (opts && opts.method) || 'GET',
                     body: opts && opts.body, auth: !!(opts && opts.headers && opts.headers.authorization) });
        if(path === '/push'){ pushedDuring++; return { ok: true, status: 200, json: async () => ({ ok: true }) }; }
        if(path === '/reset') return { ok: true, status: 200, json: async () => ({
          ok: true, dropped: false, before: { shifts: 3, cfg: 1, raw: 1, polls: 12 } }) };
        if(path === '/trace') return { ok: true, status: 200, json: async () => ({
          companies: [], groups: [], orphans: [], feed: { events: 0, bytes: 0 },
          at: new Date().toISOString() }) };
        return { ok: true, status: 200, json: async () => ({}) };
      };

      // Every route that would put the schedule back on a server that was
      // just emptied, fired while the teardown is mid-flight.
      const racing = runTeardown();
      const midFlightToken = pushToken();
      await autoPush();
      await syncDown(true);
      await racing;

      return {
        calls, files, pushedDuring, midFlightToken,
        token: S.settings.pushToken || '',
        shifts: S.shifts.length,
        companies: S.companies.length,
        blocked: teardown.running,
        log: [...document.querySelectorAll('#tdlog li')].map(li => li.textContent)
      };
    });

    // The file first, while the shifts it names are still here to name.
    assert.equal(run.files.length, 1);
    assert.match(run.files[0].name, /^shifts-cancelled-\d{4}-\d{2}-\d{2}\.ics$/);
    const ics = run.files[0].text;
    assert.match(ics, /METHOD:CANCEL/);
    // Both jobs. The cron's rows are events in the calendar exactly like the
    // typed ones, and a teardown that left them behind would leave the half
    // this phone cannot delete from the server either.
    assert.match(ics, /\r\nUID:f1@shiftdeck\r\n/);
    assert.match(ics, /\r\nUID:m1@shiftdeck\r\n/);
    assert.ok(!/m2@shiftdeck/.test(ics), 'a shift never sent has no event to cancel');
    // Newer than the revision the calendar holds, or it is entitled to ignore it.
    assert.match(ics, /\r\nSEQUENCE:3\r\n/);
    assert.match(ics, /\r\nDTEND:20260911T070000\r\n/, 'the overnight one ends the next day');

    // Then the server: cleared, then read back rather than assumed.
    const paths = run.calls.map(c => c.path);
    assert.deepEqual(paths, ['/reset', '/trace']);
    assert.equal(run.calls[0].method, 'POST');
    assert.deepEqual(JSON.parse(run.calls[0].body), { drop: false });
    assert.ok(run.calls.every(c => c.auth), 'both go up with the token');

    // Nothing raced the schedule back into the database it had just emptied.
    assert.equal(run.pushedDuring, 0, 'no push landed while the teardown ran');
    assert.ok(run.midFlightToken, 'the token was still there for the server calls');

    // And the device, last.
    assert.equal(run.token, '', 'the token is forgotten');
    assert.equal(run.shifts, 0);
    assert.equal(run.companies, 0);
    assert.ok(run.blocked, 'the phone stays inert until it is reloaded');
    assert.match(run.log.join(' | '), /Verified/);

    assert.deepEqual(errors, [], 'the page loaded with no uncaught errors');
  } finally {
    await browser.close();
  }
});

test('a server that did not empty stops the teardown with the token intact', async (t) => {
  const browser = await open();
  if(!browser) return t.skip('no Playwright browser available');

  try {
    const page = await browser.newPage();
    const errors = [];
    page.on('pageerror', e => errors.push(e.message));
    await page.goto('file://' + path.join(ROOT, 'index.html'));
    await page.waitForFunction(() => typeof S === 'object' && S !== null, null, { timeout: 15000 });
    await page.click('nav button[data-tab="setup"]');

    const run = await page.evaluate(async () => {
      window.confirm = () => true;
      window.download = () => {};
      S.companies = [{ id: 'c1', name: 'Trupoint', color: '#333' }];
      S.settings.pushToken = 'tok';
      S.shifts = [{ id: 'm1', companyId: 'c1', date: '2026-09-10', start: '08:00', end: '16:00',
                    label: 'Rosemont', source: 'ocr', sent: true }];
      window.fetch = async (path) => {
        if(path === '/reset') return { ok: true, status: 200, json: async () => ({
          ok: true, before: { shifts: 1, cfg: 1, raw: 0, polls: 3 } }) };
        // The rows the reset was meant to remove, still there.
        return { ok: true, status: 200, json: async () => ({
          companies: [], groups: [{ company_id: 'c9', source: 'feed', n: 14 }],
          orphans: [{ company_id: 'c9', source: 'feed', n: 14 }],
          feed: { events: 14, bytes: 900 }, at: new Date().toISOString() }) };
      };
      await runTeardown();
      return {
        token: S.settings.pushToken || '',
        shifts: S.shifts.length,
        // `retire` files one of these for every sent shift on the way to
        // building the cancellations. If the run stops, the shifts are still
        // here, and a leftover record would stand on the Schedule as "a
        // deleted shift is still in the calendar, with its alarms".
        tombstones: (S.tombstones || []).length,
        note: document.getElementById('tdnote').textContent,
        log: [...document.querySelectorAll('#tdlog li')].map(li => li.textContent).join(' | ')
      };
    });

    // The phone that can still reach the server is the only thing that can
    // finish the job, so it keeps what it needs to.
    assert.equal(run.token, 'tok', 'the token survives a failed teardown');
    assert.equal(run.shifts, 1, 'nothing local is wiped while the server still holds rows');
    assert.equal(run.tombstones, 0, 'a stopped run leaves no warning about deletions it did not make');
    assert.match(run.log, /Still there: 14 rows and 14 calendar events/);
    assert.match(run.note, /not emptied/);

    assert.deepEqual(errors, [], 'the page loaded with no uncaught errors');
  } finally {
    await browser.close();
  }
});
