# DECISIONS.md

Architecture decision records for moira. Append only. An accepted ADR is never edited — it is
superseded by a new one.

---

# ADR-001: TypeScript for the engine, not Rust or Go

**Status:** Accepted
**Date:** 2026-08-02
**Deciders:** @pchrysostomou

## Context

Every existing deterministic simulation testing framework is Rust-centric: madsim, turmoil,
anysystem. They are good engines with no accessible surface. The gap this project targets is not
"a better engine" — it is "a DST engine people can actually see and reach". A solo maintainer
cannot out-engineer RisingWave or Antithesis; the bet is on accessibility and visibility.

## Options Considered

### Option A: Rust

| Dimension | Assessment |
|---|---|
| Complexity | High — async runtime interception is the hard part |
| Contributor pool | Small, expert, low volume |
| Browser story | wasm, real work, degraded DX |
| Team familiarity | Low |

**Pros:** credibility with the systems crowd; performance for large fuzz runs; the right long-term
answer if this ever becomes production infrastructure.
**Cons:** competing head-on with madsim and turmoil on their turf, with less experience; no
browser demo without a wasm detour, which kills the growth mechanism.

### Option B: Go

| Dimension | Assessment |
|---|---|
| Complexity | Medium, but the goroutine scheduler is nondeterministic and hostile to this |
| Contributor pool | Large |
| Browser story | Poor |
| Team familiarity | Medium |

**Pros:** familiar, large contributor pool, natural fit for distributed systems code.
**Cons:** forcing determinism on top of goroutines means either banning them entirely or building
a custom scheduler; both are worse than starting from a single-threaded language.

### Option C: TypeScript

| Dimension | Assessment |
|---|---|
| Complexity | Low — single-threaded by default is exactly what DST wants |
| Contributor pool | Largest |
| Browser story | Native; the same engine runs the UI demo |
| Team familiarity | High |

**Pros:** the language's single-threaded event loop is the model we want anyway; one codebase
serves both the CI library and the in-browser playground; the lowest possible barrier for a
first-time contributor adding a protocol.
**Cons:** the systems community will read it as "not serious"; performance ceiling on large fuzz
campaigns; no compile-time guarantee against nondeterminism.

## Trade-off Analysis

The Rust option optimises for credibility and the TypeScript option optimises for reach. Reach is
the scarcer resource here: a technically excellent engine with no users is the default outcome for
this category, and the browser demo is the single mechanism most likely to prevent it. The
performance ceiling is real but distant — v0 fuzz targets are thousands of seeds, not millions.

The "not serious" objection is answered by the determinism test in CI, not by the language choice.

## Consequences

- The browser playground and the shareable failing seed become possible in v0 rather than v2.
- Nondeterminism must be prevented by lint rule and review rather than by the type system, which
  makes ADR-002 load-bearing.
- If the project outgrows TypeScript, the trace format (ADR-003) is the migration path: a Rust
  engine emitting the same JSONL keeps the entire UI and tooling layer intact.

## Action Items

1. [ ] ESLint rule banning ambient nondeterminism in `core` and `protocols`
2. [ ] Determinism hash test in CI from Phase 1 onward
3. [ ] Revisit this ADR if a single fuzz campaign takes over an hour on a laptop

---

# ADR-002: Determinism is enforced by lint, and the lint rule is never disabled

**Status:** Accepted
**Date:** 2026-08-02

## Context

TypeScript cannot stop a contributor writing `Date.now()` inside a protocol. One such call makes
every trace irreproducible and silently destroys the project's only real promise. Failures would
be intermittent and would be blamed on the protocol, not on the missing rule.

## Decision

A `no-restricted-globals` / `no-restricted-properties` ESLint configuration bans all ambient
sources of time, randomness, scheduling, IO and network inside `packages/core` and
`packages/protocols`. Inline disable comments for this rule are forbidden and CI fails on them.
Time, randomness and scheduling are available only through `ctx`.

## Consequences

- Easier: reviewing a protocol PR from a stranger — if lint is green, the biggest class of
  correctness failure is already excluded.
- Harder: legitimate needs (benchmark timing, ID generation) require an explicit engine-provided
  escape hatch rather than reaching for the standard library.
