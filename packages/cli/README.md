<p align="center">
  <img src="https://raw.githubusercontent.com/pchrysostomou/nemea/e5ac3ecc0e63b1d24821fb5a4c4b641825193265/docs/nemea-demo.gif" width="800" alt="Five Raft nodes on a timeline. A partition cuts two of them off; they turn amber again and again trying to elect a leader, every vote request dies at the wall, and they never turn blue. The other three keep their leader. When the wall lifts, one election settles it.">
</p>

# nemea

You just watched five Raft nodes lose their network for two seconds. The two on the wrong side of
the wall tried twelve times to elect a leader and never could — every vote request died at the
wall. The three on the right side kept theirs. When the wall came down, one election settled it,
and a node that crashed came back with its log intact.

This is v0: one protocol (Raft), no trace shrinking, no Byzantine faults, no membership changes,
no pre-vote, nothing hosted. If you arrived expecting Antithesis, this is the small, readable,
TypeScript end of that idea — not a replacement for it.

```
npx nemea demo
```

runs that scenario on your machine, prints what happened, writes `nemea-demo.jsonl`, and opens
it in the studio. One package, no dependencies, nothing to build.

```
npx nemea replay some-trace.jsonl
```

opens any trace the engine wrote. A trace replays byte for byte on any machine.

Source, documentation, and the engine as a library (`@nemea/core`, `@nemea/protocols`):
https://github.com/pchrysostomou/nemea. Apache-2.0.
