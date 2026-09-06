/* What a feed changes about what is on file. Run with:  npm test
 *
 * §14.7 asks for these before the Worker is written. The reason is §14.6: the
 * cron applies what this function returns without a human reading it first,
 * so "which shifts did the feed actually change" stops being a question
 * someone checks and becomes one this file has to be right about. The two
 * failures that matter are opposite and both silent — calling an unchanged
 * shift changed rewrites the schedule every fifteen minutes, and calling a
 * changed shift unchanged leaves him with the old times on his phone.
 */
const test = require('node:test');
const assert = require('node:assert');
const M = require('../merge.js');

// A shift as it sits on file: it has an id, and its place is a site record.
const held = (over = {}) => ({
  id: 'sh1', companyId: 'c1', extUid: 'u1', source: 'feed',
  date: '2026-09-04', start: '19:00', end: '07:00',
  label: 'Security Officer @ Rosemont', siteId: 's1', roleId: 'r1', ...over
});

// A row as parseICS hands it over: a uid and text, no ids yet.
const row = (over = {}) => ({
  uid: 'u1', date: '2026-09-04', start: '19:00', end: '07:00',
  label: 'Security Officer @ Rosemont', ...over
});

// Standing in for the page's applyNames: text in, ids on.
const resolve = r => ({ ...r, siteId: 's1', roleId: 'r1' });
const opts = { resolve };

const merge = (existing, rows, report = {}) =>
  M.mergeCalendar(existing, rows, report, 'c1', opts);

/* ---------- the three outcomes ------------------------------------------- */

test('a uid nothing on file matches is an addition', () => {
  const out = merge([], [row({ uid: 'new' })]);
  assert.equal(out.add.length, 1);
  assert.equal(out.add[0].extUid, 'new');
  assert.equal(out.add[0].companyId, 'c1');
  assert.deepEqual([out.replace.length, out.remove.length, out.unchanged], [0, 0, 0]);
});

test('the same shift twice is unchanged, not a replacement', () => {
  const out = merge([held()], [row()]);
  assert.equal(out.unchanged, 1);
  assert.deepEqual([out.add.length, out.replace.length, out.remove.length], [0, 0, 0]);
});

test('a retimed shift is replaced in place, keeping its id', () => {
  const out = merge([held()], [row({ start: '18:00' })]);
  assert.equal(out.replace.length, 1);
  assert.equal(out.replace[0].id, 'sh1');
  assert.equal(out.replace[0].row.start, '18:00');
  assert.equal(out.replace[0].was.start, '19:00');
  assert.equal(out.add.length, 0);
});

test('a shift moved to another date is a replacement, not an add plus a remove', () => {
  const out = merge([held()], [row({ date: '2026-09-06' })]);
  assert.equal(out.replace.length, 1);
  assert.equal(out.add.length, 0);
  assert.equal(out.remove.length, 0);
});

test('the same hours in a different role is a change', () => {
  // §27: the same night in a different role is worth a different amount, so a
  // comparison that ignored the role would file the old rate against it.
  const out = M.mergeCalendar([held()], [row()], {}, 'c1',
    { resolve: r => ({ ...r, siteId: 's1', roleId: 'r2' }) });
  assert.equal(out.replace.length, 1);
  assert.equal(out.unchanged, 0);
});

test('a cancelled event names the shift on file to remove', () => {
  const out = merge([held()], [], { cancelledRows: [{ uid: 'u1' }] });
  assert.equal(out.remove.length, 1);
  assert.equal(out.remove[0].id, 'sh1');
});

test('a cancellation for something not on file removes nothing', () => {
  const out = merge([held()], [], { cancelledRows: [{ uid: 'ghost' }, { uid: null }] });
  assert.equal(out.remove.length, 0);
});

test('the same cancellation twice removes one shift, not two', () => {
  const out = merge([held()], [], { cancelledRows: [{ uid: 'u1' }, { uid: 'u1' }] });
  assert.equal(out.remove.length, 1);
});

/* ---------- a rota republished under new ids (§51) ------------------------ */

