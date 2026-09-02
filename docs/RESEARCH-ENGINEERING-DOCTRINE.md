# Research Engineering Doctrine

**Status:** Governing baseline for protocol research
**Date:** 2026-09-02

## 1. Purpose

This document defines the engineering method used to evolve Moirae from a protocol implementation into an executable protocol laboratory.

The governing chain is:

```text
Specification
→ Executable Model
→ Invariants
→ Adversarial Exploration
→ Independent Checker
→ Minimal Counterexample
→ Reproducible Evidence
```

A feature is not considered verified merely because unit tests pass. The verification claim must identify the model, assumptions, invariant or semantic property, adversarial schedule, and evidence boundary.

## 2. System-model discipline

Every protocol change must state explicitly:

- failure model;
- communication model;
- timing assumptions;
- persistence and recovery model;
- quorum assumptions;
- safety properties;
- liveness properties;
- fairness assumptions, where applicable;
- behavior intentionally left unspecified.

Safety and liveness must never be conflated. Safety claims are evaluated under all schedules permitted by the declared model. Liveness claims require explicit assumptions under which progress is expected.

## 3. Reference-model discipline

The implementation must not be its own only oracle.

For important protocol behavior, maintain an independent semantic reference at a more abstract level. The preferred progression is:

```text
Abstract state machine
→ executable implementation
→ observed trace
→ semantic comparison
```

A future formal-model layer may use TLA+ or an equivalent formalism. The formal model complements rather than replaces the deterministic simulator and implementation tests.

## 4. Verification layers

Verification is layered rather than tool-centric:

1. conformance tests for explicit protocol rules;
2. state/invariant checks;
3. deterministic adversarial scenarios;
4. model-based/stateful exploration;
5. deterministic fuzzing;
6. bounded history/linearizability checking;
7. mutation testing to measure test sensitivity;
8. differential testing against an independent model or implementation;
9. repository-wide CI and reproducibility checks.

No single layer is treated as sufficient evidence for the whole protocol.

## 5. History and counterexample discipline

Concurrent histories are first-class evidence. A failing run should preserve:

- seed and configuration;
- operation sequence;
- fault/scheduling decisions;
- relevant state transitions;
- completed and incomplete operations;
- the semantic violation;
- a minimized history when possible.

The bounded history checker is intentionally independent of protocol execution logic. Future optimization may introduce compositionality and other state-space reductions, but correctness of the checker must remain auditable.

## 6. Adversarial scheduling

Random faults are useful for exploration but insufficient for diagnosis. The simulator should progressively support explicit schedules that target:

- message reordering;
- duplication;
- finite delay;
- quorum boundary conditions;
- partition/heal sequences;
- crash/restart boundaries;
- stale post-restart messages;
- concurrent overlapping operations;
- persistence/recovery boundaries.

A minimized deterministic schedule is preferred over a large random trace as final evidence.

## 7. Mutation and test-strength policy

Mutation testing answers a different question from coverage:

> Can the verification suite distinguish the correct protocol from a deliberately broken one?

Mutation results count only from a known-green baseline. Every protocol invariant should eventually have at least one targeted mutation or equivalent negative control demonstrating that the verification layer can detect its violation.

## 8. Learning and implementation priorities

The project should build depth in this order:

```text
Distributed consistency
→ failure models
→ state machines
→ invariants
→ formal specification
→ model checking
→ model-based testing
→ fuzzing/mutation/differential testing
→ recovery semantics
→ advanced distributed protocols
```

ABD, quorum systems, linearizability, happens-before, Paxos/Raft boundaries, crash recovery, safety/liveness reasoning, and TLA+ are core study areas. Byzantine algorithms and reconfiguration remain knowledge prerequisites, not immediate implementation scope.

## 9. Scope discipline

Do not add complexity merely because it is theoretically interesting. A new mechanism enters implementation scope only when it:

1. closes a demonstrated verification gap;
2. corresponds to a declared protocol requirement;
3. has an executable acceptance criterion;
4. has a testing strategy that can falsify it;
5. does not silently change the declared system model.

## 10. Current Moirae gate

For ABD v0, the next engineering gates are:

- complete and preserve the current ABD conformance contract;
- execute the full CI suite on the exact candidate commit;
- close the remaining fault-matrix pending cases;
- strengthen adversarial schedule generation;
- compare simulator behavior with an independent abstract model;
- evaluate mutation sensitivity from a green baseline;
- add a formal model only after the executable contract is stable.

No multi-writer, Byzantine, reconfiguration, or lossy-channel retry implementation should be started before these gates are satisfied.

## 11. Decision rule

When evidence conflicts with intuition, the evidence wins. When two verification layers disagree, preserve both artifacts and investigate the model boundary rather than weakening the failing layer to make the system green.
