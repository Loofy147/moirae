// Recursive Object.freeze, in-repo per ADR-004. Used to hand invariants a
// WorldView they cannot mutate. Already-frozen objects are skipped, which
// makes re-freezing an event history that is frozen at emission O(1).

export function deepFreeze<T>(value: T): T {
  if (typeof value !== 'object' || value === null || Object.isFrozen(value)) return value;
  Object.freeze(value);
  for (const key of Object.keys(value)) {
    deepFreeze((value as Record<string, unknown>)[key]);
  }
  return value;
}