/* Homebase does not promise a stable UID. A rota rebuilt and republished
   arrives as the same shifts under fresh event ids, and on UID alone every one
   of them is an addition standing beside the row it supersedes — one copy in
   the employer's calendar, two in the app. */

test('the same shift under a new uid replaces the old one rather than joining it', () => {
  const out = merge([held()], [row({ uid: 'u1-rebuilt' })]);
  assert.equal(out.add.length, 0, 'a second copy of a shift he works once');
  assert.equal(out.replace.length, 1);
  assert.equal(out.replace[0].id, 'sh1', 'the id is kept, so the calendar sees a revision (§22)');
  assert.equal(out.replace[0].row.extUid, 'u1-rebuilt');
  assert.equal(out.stale.length, 0, 'the row was reused, not left behind');
});

test('a whole rota republished is replacements, not a second rota', () => {
  const mine = [held(), held({ id: 'sh2', extUid: 'u2', date: '2026-09-06' })];
  const rows = [row({ uid: 'n1' }), row({ uid: 'n2', date: '2026-09-06' })];
  const out = merge(mine, rows);
  assert.deepEqual([out.add.length, out.replace.length, out.stale.length], [0, 2, 0]);
  assert.deepEqual(out.replace.map(r => r.id).sort(), ['sh1', 'sh2']);
});

test('a uid that matches wins the row a slot match would also have taken', () => {
  // Pass order is the safety: the employer naming a specific shift has first
  // refusal on the row it names, or the shift it names is filed twice.
  const mine = [held()];
  const out = merge(mine, [row({ uid: 'other' }), row()]);
  assert.equal(out.unchanged, 1, 'u1 took its own row');
  assert.equal(out.add.length, 1, 'and the unrecognised event is genuinely new');
  assert.equal(out.add[0].extUid, 'other');
});

test('a shift on file the feed has stopped naming, in a slot it confirms, is stale', () => {
  // The state a database is left in by every poll that ran before §51: the
  // superseded copy, which nothing removes because nothing cancelled it.
  const old = held({ id: 'sh-old', extUid: 'u-old' });
  const now = held({ id: 'sh-new', extUid: 'u-new' });
  const out = merge([old, now], [row({ uid: 'u-new' })]);
  assert.equal(out.unchanged, 1);
  assert.equal(out.stale.length, 1);
  assert.equal(out.stale[0].id, 'sh-old');
  assert.equal(out.remove.length, 0, 'a collapsed duplicate is not a cancellation');
});

test('a shift the feed no longer mentions at all is left alone', () => {
  // The window is seven days back and the feed is somebody else's file. A row
  // that has merely fallen out of either is not a shift he did not work, and
  // §8.4 is the rule: a partial view of a schedule is indistinguishable from a
  // week of cancellations. Only a slot the feed has just confirmed as one
  // shift can say a second row in it is a leftover.
  const out = merge([held()], [row({ uid: 'u2', date: '2026-09-09' })]);
  assert.equal(out.stale.length, 0);
  assert.equal(out.remove.length, 0);
  assert.equal(out.add.length, 1);
});

test('two events in one feed standing in one slot file one shift', () => {
  // `bySlot` in app.js has always dropped the exact repeat out of a
  // hand-imported calendar. The two ends of §14 answering that differently is
  // the disagreement this file exists to prevent.
  const out = merge([], [row({ uid: 'a' }), row({ uid: 'b' })]);
  assert.equal(out.add.length, 1);
  assert.equal(out.add[0].extUid, 'a');
});

test('a cancelled id republished at the same hours is not a cancellation', () => {
  // The feed cancels the id it threw away and carries the shift under a new
  // one. Read as a removal, the evening he is working comes off his phone.
  const out = merge([held()], [row({ uid: 'u1-rebuilt' })], { cancelledRows: [{ uid: 'u1' }] });
  assert.equal(out.remove.length, 0);
  assert.equal(out.replace.length, 1);
  assert.equal(out.replace[0].id, 'sh1');
});

