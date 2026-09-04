-- Shift Deck, D1. PROJECT.md §14.3.
--
-- Applied from the app's own Settings screen, not from the D1 console.
-- Every statement is written so that running it twice is harmless, because
-- the person applying it has no way to know whether it took the first time.

CREATE TABLE IF NOT EXISTS cfg (
  id         INTEGER PRIMARY KEY CHECK (id = 1),   -- one row, enforced
  -- companies, sites, roles, and the narrow slice of settings the server is
  -- allowed to hold. Not `S.settings` whole: that carries the push token and
  -- the employer's secret calendar address, neither of which is ever read from
  -- here, and both of which this row would otherwise keep in cleartext.
  -- `safeSettings` in guards.js is the list, and enforces it on the way in.
  json       TEXT    NOT NULL,
  updated_at TEXT    NOT NULL
);

-- Two writers, one table. The phone owns source='manual' and the cron owns
-- source='feed'; neither touches the other's rows. That is a rule in the
-- Worker rather than a property of the storage, and one WHERE clause enforces
-- it -- the same column-level ownership Scheduling_App locked for its shared
-- assignments table.
CREATE TABLE IF NOT EXISTS shifts (
  id         TEXT PRIMARY KEY,
  company_id TEXT NOT NULL,
  source     TEXT NOT NULL CHECK (source IN ('manual', 'feed', 'pattern')),
  ext_uid    TEXT,                                 -- the calendar UID, null if hand-entered
  date       TEXT NOT NULL,                        -- ISO, for the feed window
  json       TEXT NOT NULL,                        -- the whole shift, as the app holds it
  updated_at TEXT NOT NULL
);

-- What makes the cron idempotent (§14.5). Cron Triggers do not retry and may
-- double-fire, so "already applied" has to be a fact the database knows
-- rather than one the code hopes for. Partial, because a hand-entered shift
-- has no UID and any number of them may sit at one job.
CREATE UNIQUE INDEX IF NOT EXISTS shifts_ext_uid
  ON shifts (company_id, ext_uid) WHERE ext_uid IS NOT NULL;

CREATE INDEX IF NOT EXISTS shifts_by_date ON shifts (date);

-- Last known-good calendar text per job: for diffing, and for looking at when
-- something is wrong. One row per job, replaced in place.
CREATE TABLE IF NOT EXISTS raw (
  job_id     TEXT PRIMARY KEY,
  ics        TEXT NOT NULL,
  fetched_at TEXT NOT NULL
);

-- Append-only, trimmed to the last 50 (§14.8). Every poll writes one whether
-- it applied anything or refused, because a refusal is the interesting case:
-- the failure this project exists to prevent is not a wrong shift, it is a
-- calendar that has quietly stopped changing.
CREATE TABLE IF NOT EXISTS polls (
  id        INTEGER PRIMARY KEY AUTOINCREMENT,
  job_id    TEXT NOT NULL,
  at        TEXT NOT NULL,
  ok        INTEGER NOT NULL,                      -- 1 applied, 0 refused
  reason    TEXT,                                  -- why it refused, null if it did not
  events    INTEGER NOT NULL DEFAULT 0,
  added     INTEGER NOT NULL DEFAULT 0,
  replaced  INTEGER NOT NULL DEFAULT 0,
  removed   INTEGER NOT NULL DEFAULT 0,
  unchanged INTEGER NOT NULL DEFAULT 0,
  unreadable INTEGER NOT NULL DEFAULT 0,           -- a distinct condition, not noise (§14.9)
  ms        INTEGER,                               -- how long the fetch took
  newest    TEXT                                   -- newest DTSTAMP in the feed, for §14.8
);

CREATE INDEX IF NOT EXISTS polls_at ON polls (at DESC);
