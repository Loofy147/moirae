# examples

Two fixed Raft scenarios on the engine. The scripts and their pinned trace hashes are the record;
the traces are regenerated, not committed.

- `src/clean-partition.ts` — one partition, one crash, a readable story. The studio renders this
  one. It is a demo, not a correctness argument; see the comment at the top of the file.
- `src/harsh.ts` — duplication, two consecutive partitions with different splits, three crashes.
  The stress case.

```
pnpm examples          # runs both, asserts the pinned hashes, writes out/<name>.jsonl
```

`test/examples.test.ts` runs in CI with the rest of the suite, so an engine or protocol change
that alters either trace by a byte fails the build. If the change was deliberate, update the hash
in the same commit and say why.
