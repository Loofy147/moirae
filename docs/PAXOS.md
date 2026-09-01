# docs/PAXOS.md — implementation notes

Source of truth: Leslie Lamport, *Paxos Made Simple* (2001). Section numbers below refer to that
paper. *The Part-Time Parliament* (1998) is the original; it is not needed to review this
implementation. Where our wording and the paper disagree, the paper wins.

This file is a checklist, not a substitute for the paper. Read §2.2 (the two phases) and §2.3
(learning) in the original before writing or reviewing a handler.

## Scope for v0

In: single-decree Paxos — one value is chosen, ever. Every node plays all three roles (§2.4
allows collocation): proposer, acceptor, learner. Safety under loss, duplication, reordering,
partitions and crash/restart of acceptors.

Out: Multi-Paxos and any log (#23), a distinguished proposer/leader (§2.4), NACKs and the
performance optimisations of §2.2's closing remark, proposer/learner crash recovery, learner
catch-up (a node that was down when the value was chosen learns it only if Accepted messages
still flow afterwards).

Values enter through `Paxos.propose(ctx, value)` — one value per node, ever; the test workload
drives it. The shipped class contains no client logic.

## State

Acceptor state, persistent (§2.2–§2.3: an acceptor "must remember this information even if it
fails and restarts" — see C7 for what that means here):

- `promised` — the highest proposal number of any prepare request this acceptor has responded
  to; 0 = none.
- `acceptedN`, `acceptedV` — the highest-numbered proposal this acceptor has accepted; 0/null =
  none.

Proposer and learner state, volatile: the current attempt (`attemptN`, `phase`, `promisesFrom`,
`highestAccepted`), the value this node wants (`wanted`), everything this node ever proposed
(`proposals`, for the validity invariant), the per-ballot tally of Accepted messages
(`accepts`), and `learned`.

## The rules, numbered

Each handler comment cites the section it implements; each rule here names the tests that hold
it in place.

1. **Prepare(n) earns a promise iff n is greater than every prepare already answered** (§2.2:
   "If an acceptor receives a prepare request with number n greater than that of any prepare
   request to which it has already responded"). Equal is not greater. The promise carries the
   highest-numbered proposal the acceptor has accepted, if any. (`paxos-01`)
2. **Accept(n, v) is accepted iff n ≥ promised** — greater *or equal* (§2.2, P1a: "an acceptor
   can accept a proposal numbered n iff it has not responded to a prepare request having a
   number greater than n"). Writing `>` here is the classic off-by-one: the proposer's own
   prepare made promised = n, and its accept request must still land. (`paxos-01`)
3. **Phase 2 proposes the value of the highest-numbered accepted proposal reported by the
   promise majority** — not the first to arrive, not the proposer's own — and only when no
   promise reported an accepted proposal may the proposer use its own value (§2.2, the
   description of P2c in action). (`paxos-02`)
4. **A promise counts only for the attempt it answers.** Promises carry the number they answer;
   a promise for an earlier attempt is dead, and one acceptor counts once however often its
   promise is delivered (§2.2 — the majority is a majority of acceptors for proposal n).
   (`paxos-03`)
5. **A proposal number is bound to one value forever.** Once phase 2 has started for n, a late
   promise for n changes nothing — re-deriving the value could bind n to a second value, which
   breaks the induction behind P2c. (`paxos-03`)
6. **Proposal numbers come from disjoint sets** (§2.2: "different proposers choose their numbers
   from disjoint sets of numbers"): n = round·N + me. Two proposers can never issue the same n.
   (`paxos-invariant proposalIntegrity`, fuzz)
7. **An acceptor's promise and accepted proposal survive restarts** (§2.2–§2.3). They are in
   `Paxos.persistent`; a restarted acceptor that had accepted the chosen value still reports it,
   which is what forces a later proposer onto the chosen value. (`paxos-scenarios` 4)
8. **A value is learned only from a majority of Accepted messages carrying the same n**
   (§2.3: a learner discovers a chosen value by finding that a majority of acceptors accepted a
   proposal). Accepted messages for different n never combine, and one acceptor counts once per
   n. (`paxos-05`)
9. **Ignoring is always allowed.** An acceptor silently ignores a prepare or accept it will not
   grant (§2.2: "it can ignore the request without sacrificing safety"). We send no NACKs; the
   paper's performance suggestion to send them is an option not taken (C3). (`paxos-01`)
10. **Liveness is not guaranteed and the tests do not pretend it is.** Two proposers can duel
    forever (§2.4); §2.4's remedy — a distinguished proposer — is out of scope. Randomized
    retry (C5) makes progress overwhelmingly likely, and the fuzz gate asserts a convergence
    floor across seeds, not termination on every seed.

## Choices and deviations

Everything here is either explicitly permitted by the paper or is a liveness mechanism the paper
leaves open. None of it weakens a safety rule.

- **C1 — collocated roles** (§2.4). Every node is proposer, acceptor and learner. A proposer's
  request to its own acceptor does not cross the network: the same acceptor rules run locally
  (`promiseSelf`, `acceptSelf` call the shared rule), so the local path cannot drift from the
  remote one.
- **C2 — proposal numbering.** n = round·N + me with round ≥ 1, so numbers are unique across
  proposers and increasing per proposer (§2.2's disjoint sets).
- **C3 — no NACKs.** Refusals are silence (§2.2 allows ignoring). Progress relies on retry with
  a higher number rather than on rejection hints.
- **C4 — accepting raises `promised`.** The paper's acceptor may accept a proposal numbered
  lower than one it accepted earlier (P1a only looks at prepares answered), and must then
  report the *highest* accepted proposal in later promises. We instead set
  `promised = max(promised, n)` when accepting, so a lower-numbered accept is refused and the
  stored accepted proposal is the highest by construction. This is a strengthening the paper
  explicitly permits — an acceptor may always ignore a request — and it removes a class of
  bookkeeping bugs (reporting a later-but-lower accept) rather than adding behaviour.
- **C5 — liveness by randomized retry.** A proposer whose attempt has not produced a learned
  value retries with a fresh, higher number after a randomized timeout (`ctx.randomInt`,
  150–300 ms), the same symmetry-breaking idea as Raft's election timeouts. §2.4 is explicit
  that without a distinguished proposer progress is not guaranteed; the retry makes livelock
  improbable, not impossible.
- **C6 — Accepted is broadcast to every node** (§2.3 offers the acceptors-inform-all-learners
  option and the distinguished-learner optimisation; we take the simple option). Cost: message
  count, not safety.
- **C7 — persistence is the engine's declarative list** (SPEC §3). `promised`, `acceptedN`,
  `acceptedV` survive a crash; the paper's requirement that an acceptor record its response
  *before* sending it is a write-ordering discipline the engine cannot observe in v0 — as with
  Raft, the discipline is enforced by review: state is assigned before `ctx.send` in every
  handler.
- **C8 — proposer and learner state is volatile.** A proposer that crashes abandons its attempt
  (safe: its number is never reused, its accepts stand); a learner that crashes forgets its
  tally and its learned value, and re-learns only from traffic that still flows. Catch-up is
  out of scope.

## Invariants

In `packages/protocols/src/paxos/invariants.ts`, factories with history like Raft's (create
fresh instances per run):

- `agreement()` — no two nodes ever learn different values, across the whole run, crashes
  included; a node's learned value never changes. This is the one that catches data loss: two
  proposers each convinced their value was chosen.
- `validity()` — a learned value was proposed by some node at some point.
- `proposalIntegrity()` — one value per proposal number, ever, anywhere: catches a broken C2
  and any phase-2 rebinding (#5).

The fuzz gate runs all three. Agreement alone can hold vacuously on a seed where nothing is
ever learned — the fuzz test therefore also asserts a floor of seeds that did learn (the
positive sibling; CLAUDE.md).

## Test scenarios that must pass

1. One proposer, lossy network: every live node learns that value.
2. Three concurrent proposers with duplication and reordering: exactly one value is learned
   anywhere, it is one of the three (validity), and all three demonstrably attempted.
3. Partition [1,2] | [3,4,5] with the proposer in the minority: nothing is learned during the
   partition (and the minority proposer demonstrably kept trying — the positive sibling);
   after healing, one value is chosen everywhere. This scenario's trace hash is pinned.
4. A value is chosen; an acceptor from the accepting majority crashes and restarts; a new
   proposer with a fresh, higher number is forced to propose the chosen value, not its own.
5. Fuzz across seeds with loss, partitions and crashes: `agreement`, `validity` and
   `proposalIntegrity` hold on every seed, and a floor of seeds actually learn.

Pattern tests `paxos-01` … `paxos-05` were each run against the naive form they exist to catch
(accept with `>` instead of `≥`; phase 2 taking the first or own value; counting stale or
duplicate promises) and fail against it; the PR description records the runs.
