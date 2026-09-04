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
