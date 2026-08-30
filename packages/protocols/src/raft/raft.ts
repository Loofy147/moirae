// Raft, transcribed from Ongaro & Ousterhout (USENIX ATC 2014). Read Figure 2
// before touching any handler. Every rule cites its section; every deliberate
// deviation from the paper is named in docs/RAFT.md.
//
// Persistence discipline: currentTerm, votedFor and log are updated before any
// ctx.send in every handler (Figure 2: "updated on stable storage before
// responding to RPCs"). SPEC §3 records that the engine cannot observe this
// ordering in v0; the discipline is enforced by review, not by a test.

import type { Ctx, Message, NodeId, Process } from '@nemea/core';
import type {
  AppendEntries,
  AppendEntriesResponse,
  RaftMessage,
  RequestVote,
  RequestVoteResponse,
} from './messages';
import {
  ELECTION_TIMEOUT_MAX,
  ELECTION_TIMEOUT_MIN,
  ELECTION_TIMER,
  HEARTBEAT_INTERVAL,
  HEARTBEAT_TIMER,
  type Command,
  type RaftState,
} from './state';

export class Raft implements Process<RaftState> {
  // Figure 2, "Persistent state on all servers".
  readonly persistent = ['currentTerm', 'votedFor', 'log'] as const;

  init(ctx: Ctx<RaftState>): RaftState {
    // §5.2 — "When servers start up, they begin as followers."
    const state: RaftState = {
      currentTerm: 0,
      votedFor: null,
      log: [],
      commitIndex: 0,
      lastApplied: 0,
      applied: [],
      nextIndex: {},
      matchIndex: {},
      role: 'follower',
      leaderId: null,
      votesGranted: [],
    };
    this.resetElectionTimer(ctx);
    return state;
  }

  onMessage(ctx: Ctx<RaftState>, from: NodeId, msg: Message): void {
    const m = msg as RaftMessage;
    const s = ctx.state;
    // §5.1 / Figure 2 "All Servers" — "If RPC request or response contains
    // term T > currentTerm: set currentTerm = T, convert to follower." This
    // runs before the handler's own logic, on requests and on responses.
    if (m.term > s.currentTerm) {
      s.currentTerm = m.term; // persisted before any response below
      s.votedFor = null;
      this.becomeFollower(ctx);
    }
    // Figure 2 — RequestVote and AppendEntries both "reply false if
    // term < currentTerm"; a response from an older term is stale (§5.1) and
    // ignored. Neither is processed further, and neither touches a timer.
    if (m.term < s.currentTerm) {
      if (m.type === 'RequestVote') {
        ctx.send(from, { type: 'RequestVoteResponse', term: s.currentTerm, voteGranted: false });
      } else if (m.type === 'AppendEntries') {
        ctx.send(from, {
          type: 'AppendEntriesResponse',
          term: s.currentTerm,
          success: false,
          matchIndex: 0,
        });
      }
      return;
    }
    switch (m.type) {
      case 'RequestVote':
        this.onRequestVote(ctx, from, m);
        break;
      case 'RequestVoteResponse':
        this.onRequestVoteResponse(ctx, from, m);
        break;
      case 'AppendEntries':
        this.onAppendEntries(ctx, from, m);
        break;
      case 'AppendEntriesResponse':
        this.onAppendEntriesResponse(ctx, from, m);
        break;
    }
  }

  // §5.3 — "The leader appends the command to its log as a new entry, then
  // issues AppendEntries RPCs in parallel to each of the other servers to
  // replicate the entry." This is the leader-side append and nothing more:
  // client sessions, deduplication and reads (§8) are out of scope (RAFT.md).
  // A leader only ever appends to its log (RAFT.md #8).
  propose(ctx: Ctx<RaftState>, command: Command): boolean {
    const s = ctx.state;
    if (s.role !== 'leader') return false;
    s.log.push({ term: s.currentTerm, command }); // persisted before sending
    for (const peer of ctx.peers) this.sendAppendEntries(ctx, peer);
    this.advanceCommitIndex(ctx); // a single-server cluster commits here
    return true;
  }

