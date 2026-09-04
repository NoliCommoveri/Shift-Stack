/* ==========================================================================
   The site and role tables, and the matching that decides when two spellings
   are the same thing. PROJECT.md §8.1, widened by §27.

   §27 asked for a second rate at the same job — "Cook" and "Dishwasher" at
   Homebase do not pay the same — and the answer turned out to need almost
   nothing new here. Everything below from `key()` to `suggestNames()` only
   ever reads `{ name, aliases, archived }`; it never knew what a site was.
   So the role table is the same machinery pointed at a second list, and the
   only site-specific things left in this file are the four naming functions
   at the bottom and one line of `mergeSites`.

       S.roles = [{ id, companyId, name, rate, aliases:[], archived }]
       shift   = { …, siteId, roleId, role, label }

   The rate hangs off the record and not off the string, for the reason §8.2
   gave about times: a figure checked against a deposit weeks later must rest
   on something a human confirmed, never on the reader's own output.

   `shift.label` was one string doing two jobs, and the edit dialog admitted it
   by captioning the field "Site or role". TrackTik prints both at once —
   "Cook Plant ASO | SOUTHERN HENS" is a role and a place, either side of a
   separator the employer itself printed and §17.4 took care to preserve.
   Homebase prints "Cook", a role with no place in it at all. Addresses attach
   to the place, never to the role, and an address is what turns the two-hour
   alarm into a tappable line the phone can navigate from.

       S.sites = [{ id, companyId, name, address, aliases:[], archived }]
       shift   = { …, siteId, role, label }

   Two rules run through everything below.

   **`siteId` is nullable and `label` stays.** A read that matches nothing
   still files, and still renders, as the text that was read. Requiring a site
   would let one bad read block an import, which is worse than an unlabelled
   shift — and it is the reason none of this needs a migration (§7): a record
   written before today has no `siteId`, falls back to its label, and means
   exactly what it always meant.

   **Authority comes from the human, never from the reader.** The function this
   replaces, `snapSite()`, matched a fresh read against the labels already
   sitting in `S.shifts` — that is, against the parser's own unvalidated
   output, so one bad read became a "known site" and every later read snapped
   to it. Nothing here derives a spelling from anything but a site record, and
   a site record only ever exists because somebody made one. The same argument
   §8.2 made about times, applied to names.

   Nothing here touches the DOM or storage. app.js decides which rows to run it
   over and what to do with the answer.
   ========================================================================== */

/* The comparison key. Case, punctuation and spacing are all things OCR gets
   wrong on a good day, and none of them distinguish two sites. */
const key = s => String(s||'').toLowerCase().replace(/[^a-z0-9]/g,'');

/* Levenshtein. Bailing out on a big length difference is not an optimisation:
   two strings four characters apart in length are not a misreading of each
   other, whatever the matrix says. */
function editDistance(a, b){
  if(Math.abs(a.length - b.length) > 4) return 99;
  const dp = Array.from({length:a.length+1}, (_,i) => [i, ...Array(b.length).fill(0)]);
  for(let j = 0; j <= b.length; j++) dp[0][j] = j;
  for(let i = 1; i <= a.length; i++)
    for(let j = 1; j <= b.length; j++)
      dp[i][j] = Math.min(dp[i-1][j]+1, dp[i][j-1]+1, dp[i-1][j-1] + (a[i-1]===b[j-1]?0:1));
  return dp[a.length][b.length];
}

const NEAR_ABS = 3;      // characters
const NEAR_REL = 0.18;   // …or this proportion of the longer spelling
/* Below this, a distance of three is most of the word. "Cook" and "Cort" are
   two apart and are not the same site; "De la Montagne" and "De Ia Montagme"
   are two apart and plainly are. Short spellings have to match exactly. */
const NEAR_MIN_LEN = 5;

/* Every spelling a site answers to: the name it is filed under, plus the ones
   confirmed in review to mean it. */
function spellings(site){
  return [site && site.name, ...((site && site.aliases) || [])].filter(Boolean);
}

/* Exact alias, then edit distance, then no match — §8.1's three steps, in that
   order, because an exact hit on one record must never lose to a near hit on
   another. `how` is what the review screen colours on: 'exact' is silent,
   'near' is amber and is the case where confirming teaches the table a new
   spelling, 'none' leaves the row as read.

   Archived records are not matched against. Archiving a site says he has
   stopped being sent there and archiving a role says he has stopped doing it,
   so a fresh read that looks like either is more likely a new one with a
   similar name than a return; the record stays for the shifts pointing at it.

   Nothing here knows whether it is matching places or job titles. That is not
   a coincidence discovered later — §8.1 wrote it this way — and it is why §27
   cost a record shape rather than a second matcher. */
