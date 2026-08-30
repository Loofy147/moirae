# Devlog: building moirae

This is the record of how moirae got built, written from the pull requests, the commits and the
things that went wrong along the way. It is not a changelog. If you only want to know what the
project does, the README is shorter. This is for the reader who wants to know what it cost, what
broke, and what each break taught — because a devlog that only contains the clever parts is worth
nothing.

moirae is a deterministic simulation testing framework for distributed systems, in TypeScript,
with a viewer that replays a trace. Six phases, thirteen pull requests, two renames, one open
item at the end. Everything below happened; where I reported something I had not verified, that
is in here too.

## Phase 0: the one rule, and the rule that guards it

The whole project rests on one sentence: nothing in the engine or in a protocol may touch a
nondeterministic source. No `Date.now`, no `Math.random`, no timers, no filesystem. Time comes
from `ctx.now()`, randomness from `ctx.random()`, scheduling from `ctx.setTimer()`. If that rule
holds, every run with the same seed produces the same trace, byte for byte, forever. If it leaks
once, every stored seed in existence quietly stops meaning anything, and the failures look like
protocol bugs rather than what they are.

TypeScript cannot enforce that rule, so ESLint does. Phase 0 was the scaffold — pnpm workspace,
strict TypeScript, vitest, CI — and the lint configuration that bans the ambient sources in
`packages/core` and `packages/protocols`, with inline `eslint-disable` comments made dead in those
directories so nobody can quietly opt out. And because a lint configuration can be weakened by
accident, a self-test lints in-memory fixtures at virtual paths inside the restricted packages and
asserts each banned source is flagged. If the config silently loses a rule, that test fails.

That self-test was the right instinct and it was still not enough. Before merging I ran an
adversarial review — fourteen agents, whose only job was to write nondeterministic code that
passed lint — and they found five real holes. The worst one: the ban's file globs said
`packages/core/**/*.ts`. A file named `clock.mts` or `clock.tsx` inside `packages/core` matched
the recommended-rules block, matched the package's tsconfig, typechecked, was linted for style, and
was not under the ban at all. `Date.now()` in a `.mts` file went through the entire green pipeline.
The self-test could not see it either, because it only ever used `.ts` fixture paths. The others
were `eval` and the `Function` constructor as escape hatches to every banned global,
`const m = Math; m.random()` slipping past a rule that only knew `Math.random` literally,
locale-dependent methods like `localeCompare` whose output depends on the host, and dynamic
`import()` of node builtins, which the static-import rule cannot see.

All five got closed and each got a fixture in the self-test. The lesson I took was not "run more
agents" — it was that a guard needs an attacker, and that the guard's own test has to be written by
someone trying to get past it, not by the person who wrote the guard. That framing — negative
assertions need a sibling that proves the opportunity existed — would come back three more times
before the project shipped, and I did not yet know it was a pattern.

One more thing from Phase 0 that mattered later: the packaging toolchain. TypeScript 7, the Go
compiler, had just become the default and typescript-eslint did not support it. Since the lint ban
is load-bearing, the linted compiler won and the project pinned TypeScript 6, with the condition
for lifting the pin written into the PR. And `pnpm/action-setup`, the GitHub Action everyone uses
for pnpm, turned out to be scoped to pnpm 10 and older; the successor `pnpm/setup` was verified as
genuinely upstream — same org as `pnpm/pnpm`, declared successor in the old action's README, the
action pnpm's own docs use — and then pinned by commit SHA, because a third-party action running
on every push is supply-chain surface.

## Phase 1: the determinism test is the deliverable

Phase 1 was the engine: the event queue, the simulated clock, the PRNG, the `Process`/`Ctx`
interface, `simulate()`, and JSONL trace emission. The brief was explicit that the engine was not
the deliverable. The determinism test was.

I wrote that test before the engine existed and ran it red — `Cannot find module '../src/simulate'`
— and only then wrote the code. It has three assertions, each with a different job. Two runs with
the same seed must produce byte-identical JSONL. The trace's hash must equal a constant committed
in the test. A different seed must produce a different hash. The first catches ambient
nondeterminism. The third catches a hash that ignores the seed. The second is the one with teeth,
and the reason took me a moment to see.

The event queue orders by `(time, seq)`, where `seq` is a counter assigned at insertion; it is the
tiebreaker that makes same-time ordering total and reproducible. The obvious way to prove the test
guards it is to remove `seq` from the comparator and watch the test fail. But if you only compare
two runs in one process, a broken comparator is deterministically wrong the same way both times —
the heap's internal order is stable for identical inputs — and the run-versus-run assertion passes.
Only the pinned constant can see that the ordering changed. So the teeth-proof was: remove `seq`,
run the suite, and the golden-hash assertion fails (`1803375b38270750` instead of the pinned
`2732102cf7f36bea`) while the byte-identity assertion still passes. That single run is the
justification for keeping a magic constant in a test file. Every deliberate engine change since has
updated that constant in the same commit and said why; an unexplained change is a bug.

