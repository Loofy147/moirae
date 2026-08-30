# A negative claim is satisfied by an empty stage

There is a GIF at the top of a project I built this summer. Five horizontal lanes, one per node of
a small Raft cluster, time running left to right. A second and a half in, a dashed red wall drops
between the top two lanes and the bottom three: a network partition. The two nodes above the wall
turn amber again and again — each amber block is an attempt to get elected leader — and every
attempt sends vote requests that hit the wall and die as red crosses. They never turn blue. The
three nodes below keep their blue leader the whole time. A caption counts it: *nodes 1, 2: 7
attempts so far, none won.* When the wall lifts, one election settles it.

That is the whole pitch of the tool in fourteen seconds: a partition, a minority that cannot elect
a leader no matter how hard it tries, a majority that carries on. The file behind the GIF is a
fixed scenario, seeded, reproducible byte for byte, its trace hash pinned in CI so the picture can
never drift from the code. It had been reviewed. It had been merged. And it did not contain the
story the GIF tells.

## The fixture that told a different story

The way I found out was a test. The viewer needed a gate — something computed from the committed
scenario that pinned the one claim the demo makes — so I wrote one: from the trace, derive each
node's role over time, and assert that inside the partition window no node on the minority side
ever becomes leader, while some node on the majority side is leader throughout.

That assertion passed. Then I added a second one, almost as an afterthought, because a rule I had
been taught twice already that month was starting to sound familiar: assert that the minority
*tried*. At least three candidate spells inside the window, and vote requests from the minority
dying at the wall.

Zero, and zero.

With the seed the fixture had, the leader at the moment the wall went up was node 2 — inside the
minority. Its heartbeats kept node 1 quiet, so node 1 never timed out, never became a candidate,
never sent a vote request. The minority did not fail to elect a leader; it never tried. It sat
behind the wall with a stale leader while the majority, having lost contact, elected a new one.
That is correct Raft behaviour. It is also a perfectly good story. It is just not the story the
GIF claims, and "the minority elected no leader" is true of both.

The fix was the fixture, not the test. This is worth being precise about, because the tempting move
when a test fails is to make it pass. The test was right: it described the claim the demo makes.
The fixture had been merged and hash-pinned while telling a different story, because the only
thing anyone had ever asserted about it was that no invariant was violated — which is true of the
wrong story too. I searched three hundred seeds for one where the leader sits on the majority side
when the wall goes up; a hundred and seventy-one qualify. The pinned hash changed, in the same
commit, with the reason. The GIF was re-recorded from the new seed.

Look at the shape of the failure, because it is the shape of the whole essay. A negative assertion
— *no leader was elected on the minority side* — was satisfied by a scenario in which the thing
being denied was never possible. The assertion was not wrong. It was empty. Absence and
impossibility look identical to a test that only checks absence.

## The same shape, a month earlier, in a Raft rule

The second time I had seen it was in the Raft implementation itself. Raft leaders track, for each
follower, the highest log index known to be replicated there: the *match index*. One of the rules
that is classically implemented wrong is that this number must be set from the request that was
actually answered, never from the leader's current log length, and that it must never move
backwards. That second property is what makes it safe for a follower to echo the index in its
response even when responses are duplicated or arrive out of order: a stale response can only ever
propose a value the leader already passed.

I wrote the test the rule asks for. Send a success for index three; then replay an old success for
index one; assert the match index is still three. Then I ran it against the naive implementation,
the one that sets the match index from the log length — and it passed.

Of course it passed. That implementation never moved the match index in response to anything the
follower said. There was no replay for the replay to be ignored by. "Never moves backwards" was
vacuously true of an implementation in which it never moved. The test only started to mean
something when it was run against the version a contributor would actually write — the echoed
index taken at face value, with no monotonic guard — where it finally failed with `expected 2 to
be 3`. That is the same shape: a negative assertion, satisfied by absence, in a file that had
already been reviewed.

## And once more, in the tooling, before either