function matchName(raw, records){
  const k = key(raw);
  const none = { rec: null, how: 'none', dist: 99 };
  if(!k) return none;
  const live = (records || []).filter(s => s && !s.archived);

  for(const s of live)
    if(spellings(s).some(sp => key(sp) === k)) return { rec: s, how: 'exact', dist: 0 };

  let best = null, bestD = 99;
  for(const s of live){
    for(const sp of spellings(s)){
      const kk = key(sp);
      if(kk.length < NEAR_MIN_LEN || k.length < NEAR_MIN_LEN) continue;
      const d = editDistance(k, kk);
      const rel = d / Math.max(k.length, kk.length, 1);
      if(d < bestD && (d <= NEAR_ABS || rel <= NEAR_REL)){ bestD = d; best = s; }
    }
  }
  return best ? { rec: best, how: 'near', dist: bestD } : none;
}

/* Which table a label is talking to.

   With the employer's separator (§17.4) there is no question: left of the pipe
   is a role and right of it is a place, and "Cook Plant ASO | SOUTHERN HENS"
   is the line that bought the whole design. Without one there is nothing
   printed to go on — Homebase prints "Cook", a role with no place in it, and a
   TrackTik line whose pipe was lost to OCR could be either — so the tables are
   asked and the better hit wins.

   Exact beats near either way round. At equal confidence the site wins, and
   that tie-break is not arbitrary: it is what makes a job with no roles
   declared behave exactly as it did before §27, since an empty role table can
   only ever return 'none'.

   `split` is passed in rather than done here because the separator is
   parser.js's, and this file does not read text. */
function readLabel(label, sites, roles, split){
  const { role, site } = split(label);
  if(site) return { roleRaw: role.trim(), siteRaw: site.trim() };

  const one = String(role || '').trim();
  if(!one) return { roleRaw: '', siteRaw: '' };
  const rank = m => m.how === 'exact' ? 0 : m.how === 'near' ? 1 : 2;
  const asSite = matchName(one, sites), asRole = matchName(one, roles);
  const roleWins = rank(asRole) < rank(asSite) ||
    (rank(asRole) === rank(asSite) && asRole.how === 'near' && asRole.dist < asSite.dist);
  return roleWins ? { roleRaw: one, siteRaw: '' } : { roleRaw: '', siteRaw: one };
}

/* Records the spelling as meaning this site. Returns whether it was new, so a
   caller can say what it did. Mutates, because a site record is a stored thing
   and pretending otherwise here would only move the copying somewhere else. */
function addAlias(site, spelling){
  const k = key(spelling);
  if(!site || !k || key(site.name) === k) return false;
  site.aliases = site.aliases || [];
  if(site.aliases.some(a => key(a) === k)) return false;
  site.aliases.push(String(spelling).trim());
  return true;
}

function dropAlias(site, spelling){
  if(!site || !site.aliases) return false;
  const k = key(spelling), before = site.aliases.length;
  site.aliases = site.aliases.filter(a => key(a) !== k);
  return site.aliases.length !== before;
}

function newSite(id, companyId, name, address){
  return { id, companyId, name: String(name || '').trim(),
           address: String(address || '').trim(), aliases: [], archived: false };
}

/* A role is a site with a rate where the address was. `rate` is null rather
   than 0 for the same reason `co.rate` is: null means nothing has been said
   and the job's own rate stands, where 0 would mean this role pays nothing. */
function newRole(id, companyId, name, rate){
  return { id, companyId, name: String(name || '').trim(),
           rate: rate === '' || rate == null ? null : +rate,
           aliases: [], archived: false };
}

/* What one shift is worth an hour. The role's rate when it has one, the job's
   otherwise — so a job with a single rate needs no roles at all, and a role
   with no rate of its own is a spelling table and nothing more. */
function rateFor(shift, role, co){
  const r = role && role.rate != null ? +role.rate : null;
  if(r != null && !Number.isNaN(r)) return r;
  const c = co && co.rate != null && co.rate !== '' ? +co.rate : null;
  return c != null && !Number.isNaN(c) ? c : null;
}

/* Merging is permanent, not a migration step — OCR keeps inventing spellings,
   so this is a thing he will do again next month. B's name and every spelling
   B answered to become spellings of A, which is the whole value: the merge is
   what stops the same misreading needing the same decision twice.

   Returns the new list. Repointing the shifts is the caller's, because it is
   the caller that has them. `absorb` is the one thing a site and a role do
   differently: each carries a field the spellings do not cover. */
function mergeRecords(list, fromId, intoId, absorb){
  const all = list || [];
  const from = all.find(s => s.id === fromId);
  const into = all.find(s => s.id === intoId);
  if(!from || !into || from === into) return { list: all, moved: 0 };
  let moved = 0;
  spellings(from).forEach(sp => { if(addAlias(into, sp)) moved++; });
  if(absorb) absorb(into, from);
  return { list: all.filter(s => s.id !== fromId), moved };
}

