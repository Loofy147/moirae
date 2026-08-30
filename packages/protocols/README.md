# @nemea/protocols

Protocol implementations for the [nemea](https://github.com/pchrysostomou/nemea) deterministic
simulator. v0 ships one: Raft.

`Raft` is a transcription of Ongaro & Ousterhout, *In Search of an Understandable Consensus
Algorithm* (USENIX ATC 2014): leader election, log replication, the §5.4 safety restrictions, and
persistence across simulated crashes. Every handler cites the rule it implements, and every
deliberate deviation from the paper is named in
[docs/RAFT.md](https://github.com/pchrysostomou/nemea/blob/main/docs/RAFT.md). The ten classically
mis-implemented rules — term comparison, the Figure 8 commit rule, conflict-only truncation, the
election restriction, and the rest — each have a test that was first shown to fail against the
naive form.

Also here, as engine invariants: the Figure 3 safety properties `electionSafety()`, `logMatching()`
and `stateMachineSafety()`.

```ts
import { simulate } from '@nemea/core';
import { Raft, electionSafety, logMatching, stateMachineSafety } from '@nemea/protocols';

const result = simulate({
  seed: 19,
  nodes: 5,
  process: Raft,
  until: { simTime: 6_000 },
  network: {
    latency: [10, 50],
    dropRate: 0.02,
    partitions: [{ groups: [[1, 2], [3, 4, 5]], start: 1500, end: 3500 }],
  },
  invariants: [electionSafety(), logMatching(), stateMachineSafety()],
});
```

The bare `Raft` elects leaders and replicates whatever is proposed; to feed it entries, subclass
it and call `propose(ctx, command)` from a timer — the repository's `examples` show how.

Out of scope in v0: membership changes, snapshots, client interaction, pre-vote. Read RAFT.md
before contributing a handler. Apache-2.0.
