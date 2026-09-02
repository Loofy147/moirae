import type { NodeId } from 'moirae-core';
import { compareTags } from './abd';
import type { Tag } from './state';

export type ABDHistoryOperation =
  | {
      readonly id: string;
      readonly kind: 'write';
      readonly invokeSeq: number;
      readonly completeSeq: number;
      readonly tag: Tag;
      readonly writerId: NodeId;
    }
  | {
      readonly id: string;
      readonly kind: 'read';
      readonly invokeSeq: number;
      readonly completeSeq: number;
      readonly tag: Tag;
    };

export type ABDRegisterHistory = readonly ABDHistoryOperation[];

function overlaps(a: ABDHistoryOperation, b: ABDHistoryOperation): boolean {
  return !(a.completeSeq < b.invokeSeq || b.completeSeq < a.invokeSeq);
}

function precedes(a: ABDHistoryOperation, b: ABDHistoryOperation): boolean {
  return a.completeSeq < b.invokeSeq;
}

/**
 * Bounded linearizability checker for completed ABD register histories.
 *
 * The checker searches legal sequentializations of the completed operations.
 * It intentionally ignores incomplete operations; a bounded safety checker
 * must never reject a history merely because a live operation has not yet
 * returned. For a single-writer register, a sequential write installs its
 * tag/value and a read must return the tag currently installed at its chosen
 * linearization point.
 */
export function isLinearizable(history: ABDRegisterHistory): boolean {
  const ops = history.filter((op) => op.completeSeq >= op.invokeSeq);
  const remaining = new Set(ops.map((op) => op.id));
  const byId = new Map(ops.map((op) => [op.id, op]));
  const ordered: ABDHistoryOperation[] = [];
  const initialTag: Tag = { counter: 0, writerId: 0 };

  function canAppend(candidate: ABDHistoryOperation): boolean {
    for (const id of remaining) {
      const other = byId.get(id);
      if (other !== undefined && precedes(other, candidate)) return false;
    }
    return true;
  }

  function readIsLegal(candidate: Extract<ABDHistoryOperation, { kind: 'read' }>): boolean {
    let current = initialTag;
    for (const op of ordered) {
      if (op.kind === 'write') current = op.tag;
    }
    return compareTags(candidate.tag, current) === 0;
  }

  function search(): boolean {
    if (remaining.size === 0) return true;

    const candidates = ops.filter((op) => remaining.has(op.id));
    candidates.sort((a, b) => {
      const overlapOrder = Number(overlaps(a, b));
      return overlapOrder || a.invokeSeq - b.invokeSeq || a.completeSeq - b.completeSeq;
    });

    for (const candidate of candidates) {
      if (!canAppend(candidate)) continue;
      if (candidate.kind === 'read' && !readIsLegal(candidate)) continue;

      remaining.delete(candidate.id);
      ordered.push(candidate);
      if (search()) return true;
      ordered.pop();
      remaining.add(candidate.id);
    }
    return false;
  }

  return search();
}

/** Extract the completed ABD operations from Moirae's log events. */
export function historyFromTrace(
  trace: readonly { kind: string; seq: number; event?: string; data?: Record<string, unknown> }[],
): ABDRegisterHistory {
  const starts = new Map<string, { kind: 'write' | 'read'; seq: number }>();
  const result: ABDHistoryOperation[] = [];

  for (const event of trace) {
    if (event.kind !== 'log' || event.event === undefined) continue;
    const operationId = event.data?.['operationId'];
    if (typeof operationId !== 'string') continue;

    if (event.event === 'write-start') {
      starts.set(operationId, { kind: 'write', seq: event.seq });
      continue;
    }
    if (event.event === 'read-start') {
      starts.set(operationId, { kind: 'read', seq: event.seq });
      continue;
    }

    if (event.event === 'write-complete') {
      const start = starts.get(operationId);
      const tag = parseTag(event.data?.['tag']);
      if (start?.kind === 'write' && tag !== null) {
        result.push({ id: operationId, kind: 'write', invokeSeq: start.seq, completeSeq: event.seq, tag, writerId: tag.writerId });
      }
      continue;
    }

    if (event.event === 'read-complete') {
      const start = starts.get(operationId);
      const tag = parseTag(event.data?.['tag']);
      if (start?.kind === 'read' && tag !== null) {
        result.push({ id: operationId, kind: 'read', invokeSeq: start.seq, completeSeq: event.seq, tag });
      }
    }
  }

  return result;
}

function parseTag(value: unknown): Tag | null {
  if (typeof value !== 'object' || value === null) return null;
  const raw = value as { counter?: unknown; writerId?: unknown };
  if (!Number.isInteger(raw.counter) || !Number.isInteger(raw.writerId)) return null;
  return { counter: raw.counter, writerId: raw.writerId };
}