  // Figure 2, Leaders — "If there exists an N such that N > commitIndex, a
  // majority of matchIndex[i] ≥ N, and log[N].term == currentTerm: set
  // commitIndex = N." §5.4.2 / RAFT.md #2: a leader never counts replicas to
  // decide that an entry from a previous term is committed — only an entry
  // from its own term commits by counting, and earlier entries commit
  // indirectly with it (Figure 8). Skipping the term check loses committed
  // entries under the Figure 8 sequence.
  private advanceCommitIndex(ctx: Ctx<RaftState>): void {
    const s = ctx.state;
    const cluster = ctx.peers.length + 1;
    for (let n = s.log.length; n > s.commitIndex; n--) {
      if ((s.log[n - 1] as { term: number }).term !== s.currentTerm) continue;
      let replicated = 1; // ourselves
      for (const peer of ctx.peers) {
        if ((s.matchIndex[String(peer)] ?? 0) >= n) replicated++;
      }
      if (replicated * 2 > cluster) {
        s.commitIndex = n;
        break;
      }
    }
    this.applyCommitted(ctx);
  }

  private onAppendEntriesResponse(
    ctx: Ctx<RaftState>,
    from: NodeId,
    m: AppendEntriesResponse,
  ): void {
    const s = ctx.state;
    // RAFT.md #6 — only a leader acts on these, and only for its current
    // term (a higher term was handled by the term rule; a lower one was
    // discarded). After stepping down, late responses change nothing.
    if (s.role !== 'leader' || m.term !== s.currentTerm) return;
    const key = String(from);
    if (m.success) {
      // Figure 2, Leaders — "If successful: update nextIndex and matchIndex
      // for follower." RAFT.md #7 / deviation D1: from what *that* request
      // covered, echoed by the follower, never from our current log length.
      // matchIndex is monotonic: a stale or duplicated response can only
      // propose a value already passed, which is what makes D1 safe under
      // duplication and reordering.
      const known = s.matchIndex[key] ?? 0;
      if (m.matchIndex > known) {
        s.matchIndex[key] = m.matchIndex;
        s.nextIndex[key] = m.matchIndex + 1;
        this.advanceCommitIndex(ctx);
      }
    } else {
      // Figure 2, Leaders — "If AppendEntries fails because of log
      // inconsistency: decrement nextIndex and retry" (§5.3). One step at a
      // time, as in the paper; no fast backup.
      s.nextIndex[key] = Math.max(1, (s.nextIndex[key] ?? s.log.length + 1) - 1);
      this.sendAppendEntries(ctx, from);
    }
  }

  onTimer(ctx: Ctx<RaftState>, name: string): void {
    switch (name) {
      case ELECTION_TIMER:
        this.startElection(ctx);
        break;
      case HEARTBEAT_TIMER:
        // §5.2 — leaders send periodic heartbeats to maintain authority.
        if (ctx.state.role === 'leader') this.sendHeartbeats(ctx);
        break;
    }
  }

  private onRequestVote(ctx: Ctx<RaftState>, from: NodeId, m: RequestVote): void {
    const s = ctx.state;
    // §5.4.1 — election restriction. "If the logs have last entries with
    // different terms, then the log with the later term is more up-to-date.
    // If the logs end with the same term, then whichever log is longer is
    // more up-to-date." The voter denies if its own log is more up-to-date.
    const lastIndex = s.log.length;
    const lastTerm = lastIndex > 0 ? (s.log[lastIndex - 1] as { term: number }).term : 0;
    const candidateUpToDate =
      m.lastLogTerm > lastTerm || (m.lastLogTerm === lastTerm && m.lastLogIndex >= lastIndex);
    // Figure 2, RequestVote RPC receiver: "If votedFor is null or candidateId,
    // and candidate's log is at least as up-to-date as receiver's log, grant."
    const grant = (s.votedFor === null || s.votedFor === m.candidateId) && candidateUpToDate;
    if (grant) {
      s.votedFor = m.candidateId; // persisted before responding
      // §5.2 — a server that grants a vote resets its election timer
      // (RAFT.md #5); declining does not.
      this.resetElectionTimer(ctx);
    }
    ctx.send(from, { type: 'RequestVoteResponse', term: s.currentTerm, voteGranted: grant });
  }

  private onRequestVoteResponse(ctx: Ctx<RaftState>, from: NodeId, m: RequestVoteResponse): void {
    const s = ctx.state;
    // §5.2 / RAFT.md #6 — a vote counts only for the election it answers:
    // we must still be a candidate, and the response's term must be our
    // current term (a higher term was handled by the term rule; a lower one
    // was discarded). A late vote after we won, lost, or stepped down changes
    // nothing. Each server's vote counts once, however often it arrives.
    if (s.role !== 'candidate' || m.term !== s.currentTerm) return;
    if (m.voteGranted && !s.votesGranted.includes(from)) {
      s.votesGranted.push(from);
      if (this.hasMajority(ctx)) this.becomeLeader(ctx);
    }
  }

