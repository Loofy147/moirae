# docs/RAFT.md — implementation notes

Source of truth: Ongaro & Ousterhout, *In Search of an Understandable Consensus Algorithm*
(USENIX ATC 2014), and Ongaro's PhD thesis, *Consensus: Bridging Theory and Practice* (2014).
Section numbers below refer to the ATC paper.

This file is a checklist, not a substitute for the paper. Read Figure 2 in the original before
writing a single handler. Everything below is restated in our own words; where our wording and the
paper disagree, the paper wins.

## Scope for v0

In: leader election, log replication, the safety restrictions of §5.4, persistence as an in-memory
stub that survives simulated restarts.
Out: membership changes (§6), log compaction / snapshots (§7), client interaction and linearizable
reads (§8), pre-vote, leadership transfer, batching, pipelining.

Entries enter the log through `Raft.propose(ctx, command)` — the leader-side append of §5.3 and
nothing more. The test workload drives it; the shipped class contains no client logic (no sessions,
no deduplication, no reads). Leaders do not append a no-op entry at the start of their term (that
is §8 territory), so an entry from an earlier term becomes committed only once an entry of the
current term is on a majority — which is exactly Figure 8's point, and what scenario 4 checks.

## Persistent vs volatile state

Persistent on every server, written before responding to any RPC: current term, the candidate voted
for in the current term, and the log. In our simulator, "persist" means listing the field in
`Process.persistent` so it survives a crash → restart (SPEC §3). The discipline stands — every
handler updates persistent fields before any `ctx.send`, with a comment citing Figure 2 — but the
ordering is *not observable* in v0: state is snapshotted at the crash event and handlers are
instantaneous, so no test claims to check it. It becomes testable when crash points inside handlers
land; that is a deferred engine capability, not an oversight.

Volatile: commit index, last applied index. On a leader, additionally the next index and match index
per follower, both reinitialised on election.

## The rules that are almost always implemented incorrectly

Each of these is a real, frequently-copied bug. Test each one explicitly.

**1. Term comparison happens before anything else.**
Any incoming RPC or response carrying a term greater than ours: adopt that term, become a follower,
and clear the recorded vote. This check runs before the handler's own logic, on requests *and* on
responses. Any RPC whose term is below ours is rejected without further processing.

**2. Committing entries from previous terms (§5.4.2, Figure 8).**
A leader may not conclude that an entry from an earlier term is committed merely because it is
replicated on a majority. It only advances the commit index for an entry replicated on a majority
**whose term equals the leader's current term**; earlier entries then become committed indirectly.
Skipping this produces a system that passes every happy-path test and loses committed data under a
specific partition sequence. Figure 8 in the paper is exactly that sequence — implement it as a test.

**3. Truncating the log on every AppendEntries.**
The follower deletes existing entries only where an entry genuinely *conflicts* — same index,
different term. It must not blindly truncate from the previous log index onward, because a delayed
or duplicated AppendEntries carrying an older suffix would then delete committed entries. The
engine's default network is immediate and lossless; the scenario tests configure `duplicateRate`
and a latency range so that this bug surfaces.

**4. The election restriction (§5.4.1).**
A server refuses its vote if the candidate's log is less up to date than its own. "More up to date"
compares the last entry's term first; only when those are equal does the longer log win. Getting the
comparison backwards or comparing indices first breaks leader completeness.

**5. Resetting the election timer for the wrong reasons.**
The timer resets on: receiving AppendEntries from the *current* leader, granting a vote, and starting
an election. It does not reset on a rejected AppendEntries, on a stale-term RPC, or on receiving a
vote request one declines. Over-eager resetting stalls elections in ways that look like liveness bugs
in the engine. "Rejected" here means rejected for a stale term: an AppendEntries from the current
term's leader resets the timer even when its consistency check fails (as in the authors' LogCabin),
because a lagging follower must not start elections while a live leader is walking its next index
back.

**6. Acting on stale RPC responses.**
By the time a response arrives, the term may have advanced or we may no longer be leader. Before
applying any response, verify that our term is unchanged since the request was sent and that our role
still matches. In this simulator, delays are large and this path is exercised constantly.

**7. Match index derived from the wrong number.**
On a successful AppendEntries, the follower's match index is set from the entries actually sent in
*that* request, not from the leader's current log length, which may have grown since. Next index
decrements on failure; match index never moves backwards.

**Deviation D1 from Figure 2.** The paper's AppendEntries response is `(term, success)` and the
leader infers the matched index from its own next index — wrong under reordering and duplication.
Here the follower echoes `matchIndex = prevLogIndex + entries.length` in its response and the
leader sets match index from that. The deviation is safe because the leader's match index is
monotonic: a stale or duplicated response can only ever propose a value it already passed. That
property is what makes D1 correct, so it is a test, not a comment — replaying an old success
response after match index has advanced must not move it backwards
(`test/raft-07-08-replication.test.ts`).

**8. Leaders never overwrite their own log.**
A leader only appends. If leader code contains a truncation, it is wrong.

**9. Election timeouts must be randomised.**
Drawn per node, per election, from `ctx.random()`, over a range comfortably larger than the network's
round-trip time. A fixed timeout produces endless split votes; the paper's guidance on the ratio
between broadcast time, election timeout and mean time between failures applies.

**10. Applying to the state machine.**
Entries are applied in index order, exactly once, only up to the commit index. The commit index is
monotonic and never decreases, even when a new leader's view differs.

## The five safety properties

These are the invariants worth encoding, in `packages/protocols/src/raft` — they are typed on
Raft's state, and core stays protocol-agnostic (§5, Figure 3):

| Property | Statement |
|---|---|
| Election Safety | No more than one leader exists in a given term. |
| Leader Append-Only | A leader never overwrites or deletes entries in its own log. |
| Log Matching | If two logs hold an entry with the same index and term, the logs are identical up to that index. |
| Leader Completeness | An entry committed in some term is present in the log of every leader of every later term. |
| State Machine Safety | If a server has applied an entry at a given index, no server ever applies a different entry at that index. |

v0 ships checkers for Election Safety, Log Matching and State Machine Safety — `electionSafety()`,
`logMatching()`, `stateMachineSafety()`, factories because the first and the last keep a history
across checks (a leader that stepped down, or an entry applied by a server that then crashed, is
invisible to a check of current state alone).

**The fuzz gate requires at least one of State Machine Safety or Leader Completeness.** Election
Safety and Log Matching both hold while the Figure 8 sequence loses a committed entry: there is one
leader per term, the logs stay mutually consistent, and the data is gone anyway. A fuzz run guarded
by those two alone is nearly worthless. Leader Completeness and Leader Append-Only are good first
contributions once the interface is stable.

## Test scenarios that must pass

1. Five nodes, no faults: exactly one leader, entries replicate, all logs identical.
2. Leader crashes: a new leader is elected and the cluster continues.
3. Partition `[1,2] | [3,4,5]`: the minority elects no leader; on healing, one leader remains and
   logs converge.
4. The Figure 8 sequence: an entry replicated on a majority under an old term is *not* treated as
   committed, and the outcome does not violate State Machine Safety.
5. Duplicated and reordered AppendEntries do not cause a follower to lose committed entries.
6. Fuzz across 1000 seeds with 2% drop rate and random partitions: no invariant violation.
   (200 seeds run in CI on every push; 1000 before a release, until the §8 fuzz CLI exists.)

If scenario 4 passes on the first attempt, be suspicious and check that the test actually
reproduces the sequence rather than trivially succeeding.
