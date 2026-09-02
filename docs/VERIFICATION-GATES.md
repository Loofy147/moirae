# Verification Gates — ABD v0

**Status:** governing execution gate
**Date:** 2026-09-02
**Base:** `feat/abd-atomic-register`

This document converts `RESEARCH-ENGINEERING-DOCTRINE.md` into executable gates for ABD v0. A gate is closed only when its acceptance evidence exists on the exact candidate commit.

## Gate G0 — Candidate integrity

**Purpose:** ensure that verification is performed against the intended source.

Required:

- clean candidate commit identified;
- no unrelated bounty material in the protocol branch;
- protocol documentation and implementation describe the same v0 model;
- exact commit SHA recorded in CI evidence.

**Pass condition:** the candidate is reviewable as one coherent ABD change set.

## Gate G1 — Conformance

Required protocol rules:

- single designated writer;
- strict-majority completion;
- lexicographic `(counter, writerId)` tags;
- monotone replica application;
- two-phase read with mandatory phase-2 write-back;
- durable register, writer counter, and operation-id allocator;
- duplicate responses cannot count twice;
- incomplete operations do not become completed-history evidence.

**Pass evidence:** red-first tests and normal conformance tests.

## Gate G2 — Semantic history

The bounded history checker must independently evaluate completed histories.

Required negative controls:

- stale read after completed write is rejected;
- future-tag read before its write is rejected.

Required positive controls:

- sequential write/read is accepted;
- overlapping operations with a legal ordering are accepted;
- incomplete operations are ignored for completed-history linearizability.

**Pass condition:** the checker detects semantic invalidity rather than merely malformed traces.

## Gate G3 — Fault schedule matrix

The minimum deterministic campaign must cover:

| Schedule | Expected safety/liveness result |
|---|---|
| duplicate response/ack | quorum count remains distinct |
| reorder old/new tag | register never regresses |
| finite delay | no completed-history safety violation |
| writer minority partition | write does not complete |
| reader minority partition | read does not complete |
| partition heal | later completed reads do not regress |
| crash before write completion | no fabricated completion |
| crash after durable state | register/counter/id allocator survive |
| stale post-restart response | old response cannot satisfy new operation |
| equal-tag duplicate/conflict | deterministic no-regression behavior |

**Pass condition:** each row has a deterministic scenario and an observed result.

## Gate G4 — Stateful adversarial exploration

Random fuzzing is not sufficient. The scheduler campaign should deliberately construct overlapping operations around:

- quorum boundaries;
- partition and healing boundaries;
- crash/restart boundaries;
- delayed stale messages;
- concurrent reads and writes.

Every discovered failure must retain seed/configuration and a minimized schedule where possible.

**Pass condition:** at least one deterministic adversarial campaign covers each fault family above without relying on random coincidence.

## Gate G5 — Independent reference model

Add a small abstract single-register model independent of the implementation handlers. It must represent only:

```text
initial tagged value
write(tag,value) -> installed max tag/value
read() -> current tag/value
```

The model must not import protocol mutation helpers such as `compareTags` from the implementation.

The first integration target is completed-history replay and final-state/reference agreement for deterministic scenarios. A formal TLA+ model is deferred until this executable reference contract is stable.

**Pass condition:** simulator observations can be checked against a separately implemented semantic model.

## Gate G6 — Mutation sensitivity

Mutation results are admissible only after G1–G5 have a green baseline.

At minimum, targeted mutants must attempt:

- remove phase-2 write-back;
- reduce quorum by one participant;
- allow non-monotone tag replacement;
- reuse an operation id after restart.

**Pass condition:** every targeted mutant is detected by a specific verification layer; surviving mutants become explicit gaps.

## Gate G7 — Reproducibility

Required:

- deterministic seed;
- deterministic trace serialization;
- exact candidate SHA;
- CI execution;
- repeatable test command in repository documentation.

**Pass condition:** the same candidate produces the same semantic result and trace under the supported CI matrix.

## Gate G8 — Release decision

ABD v0 may be considered verification-complete only when G0–G7 are closed. Until then, the branch is a research candidate, not a proven release.

## Explicit non-goals

Do not start these implementations as part of ABD v0 gate closure:

- multi-writer ABD;
- Byzantine tolerance;
- membership reconfiguration;
- lossy-channel retry/liveness;
- batching/pipelining.