  private onAppendEntries(ctx: Ctx<RaftState>, from: NodeId, m: AppendEntries): void {
    const s = ctx.state;
    // §5.2 — "If the leader's term (included in its RPC) is at least as large
    // as the candidate's current term, then the candidate recognizes the
    // leader as legitimate and returns to follower state." (Equal here; a
    // greater term was handled by the term rule.)
    if (s.role === 'candidate') this.becomeFollower(ctx);
    // Election Safety (§5.2): there cannot be another leader in our term. An
    // AppendEntries claiming otherwise is not processed — a leader never
    // touches its own log on anyone's say-so (RAFT.md #8).
    if (s.role === 'leader') return;
    s.leaderId = m.leaderId;
    // §5.2 / RAFT.md #5 — contact from the current term's leader resets the
    // election timer. This happens before the consistency check, as in the
    // authors' LogCabin: a lagging follower must not start elections while a
    // live leader is walking its nextIndex back.
    this.resetElectionTimer(ctx);
    // Figure 2, AppendEntries receiver step 2 — "Reply false if log doesn't
    // contain an entry at prevLogIndex whose term matches prevLogTerm."
    if (m.prevLogIndex > 0) {
      const prev = s.log[m.prevLogIndex - 1];
      if (prev === undefined || prev.term !== m.prevLogTerm) {
        ctx.send(from, {
          type: 'AppendEntriesResponse',
          term: s.currentTerm,
          success: false,
          matchIndex: 0,
        });
        return;
      }
    }
    // Figure 2, receiver steps 3–4 (§5.3, RAFT.md #3) — "If an existing entry
    // conflicts with a new one (same index but different terms), delete the
    // existing entry and all that follow it. Append any new entries not
    // already in the log." An entry already present with the same term is
    // identical by the Log Matching property and is left alone, so a delayed
    // or duplicated AppendEntries never truncates.
    let index = m.prevLogIndex;
    for (const entry of m.entries) {
      index += 1;
      const existing = s.log[index - 1];
      if (existing === undefined) {
        s.log.push({ term: entry.term, command: entry.command });
      } else if (existing.term !== entry.term) {
        s.log.length = index - 1;
        s.log.push({ term: entry.term, command: entry.command });
      }
    }
    const lastNewIndex = m.prevLogIndex + m.entries.length;
    // Figure 2, receiver step 5 — "If leaderCommit > commitIndex, set
    // commitIndex = min(leaderCommit, index of last new entry)." The commit
    // index is monotonic (RAFT.md #10): a duplicated older request covering
    // fewer entries must not pull it back.
    if (m.leaderCommit > s.commitIndex) {
      s.commitIndex = Math.max(s.commitIndex, Math.min(m.leaderCommit, lastNewIndex));
    }
    this.applyCommitted(ctx);
    ctx.send(from, {
      type: 'AppendEntriesResponse',
      term: s.currentTerm,
      success: true,
      matchIndex: lastNewIndex, // D1: what this request covered
    });
  }

  // Figure 2, "All Servers" — "If commitIndex > lastApplied: increment
  // lastApplied, apply log[lastApplied] to state machine." In index order,
  // exactly once (RAFT.md #10). The state machine here is the applied
  // command sequence, which is what State Machine Safety is checked against.
  private applyCommitted(ctx: Ctx<RaftState>): void {
    const s = ctx.state;
    while (s.lastApplied < s.commitIndex) {
      s.lastApplied += 1;
      s.applied.push((s.log[s.lastApplied - 1] as { command: string }).command);
    }
  }

