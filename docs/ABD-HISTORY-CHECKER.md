# ABD bounded history checker

This file is a verification design note for the completed-operation history checker added for issue #31.

## Model

An operation is represented by its invocation sequence, completion sequence, kind, and observed tag.

A candidate sequentialization is legal only when:

- every completed operation appears exactly once;
- if operation A completes before operation B begins, A precedes B;
- a read returns the tag installed by the last preceding write, or the initial tag when no write precedes it.

Overlapping operations may be ordered either way when the sequential register semantics permit it.

## Scope

The checker is intentionally bounded and completed-history only. It does not establish liveness and it does not classify incomplete operations as failures.

The simulator trace is the source of operation intervals. `historyFromTrace()` is responsible only for extracting completed ABD operations; `isLinearizable()` is the semantic decision procedure.

## Evidence standard

The test suite must contain:

- a simple legal write/read history;
- a legal overlapping read-before-write history;
- an illegal stale read after a completed write;
- an illegal future-tag read before the corresponding write can linearize;
- a legal overlapping multi-write/read history;
- trace extraction with incomplete operations ignored.