The PRNG is PCG32, transcribed from the reference C, and tested against the reference check
output for seed `(42, 54)` fetched from the `pcg-c` repository — six exact 32-bit values that break
if any part of the seeding, the multiplier, or the output function is wrong. The hash is FNV-1a 64
with the constants from the IETF draft, cross-checked against an independent Python
implementation. None of it is clever. All of it is verifiable, which was the point.

## Phase 2: faults, and the bug that only the test saw

Phase 2 added the network model (uniform latency, loss, duplication, partitions), crash and restart
scheduling with declared persistent fields, and invariants that see a deep-frozen copy of every
node's state after every step. Two design decisions are worth writing down.

Lognormal latency was deliberately not offered. Sampling it needs `Math.log`, `Math.sqrt` and
`Math.cos`, and ECMAScript does not specify those functions bit-exactly — engines may differ in the
last bit. One such draw feeding a delivery time would turn "byte-identical across engines" into a
matter of luck. Uniform latency is pure integer arithmetic. The reasoning, not just the fact, went
into the spec so nobody adds it later as a helpful improvement.

Persistence is a declarative list on the process — `persistent = ['currentTerm', 'votedFor', 'log']`
— rather than a `ctx.persist(key)` call. Not because it is simpler, but because handlers are
instantaneous in this simulator: there is no crash point inside a handler, so "responded before
persisting" is unobservable, and a call-based API would have suggested we were testing write
ordering when we were not. That limitation is recorded in the spec as a limitation, with the note
that it becomes testable when crash points inside handlers land, so a future contributor implementing
Paxos finds the gap before they hit it.

The bug: on restart, the engine re-runs `init` and overlays the persisted fields onto the fresh
state. My first version did that with a spread, which is shallow. The persisted `log` array was the
same object as the live state's `log`, so every later append mutated the snapshot that had been
handed to `onRestart`. The test that caught it was mundane — it recorded what `onRestart` received
and compared it to `{ term: 2, log: [30, 60] }`, and got `[30, 60, 130, 160, 190]`. A copy at
overlay time fixed it, and the snapshot is frozen now. The same batch of tests found that a process
calling `crash()` inside its own `init` blew up on `Object.keys(undefined)`, because the state did
not exist yet. Neither would have been found by thinking harder about the design.

This phase also produced the second golden hash, over a run that exercises every fault path — a
test that first asserts the scenario really did drop messages for loss and for partition, delivered
duplicates, crashed and restarted — and the seq teeth-proof was re-run against both. Both fail with
`seq` removed; both run-versus-run assertions still pass. Same shape as Phase 1, now on the record
for the fault paths.

## Phase 3: Raft, and Figure 8 failing twice for the wrong reasons

Raft was written from the paper, not from memory. Every handler cites the section it implements.
The brief listed ten rules that are classically implemented wrong — the ones that pass happy-path
tests and lose committed entries under partition — and required each to have a test written before
its handler, shown failing against the naive form first. For most of them the naive form was
simply the rule's absence; for the ones where absence fails trivially, I deliberately wrote the
wrong version first. Figure 8 was the one that mattered most, and the brief said: if it passes on
your first attempt, assume the test is wrong.

It did not pass on the first attempt. It failed, and for the wrong reason. The scripted sequence
had S1 crash and restart before leading term 4, and I had not let S2 re-acknowledge afterwards.
`matchIndex` is volatile; after the restart, S1 only knew about itself and S3, which is not a
majority of five, so neither the naive nor the correct commit rule advanced anything. The
assertion said `expected +0 to be 1`. A test that fails for the wrong reason is worse than one that
passes, because it looks like it is working. I fixed the exchange so S2 acknowledged.

It failed a second time, also for the wrong reason: followers only learn a new commit index from
the *next* AppendEntries, and I had never fired a heartbeat after the proposal, so S2's applied
sequence lagged under either rule. Fixed that too.

Then it failed correctly. Against the majority-only rule: `expected 2 to be 1` — the term-2 entry
replicated on a majority was treated as committed — and then, in the end-to-end variant,
`'index 2: S1 applied a, S2 applied b'`: that entry overwritten and a different command applied at
the same index. A committed entry lost, State Machine Safety broken, which is the exact disaster
§5.4.2 of the paper exists to prevent. Then the correct rule, which only commits current-term
entries by counting, and the test went green — after one more correction, this time to my own
expectation: after a restart the leader's commit index is legitimately zero until an entry of its
own term is on a majority, and I had expected one. The rule was right and I was wrong.

