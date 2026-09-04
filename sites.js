/* ==========================================================================
   The site table, and the matching that decides when two spellings are the
   same place. PROJECT.md §8.1.

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
   order, because an exact hit on one site must never lose to a near hit on
   another. `how` is what the review screen colours on: 'exact' is silent,
   'near' is amber and is the case where confirming teaches the table a new
   spelling, 'none' leaves the row as read.

   Archived sites are not matched against. Archiving says he has stopped
   working there, so a fresh read that looks like it is more likely a new site
   with a similar name than a return; the record stays for the shifts that
   already point at it. */
function matchSite(raw, sites){
  const k = key(raw);
  const none = { site: null, how: 'none', dist: 99 };
  if(!k) return none;
  const live = (sites || []).filter(s => s && !s.archived);

  for(const s of live)
    if(spellings(s).some(sp => key(sp) === k)) return { site: s, how: 'exact', dist: 0 };

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
  return best ? { site: best, how: 'near', dist: bestD } : none;
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

/* Merging is permanent, not a migration step — OCR keeps inventing spellings,
   so this is a thing he will do again next month. B's name and every spelling
   B answered to become spellings of A, which is the whole value: the merge is
   what stops the same misreading needing the same decision twice.

   Returns the new list. Repointing the shifts is the caller's, because it is
   the caller that has them. */
function mergeSites(sites, fromId, intoId){
  const list = sites || [];
  const from = list.find(s => s.id === fromId);
  const into = list.find(s => s.id === intoId);
  if(!from || !into || from === into) return { sites: list, moved: 0 };
  let moved = 0;
  spellings(from).forEach(sp => { if(addAlias(into, sp)) moved++; });
  // An address on the record being absorbed is better than no address at all,
  // and never better than one already there.
  if(!into.address && from.address) into.address = from.address;
  return { sites: list.filter(s => s.id !== fromId), moved };
}

/* What names this shift, said as one string. With a site it is the curated
   spelling and not whatever was read; without one it is the label, unchanged,
   which is the fallback the whole design rests on.

   The separator is the employer's own (§17.4) for the calendar and a middot on
   screen, because the pipe reads as punctuation in a sentence and as structure
   in a title. */
function whereText(shift, site, sep){
  const s = shift || {};
  if(!site) return String(s.label || '').trim() || 'Shift';
  const role = String(s.role || '').trim();
  return role ? `${role}${sep || ' | '}${site.name}` : site.name;
}

/* §8.1's title convention, `${company}- ${role} ${site}`, with the separator
   §17.4 put between the last two. A shift that matched no site produces the
   byte-identical title it produced before this file existed. */
function eventTitle(companyName, shift, site){
  return `${companyName || 'Shift'}- ${whereText(shift, site)}`;
}

/* The address the calendar gets. The shift's own wins: a feed row carries the
   address the employer published for that event, which is a fact about that
   night, where the site's is a standing default. */
function addressFor(shift, site){
  return String((shift && shift.place) || (site && site.address) || '').trim();
}

/* Are these two rows in the same place? Identity first, text only as the
   fallback — two rows that both matched the same site are the same place
   however they were spelled, and that is the point of the table. */
const whereKey = x => (x && x.siteId) ? 'id:' + x.siteId : 'txt:' + key(x && x.label);

/* Candidate site records drawn from the labels already on file, most-used
   first — §8.2's "build from what's on file", for names instead of times.
   Nothing here is applied to anything: it is a menu, and the human ticking a
   row is exactly what stops the reader's output becoming authority. Labels
   that already match a site are left off, since that question is answered.

   `readSite` is how a label yields the part that could name a place. It is
   passed in rather than done here because the answer lives in the separator
   parser.js preserves (§17.4), and this file does not read text. It matters:
   offering the whole of "Cook Plant ASO | SOUTHERN HENS" would file a site
   under a name with a role stuck to the front of it, which then matches
   nothing the next time the same screen is read. */
function suggestSites(shifts, sites, readSite){
  const raw = readSite || (x => x);
  const seen = new Map();
  (shifts || []).forEach(s => {
    if(!s || s.siteId) return;
    const name = String(raw(s.label || '') || '').trim();
    if(!key(name)) return;
    if(matchSite(name, sites).site) return;
    const k = key(name);
    if(!seen.has(k)) seen.set(k, { name, count: 0 });
    seen.get(k).count++;
  });
  return [...seen.values()].sort((a,b) => b.count - a.count || a.name.localeCompare(b.name));
}

/* Node picks these up for the tests; the browser just gets the globals. */
if(typeof module !== 'undefined' && module.exports){
  module.exports = { key, editDistance, NEAR_ABS, NEAR_REL, NEAR_MIN_LEN,
                     spellings, matchSite, addAlias, dropAlias, newSite,
                     mergeSites, whereText, eventTitle, addressFor, whereKey,
                     suggestSites };
}