The earliest instance was not in the protocol at all. The project's entire promise — same seed,
same trace, on any machine, forever — rests on a lint rule that bans every ambient source of
nondeterminism inside the engine and the protocols: no wall clock, no `Math.random`, no timers,
no filesystem. Because a lint configuration can be weakened by accident, I had written a self-test
for it: it lints small in-memory snippets at virtual paths inside the restricted packages and
asserts each banned thing is flagged. Reviewed, merged, green.

Then an adversarial pass — reviewers whose only job was to write nondeterministic code that
passed lint — found that the ban's file patterns said `*.ts`, and that a file named `clock.mts` or
`clock.tsx` inside the engine was typechecked, style-linted, and not under the ban at all.
`Date.now()` in a `.mts` file went through the whole green pipeline. The self-test could not see it
because every fixture it used had a `.ts` path. It asserted "banned things are flagged" without
ever establishing that the flag reached the places where banned things could live. Negative
assertion, satisfied by absence: the ban did not fail on `.mts` files because the test never gave
it an `.mts` file to fail on.

## What the rule is

A test that asserts something did *not* happen must also assert that it had the opportunity to
happen. Otherwise it passes whenever the scenario is simply absent, which is exactly the case it
exists to catch.

Write the positive sibling in the same test, next to the negative one, so they can never be
separated by a later edit. "No leader on the minority side" sits beside "at least three election
attempts on the minority side." "Match index never moves backwards" sits beside "the match index
did advance to three, and a stale response was then delivered." "Banned calls are flagged in the
engine" sits beside "and the fixtures include every file extension the engine's own configuration
accepts."

And if you cannot say what "had the opportunity" means for the thing you are denying — if there is
no sentence of the form *and here is the proof that it could have happened* — then the negative
assertion is not testing anything, and you should either find that sentence or delete the test,
because a test that cannot fail is worse than no test. It occupies the place where a real one would
go, and it passes review.

In the project this now lives in the instructions file that every session reads before touching
code, in a section called "rules learned the hard way", with the fixture and the match-index
incidents recorded underneath it. The incidents are not decoration. A rule without its incident
reads as a style preference and gets argued with; a rule with the file that passed review while
telling the wrong story does not.

## Why it took three

I want to be honest about why I did not see this until the third time, because "we learned a
lesson" is a sentence that hides the interesting part. I have told the three in the order I
understood them, not the order they happened — the lint gap came first in time, the fixture last —
and the distance between those two orders is what this section is about.

Each instance looked like a different kind of problem. The lint gap looked like a tooling coverage
bug: a glob that did not match an extension. The match-index test looked like a subtlety of one
protocol rule: the naive form happened to be vacuously compliant. The fixture looked like a
content problem: the wrong seed for the demo. Three different vocabularies — tooling, protocol,
content — and in each one the fix was local and correct, so the case closed. Nothing about closing
it suggested a category.

What finally made it a category was noticing what the three had in common *before* the fix: every
one of them had passed review. Not slipped past a tired reviewer — passed a real one, in a project
that reviews every commit in isolation and merges nothing that is not green. Review reads an
assertion as a claim about the world. "No leader on the minority side" reads as a fact the code
guarantees, and the reviewer's job seems to be to check that the code guarantees it. It does. The
question review does not naturally ask is whether the world in the test contains any minority that
could have elected anyone, because that is not a question about the claim; it is a question about
the stage the claim is standing on. A negative claim is satisfied by an empty stage.

The sibling assertion is the thing that makes an empty stage visible. It is also, I think, why the
third instance is the one that taught me: it was the only one where the negative assertion and its
sibling were written in the same afternoon, by the same hand, and the sibling failed on the first
run while the original passed. The contrast was the lesson. In the earlier two, the sibling arrived
later — from an adversarial reviewer, from being told to make the test bite — and by then the
original had already been filed under "fixed".

The project is [moirae](https://github.com/pchrysostomou/moirae), a deterministic simulation
testing framework for distributed systems. The full record of what broke while building it,
including this, is in its [devlog](https://github.com/pchrysostomou/moirae/blob/main/docs/devlog.md).

The examples are its. The shape is not. Any test suite that contains the word "never" contains
this problem somewhere, and the way to find it is to ask, of each such test, what it would take for
the thing to happen — and whether the test ever lets it.