test('a cancellation for a shift the feed does not otherwise carry still removes it', () => {
  const out = merge([held()], [], { cancelledRows: [{ uid: 'u1' }] });
  assert.equal(out.remove.length, 1);
  assert.equal(out.stale.length, 0);
});

test('collapsing duplicates never empties a slot', () => {
  // The property that lets `stale` sit outside §14.6's ceiling: a row is only
  // ever stale while another row survives in its place.
  const rows = [row({ uid: 'u-new' })];
  const mine = [held({ id: 'a', extUid: 'u-old' }), held({ id: 'b', extUid: 'u-new' }),
                held({ id: 'c', extUid: 'u-older' })];
  const out = merge(mine, rows);
  assert.equal(out.stale.length, 2);
  const left = mine.filter(s => !out.stale.some(x => x.id === s.id));
  assert.equal(left.length, 1);
  assert.equal(left[0].id, 'b');
});

/* ---------- the properties the cron depends on --------------------------- */

test('running the same feed twice is a no-op the second time', () => {
  // Cron Triggers do not retry and may double-fire, so "already applied" has
  // to be a fact rather than a hope (§14.5).
  const rows = [row(), row({ uid: 'u2', date: '2026-09-06' })];
  const first = merge([held()], rows);
  assert.equal(first.add.length, 1);

  // Apply it the way the Worker would, then run the identical feed again.
  const after = [held(), { ...first.add[0], id: 'sh2', source: 'feed' }];
  const second = merge(after, rows);
  assert.deepEqual([second.add.length, second.replace.length,
                    second.remove.length, second.stale.length], [0, 0, 0, 0]);
  assert.equal(second.unchanged, 2);
});

test('another job\'s shifts are neither matched nor touched', () => {
  const mine = held();
  const theirs = held({ id: 'other', companyId: 'c2' });
  const out = merge([mine, theirs], [row()], { cancelledRows: [{ uid: 'u1' }] });
  assert.equal(out.unchanged, 1);
  assert.equal(out.remove.length, 1);
  assert.equal(out.remove[0].id, 'sh1');
});

test('hand-entered shifts are invisible to the feed', () => {
  // The phone owns source='manual' and the cron owns source='feed' (§14.3).
  // A manual shift carries no extUid, so it cannot be matched, replaced or
  // removed by anything arriving here.
  const manual = { id: 'm1', companyId: 'c1', extUid: null, source: 'manual',
                   date: '2026-09-04', start: '19:00', end: '07:00', label: 'Security Officer @ Rosemont' };
  const out = merge([manual], [row()], { cancelledRows: [{ uid: 'u1' }] });
  assert.equal(out.add.length, 1);          // the feed row is new, not a match
  assert.equal(out.replace.length, 0);
  assert.equal(out.remove.length, 0);       // and nothing removes the manual one
});

test('nothing handed in is mutated', () => {
  const on = held();
  const before = JSON.stringify(on);
  const r = row({ start: '18:00' });
  const rBefore = JSON.stringify(r);
  merge([on], [r]);
  assert.equal(JSON.stringify(on), before);
  assert.equal(JSON.stringify(r), rBefore);
});

test('an empty feed proposes nothing at all', () => {
  // Not the same as proposing to remove everything — §14.6 makes an empty
  // calendar a refusal to apply, and this is the half of it that lives here.
  const out = merge([held()], [], {});
  assert.deepEqual([out.add.length, out.replace.length, out.remove.length, out.unchanged], [0, 0, 0, 0]);
});

test('missing rows and report do not throw', () => {
  const out = M.mergeCalendar(null, null, null, 'c1', opts);
  assert.deepEqual([out.add.length, out.replace.length, out.remove.length, out.unchanged], [0, 0, 0, 0]);
});

/* ---------- without a resolver ------------------------------------------- */

test('without a resolver every row would look changed, and that is on the caller', () => {
  // Documented rather than defended against: this is why `opts.resolve` is
  // not optional in practice, and the test exists so the day someone drops
  // the resolver the failure has a name.
  const out = M.mergeCalendar([held()], [row()], {}, 'c1');
  assert.equal(out.replace.length, 1);
  assert.equal(out.unchanged, 0);
});