Pattern #7 taught a subtler version of the same lesson. The rule is that a leader sets a follower's
match index from the request that was actually answered, never from its own current log length,
and that match index never moves backwards — which is what makes it safe for the follower to echo
the index in its response under duplication and reordering. I wrote the replay test: send a success
for index 3, then replay an old success for index 1, and assert the match index stays at 3. It
passed against the naive implementation. Of course it did: the naive implementation set the match
index from the log length and never moved it at all. The test was not testing anything until it was
shown to fail against the form a contributor would actually write — the echo taken at face value
with no monotonic guard — where it finally reported `expected 2 to be 3`. A negative assertion
("never moves backwards") that does not also establish the opportunity ("it could have") is
decoration.

Two process failures from this phase belong here. A commit went into history red because my gate
was `pnpm test 2>&1 | grep ... && git commit`, which gates on grep's exit status, not vitest's. It
was amended before push and every gate since starts with `set -o pipefail`. And a per-commit
verification sweep — every commit checked out into a clean worktree and run through the full
pipeline — reported two spurious failures because I ran it alongside a thousand-seed fuzz and the
ESLint-backed lint guard exceeded vitest's five-second default timeout under contention. Both
commits were green alone. Heavy jobs run one at a time now.

The fuzz gate — two hundred seeds in CI, a thousand locally before a release, each with 2% loss,
random partition schedules and crashes — found no violations. I want to be precise about what that
carries and what it does not: the ten pattern tests are the correctness argument, and the fuzz is
what says the engine and the implementation survive contact with each other. A clean demo run
proves neither, and the example scenario says so in its header.

## Phase 5: the story that was not in the fixture

The studio is the viewer: a pure function of a trace file, read-only, importing exactly one type
from the engine — a lint rule makes that mechanical. Its gate was different from every previous
phase and stated up front: no test can say the viewer is good. Someone who does not know Raft has
to watch the clean scenario and see the minority side failing to elect a leader, without reading
code and without asking. So it was built in the order the gate demanded — the partition wall, the
role strips, the vote requests dying at the wall — before the scrubber or the state panel, and I
took headless-browser screenshots after every change and looked at them, because the amber lanes
either read at a glance or nothing afterwards rescues them.

The one test the phase could have was a gate test: from the committed clean fixture, compute that
there is no leader interval inside the partition on lanes 1 and 2 and one on the majority side. It
failed on its first run, and the failure was the most useful thing in the phase. The "no minority
leader" assertion passed. The sibling assertion I had added — that the minority *tried*, at least
three candidate spells inside the band, with vote requests dying at the wall — reported zero and
zero. The fixture, the file the studio renders and the GIF shows, did not contain its own story.
With seed `0xca11` the leader at partition time was node 2, inside the minority; its heartbeats kept
node 1 quiet, so the minority never timed out. It carried a stale leader and never even tried, while
the majority elected node 4. That is correct Raft behaviour and a perfectly good story — it is just
not the story the demo claims.

The fix was the fixture, not the test. The test was right: it described the story the demo
promises. The fixture had been merged, reviewed, and hash-pinned while quietly telling a different
one, because the only assertion on it had been "no violation", which is true of the wrong story
too. I searched three hundred seeds for one where the leader sits on the majority side when the
wall goes up — a hundred and seventy-one qualify — and reseeded to 19, updating the pinned hash in
the same commit with the reason. The seed change has a consequence that is also true to the paper:
the minority's repeated elections raise its term, so on healing the majority leader steps down and
one more election happens. That is the disruptive-server behaviour pre-vote exists to prevent, and
pre-vote is out of scope, so the demo shows it.

This was the second time a negative assertion had passed trivially in a file that had passed
review, after pattern #7. It went into the project's instructions as a standing rule: a test that
asserts something did not happen must also assert it had the opportunity to happen, with both
incidents recorded so the next reader knows it is not a style preference.

## Phase 6: the GIF, the cold machine, and two renames

The GIF is the top of the README and everything else is subordinate to it. Before recording, I
rendered one mid-partition frame at the recording size, at the eight-hundred-pixel width GitHub
uses on desktop, and at phone width. The baseline failed at the margin — the in-band caption was
about nine pixels at 800 and the term labels were gone — so the type and the crop changed before a
hundred and seventy frames existed: a narrower frame drawn one-to-one, captions at 22 pixels,
larger lane and legend type. Then three more changes from review: draw nothing past the playhead,
because a GIF whose job is revealing a story should not show the ending in frame one; put the
majority's caption on the leader's lane, because a sentence next to a grey lane confirms nothing;
and drop the replication arcs from the recording entirely, because their count owned most of the
pixels and none of them served the gate. What has to read is amber, a dead arc at the wall, amber
again. The recording is deterministic — the built studio served by the CLI, a headless browser
screenshotting fixed simulated times, ffmpeg assembling — so it can be regenerated when the studio
changes. A hundred and sixty-eight frames, fourteen seconds, 389 kilobytes.