/* An address on the record being absorbed is better than no address at all,
   and never better than one already there. */
function mergeSites(sites, fromId, intoId){
  const r = mergeRecords(sites, fromId, intoId,
    (into, from) => { if(!into.address && from.address) into.address = from.address; });
  return { sites: r.list, moved: r.moved };
}

/* The same rule for a rate, and it matters more: merging two spellings of one
   job title must never quietly halve what an hour of it is worth. A rate
   already on the surviving record is the one he typed, and it stands. */
function mergeRoles(roles, fromId, intoId){
  const r = mergeRecords(roles, fromId, intoId,
    (into, from) => { if(into.rate == null && from.rate != null) into.rate = from.rate; });
  return { roles: r.list, moved: r.moved };
}

/* The role this shift reads as: the curated spelling when a record was matched,
   and the text that was read when none was. Same rule the site has followed
   since §8.1 — the table is what a name means, the label is what it said. */
function roleText(shift, role){
  return role ? String(role.name || '').trim()
              : String((shift && shift.role) || '').trim();
}

/* What names this shift, said as one string. With a record it is the curated
   spelling and not whatever was read; with neither it is the label, unchanged,
   which is the fallback the whole design rests on.

   The role-only case is new in §27 and is Homebase's: that job prints "Cook"
   and no place at all, so before there was a role table there was nothing to
   curate and the label was all there was. Now a matched role speaks alone.

   The separator is the employer's own (§17.4) for the calendar and a middot on
   screen, because the pipe reads as punctuation in a sentence and as structure
   in a title. */
function whereText(shift, site, sep, role){
  const s = shift || {};
  const r = roleText(s, role);
  if(site) return r ? `${r}${sep || ' | '}${site.name}` : site.name;
  if(role && r) return r;
  return String(s.label || '').trim() || 'Shift';
}

/* §8.1's title convention, `${company}- ${role} ${site}`, with the separator
   §17.4 put between the last two. A shift that matched neither table produces
   the byte-identical title it produced before this file existed. */
function eventTitle(companyName, shift, site, role){
  return `${companyName || 'Shift'}- ${whereText(shift, site, undefined, role)}`;
}

/* The address the calendar gets. The shift's own wins: a feed row carries the
   address the employer published for that event, which is a fact about that
   night, where the site's is a standing default. */
function addressFor(shift, site){
  return String((shift && shift.place) || (site && site.address) || '').trim();
}

/* Are these two rows the same shift, as far as naming goes? Identity first,
   text only as the fallback — two rows that both matched the same records are
   the same however they were spelled, and that is the point of the tables.

   The role is part of the identity, not decoration. A calendar feed that moves
   him from Cook to Dishwasher at the same site and hour has changed what the
   night is worth, and a comparison that ignored the role would call that
   unchanged and file the old rate against it (§27). */
const whereKey = x =>
  (x && (x.siteId || x.roleId)) ? `id:${x.siteId || ''}/${x.roleId || ''}`
                                : 'txt:' + key(x && x.label);

/* Candidate site records drawn from the labels already on file, most-used
   first — §8.2's "build from what's on file", for names instead of times.
   Nothing here is applied to anything: it is a menu, and the human ticking a
   row is exactly what stops the reader's output becoming authority. Labels
   that already match a site are left off, since that question is answered.

   `read` is how a shift yields the part that could name the thing being built,
   and `held` is how it says it already has one. Both are passed in rather than
   done here because the answer lives in the separator parser.js preserves
   (§17.4), and this file does not read text. It matters: offering the whole of
   "Cook Plant ASO | SOUTHERN HENS" would file a site under a name with a role
   stuck to the front of it, which then matches nothing the next time the same
   screen is read — and would file a role with a place stuck to the end. */
function suggestNames(shifts, records, read, held){
  const raw = read || (s => s && s.label);
  const has = held || (s => s.siteId);
  const seen = new Map();
  (shifts || []).forEach(s => {
    if(!s || has(s)) return;
    const name = String(raw(s) || '').trim();
    if(!key(name)) return;
    if(matchName(name, records).rec) return;
    const k = key(name);
    if(!seen.has(k)) seen.set(k, { name, count: 0 });
    seen.get(k).count++;
  });
  return [...seen.values()].sort((a,b) => b.count - a.count || a.name.localeCompare(b.name));
}

/* Node picks these up for the tests; the browser just gets the globals. */
if(typeof module !== 'undefined' && module.exports){
  module.exports = { key, editDistance, NEAR_ABS, NEAR_REL, NEAR_MIN_LEN,
                     spellings, matchName, addAlias, dropAlias,
                     newSite, newRole, rateFor,
                     mergeRecords, mergeSites, mergeRoles,
                     readLabel, roleText, whereText, eventTitle, addressFor, whereKey,
                     suggestNames };
}
