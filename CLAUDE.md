# Working agreements

## "Commit" means commit, now

When Ray says **commit** — or "commit immediately", "co.mit", or any variant —
that is an instruction to stage and commit **at that moment**, with the working
tree exactly as it stands. It is not a goal to work toward once the current
thought is finished.

Do this and nothing else first:

```
git add -A && git commit && git push -u origin <current-branch>
```

Do **not**, before committing:

- finish the edit in progress
- run the tests, or fix a failing one
- update PROJECT.md, README.md, or any other doc
- tidy, rename, or "just quickly" do one more thing
- ask whether he'd like the tests run first

Commit the mess. Broken code, half-written functions, failing tests, a doc
that no longer matches the code — all of it is fine and all of it is expected.
Say what state the commit is in *after* it is pushed, not before.

### Why

Ray develops across two accounts, and each has a usage window that runs out
without warning. The commit is how work crosses from the session that is about
to stop to the session that will pick it up. Every minute spent finishing
something first is a minute the window might not have, and the cost of losing
it is the whole session's work. The other session finishes the tests, the
docs, and the half-written function — that is its job, not a reason to delay.

### The commit message

Write it in one pass, no deliberation. Describe where the work actually stopped
so the next session knows what it inherits, e.g.:

```
WIP: parser handles overnight shifts, midnight-crossing case unwritten

Tests not run. patterns.js:80 is mid-edit.
```

If something is genuinely unsafe to commit — a secret, a key — say so in one
line and commit everything else. Nothing else earns a pause.