`npx moirae demo` was checked the way it was specified: not "it works in the repo", but the packed
tarball installed into an empty directory with no lockfile and no workspace. One package, zero
dependencies, no build step. Install 2.1 seconds, first run 2.5 seconds, 0.6 without npx; on Linux
CI, 293 milliseconds and 0.644 seconds. That check is a CI job now on three Node versions.

The most-read line in the project was `10 + Math.floor(ctx.random() * 20)`, sitting three
characters from a comment saying randomness never comes from ambient sources. `Math.floor` is
deterministic and allowed, but a reader skimming for five seconds sees `Math.` and draws the wrong
conclusion. So the engine got `ctx.randomInt(min, max)`: exactly one draw, mapped as
`min + floor(r * (max - min + 1))`, which is the arithmetic authors were writing by hand — so
switching Raft's own timeout draw to it left both pinned goldens untouched, which is the proof it
consumed the PRNG exactly as before. The sample now reads as the interface intends, and it is a real
file, typechecked and linted under the same ban as the shipped protocols, with the README's copy
asserted byte-identical in CI.

Then the names. The project was called moira — fate — because a deterministic simulator is a fate
machine, and the name did work. At launch preparation `moira` turned out to be taken on npm by a
nine-year-old unrelated package. The meaning-preserving candidates — ananke, atropos, lachesis —
were all taken too, and by a rule set in advance the fallback was the shortest name nobody would
misspell: nemea. Rename, one commit, ADR-006, GitHub redirecting the old name.

At first publish the registry refused `nemea` with a 403: "too similar to existing packages namaa,
remeda". That similarity check runs at publish time, has no appeal, and is invisible from
`npm view` — a name can be unregistered and still refused. The only reliable test is an attempted
publish. So I made a throwaway package and attempted to publish it under each candidate, which was
safe for a reason worth stating: the account has 2FA with a security key, and the registry runs the
similarity check *before* the second-factor challenge, so refused names return the 403 with the
reason and passing names stop at an invalid-OTP error with nothing published. `moirae` — the Fates,
plural, the meaning the original name carried — passed, despite `moira` and `moirai` existing.
Second rename, ADR-007, ADR-006 kept as history because the record should show why both happened.

And then the third, smaller one. Scoped packages need an npm organisation, and npm refuses to
create an organisation whose name collides with an existing package. The unscoped CLI `moirae`
had been published first. Creating `@moirae` afterwards was therefore impossible, permanently. The
names were fine; the *order of the two steps* — package before org — is what closed the door. The
libraries went unscoped, `moirae-core` and `moirae-protocols`, both probed the same way and both
passing, and ADR-008 records the lesson in one sentence: if you want an unscoped package and a
matching scope, create the org first, then publish.

One more consequence of the sequence: `moirae@0.1.0` on the registry was built from the
scoped-name commit, so the CLI tarball on npm does not match what the `v0.1.0` tag contains. The
libraries do. The CLI is republished as 0.1.1 from the tagged line so the registry and the tag
agree.

## Things I got wrong in the telling

Twice in Phase 5 and 6 I started a CI watch and then reported "PR #9 is open" — with a number —
before the push and the PR-creation command had actually been issued. The PR did not exist. Both
times the sequence was the same: I had the watch queued, narrated the result I expected, and only
found out when the watch reported no pull request for the branch. Both were caught and corrected
from tool output before anything was merged, and the fix was procedural rather than clever: a PR is
only named after the creation command's output has been read. It is in here because the difference
between a verified claim and a confident one is the entire subject of this project, and I failed
at it twice while building the tool.

Smaller versions of the same thing: a working directory persisting between shell commands sent a
commit gate into the wrong package, where it failed on a missing `lint` script — absolute paths in
every chain now. And the `| grep` gate that let a red commit into history. None of these are
interesting engineering. They are the reason the project's instructions file has a section called
"rules learned the hard way", and each rule there carries the incident that produced it, because a
rule without its incident reads as a preference and gets argued with.

## What the record shows

Thirteen pull requests, every commit in each of them passing typecheck, lint and the full test
suite alone in a clean worktree, merged without squashing so bisect and single-commit revert work
anywhere in the history. Two pinned trace hashes that have not moved except when a change to the
engine was made on purpose and said so. Ten Raft rules each with a test that was made to fail
before it was allowed to pass. A fixture that told the wrong story until a test asked it to prove
the right one. Two renames and one lost scope, all three recorded with the reason. And one tool
that, when a run breaks, hands you a seed and a picture instead of a log.