- To revisit: whether the ban should be a custom rule that also catches nondeterministic
  collection iteration, which the standard rules cannot see.

---

# ADR-003: The trace file is the contract between engine and UI

**Status:** Accepted
**Date:** 2026-08-02

## Context

FoundationDB's simulator emits JSON traces that a separate visualiser parses. That separation is
not an accident of history — it is what lets the visualiser survive engine rewrites, lets users
share a failure by sending a file, and lets third parties build tooling without linking the engine.

The tempting alternative is to have the UI drive the engine in-process, which is simpler for a
live playground and couples the two permanently.

## Decision

The engine emits append-only JSONL. The studio is a pure function of that file and imports only
the trace schema type from the engine package. Live in-browser execution, when it arrives, works
by running the engine to produce a trace and feeding the same renderer.

## Consequences

- Easier: sharing failures (a trace is a file), building alternative viewers, replacing the engine
  language later.
- Harder: interactive stepping through a live simulation needs an extra streaming layer.
- Trace format changes become breaking changes and need a version field from day one.

---

# ADR-004: Zero runtime dependencies in the engine

**Status:** Accepted
**Date:** 2026-08-02

## Context

A testing tool whose job is reproducibility cannot outsource its randomness, its ordering or its
data structures to packages that may change behaviour across patch versions. A transitive
dependency that reorders a map iteration silently breaks every stored seed in existence.

## Decision

`packages/core` has zero runtime dependencies. PRNG, priority queue, hashing and deep-freeze are
written in-repo — each is under a hundred lines. Dev dependencies (vitest, tsup, eslint) are
unrestricted. `apps/studio` is unrestricted.

## Consequences

- Easier: auditing, supply-chain posture, and guaranteeing that a seed recorded today reproduces
  in five years.
- Harder: a little more code to write and test up front.
- To revisit: never, for `core`. This is the constraint that makes the reproducibility claim true.

---

# ADR-006: The project is named nemea, not moira

**Status:** Accepted
**Date:** 2026-08-30

## Context

The project was called moira — fate — because a deterministic simulator is a fate machine, and
the name did work. At launch preparation `moira` turned out to be taken on npm by an unrelated
package published nine years earlier. `npx moira demo`, the first line of the README, could never
have resolved to this project.

Names that kept the meaning were checked in order of preference: `ananke` (necessity), `atropos`
(the Fate who cannot be turned), `lachesis` (the Fate who measures out). All three are taken on
npm. The fallback rule set beforehand: the shortest candidate nobody will misspell.

## Decision

The project, the CLI package and the npm scope are `nemea` / `@nemea/*`. The GitHub repository is
renamed (the old name redirects). No document anywhere writes `npx moira`, because that resolves to
someone else's package.

ADR-001 to ADR-005 keep the old name in their text: they are records of decisions as made, and an
accepted ADR is never edited.

The `@nemea` npm scope could not be confirmed free before publishing (npm does not expose scope
ownership to unauthenticated clients); it is verified at first publish, and if it is taken the
libraries publish unscoped as `nemea-core` and `nemea-protocols`.

## Consequences

- Easier: a name that resolves, and a README whose first command works.
- Harder: a rename after eight merged PRs — a mechanical find-and-replace, done in one commit.
- To revisit: never; after launch a name is permanent.

---

# ADR-005: v0 ships one protocol, not a protocol library

**Status:** Accepted
**Date:** 2026-08-02

## Context

The long-term scope is deliberately infinite — Paxos, Viewstamped Replication, SWIM, HyParView,
CRDTs, 2PC, chain replication. The failure mode is shipping five half-implemented protocols and no
credible engine, which is what most educational simulators are.

## Decision

v0 ships Raft, implemented properly, as the proof that the engine is expressive enough. The other
protocols become the contributor surface after launch — each one a self-contained pull request
against a stable `Process` interface.

## Consequences

- Easier: a sharp definition of done, and a strong first PR template for contributors.
- Harder: resisting the urge to add gossip "because it's quick".
- To revisit: after the interface has survived two externally contributed protocols without a
  breaking change, it can be declared stable.