  // §5.2 — "To begin an election, a follower increments its current term and
  // transitions to candidate state. It then votes for itself and issues
  // RequestVote RPCs in parallel to each of the other servers." A candidate
  // whose timer fires again (split vote) starts a new election the same way.
  private startElection(ctx: Ctx<RaftState>): void {
    const s = ctx.state;
    if (s.role === 'leader') return; // a leader runs no election timer
    s.currentTerm += 1; // persisted before sending
    s.votedFor = ctx.me;
    s.role = 'candidate';
    s.leaderId = null;
    s.votesGranted = [ctx.me];
    // §5.2 / RAFT.md #5 — starting an election resets the election timer,
    // with a fresh random timeout for this election (RAFT.md #9).
    this.resetElectionTimer(ctx);
    if (this.hasMajority(ctx)) {
      this.becomeLeader(ctx); // a single-server cluster elects itself
      return;
    }
    const lastLogIndex = s.log.length;
    const lastLogTerm = lastLogIndex > 0 ? (s.log[lastLogIndex - 1] as { term: number }).term : 0;
    for (const peer of ctx.peers) {
      ctx.send(peer, {
        type: 'RequestVote',
        term: s.currentTerm,
        candidateId: ctx.me,
        lastLogIndex,
        lastLogTerm,
      });
    }
  }

  // §5.2 — "A candidate wins an election if it receives votes from a majority
  // of the servers in the full cluster for the same term."
  private hasMajority(ctx: Ctx<RaftState>): boolean {
    const cluster = ctx.peers.length + 1;
    return ctx.state.votesGranted.length * 2 > cluster;
  }

  // §5.2 — "Once a candidate wins an election, it becomes leader. It then
  // sends heartbeat messages to all of the other servers to establish its
  // authority and prevent new elections."
  private becomeLeader(ctx: Ctx<RaftState>): void {
    const s = ctx.state;
    s.role = 'leader';
    s.leaderId = ctx.me;
    s.votesGranted = [];
    // Figure 2, "Volatile state on leaders (reinitialized after election)":
    // nextIndex = leader's last log index + 1, matchIndex = 0.
    s.nextIndex = {};
    s.matchIndex = {};
    for (const peer of ctx.peers) {
      s.nextIndex[String(peer)] = s.log.length + 1;
      s.matchIndex[String(peer)] = 0;
    }
    ctx.cancelTimer(ELECTION_TIMER);
    this.sendHeartbeats(ctx);
  }

  private sendHeartbeats(ctx: Ctx<RaftState>): void {
    for (const peer of ctx.peers) this.sendAppendEntries(ctx, peer);
    ctx.setTimer(HEARTBEAT_TIMER, HEARTBEAT_INTERVAL);
  }

  // Figure 2, AppendEntries arguments; §5.3 — the leader sends the entries
  // from nextIndex onward, preceded by the index and term of the entry just
  // before them for the consistency check. Empty entries are a heartbeat.
  private sendAppendEntries(ctx: Ctx<RaftState>, peer: NodeId): void {
    const s = ctx.state;
    const nextIndex = s.nextIndex[String(peer)] ?? s.log.length + 1;
    const prevLogIndex = nextIndex - 1;
    const prevLogTerm = prevLogIndex > 0 ? (s.log[prevLogIndex - 1] as { term: number }).term : 0;
    ctx.send(peer, {
      type: 'AppendEntries',
      term: s.currentTerm,
      leaderId: ctx.me,
      prevLogIndex,
      prevLogTerm,
      entries: s.log.slice(prevLogIndex),
      leaderCommit: s.commitIndex,
    });
  }

  // §5.1 / Figure 2 "Rules for Servers": on discovering a higher term a server
  // reverts to follower. A leader had no election timer running (it sends
  // heartbeats instead), so it must arm one now (§5.2); a candidate or
  // follower keeps the timer it already has — stepping down is not one of the
  // timer-reset events (RAFT.md #5).
  private becomeFollower(ctx: Ctx<RaftState>): void {
    const s = ctx.state;
    const wasLeader = s.role === 'leader';
    s.role = 'follower';
    s.leaderId = null;
    s.votesGranted = [];
    s.nextIndex = {};
    s.matchIndex = {};
    if (wasLeader) {
      ctx.cancelTimer(HEARTBEAT_TIMER);
      this.resetElectionTimer(ctx);
    }
  }

  // §5.2 — election timeouts are chosen randomly from a fixed interval, per
  // server and per election, so that split votes are rare and resolve quickly.
  // Replacing the timer of the same name is the engine's setTimer contract.
  private resetElectionTimer(ctx: Ctx<RaftState>): void {
    const range = ELECTION_TIMEOUT_MAX - ELECTION_TIMEOUT_MIN + 1;
    ctx.setTimer(ELECTION_TIMER, ELECTION_TIMEOUT_MIN + Math.floor(ctx.random() * range));
  }
}
