// Each node's state as folded from the trace up to the playhead, in
// everyday words where the role/term convention allows, and as plain fields
// otherwise. Arrays are summarised by length; the raw JSON is one hover away.

import type { TraceModel } from '../trace/model';
import { roleColour } from '../trace/labels';

function headline(state: Readonly<Record<string, unknown>>, conventions: TraceModel['conventions']): string | null {
  if (!conventions.role) return null;
  const role = state['role'];
  if (typeof role !== 'string') return null;
  const term = state['currentTerm'] ?? state['term'];
  const leader = state['leaderId'];
  const parts = [role];
  if (typeof term === 'number') parts.push(`term ${term}`);
  if (role !== 'leader' && typeof leader === 'number') parts.push(`follows node ${leader}`);
  return parts.join(', ');
}

function describe(value: unknown): string {
  if (Array.isArray(value)) return `${value.length} ${value.length === 1 ? 'entry' : 'entries'}`;
  if (value === null) return 'none';
  if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') return String(value);
  const json = JSON.stringify(value) ?? 'undefined';
  return json.length > 40 ? `${json.slice(0, 37)}…` : json;
}

export function StatePanel({ model, t }: { model: TraceModel; t: number }) {
  return (
    <div className="state-panel">
      {model.nodes.map((node) => {
        const state = model.stateAt(node, t);
        if (state === null) {
          return (
            <div key={node} className="node-card node-card-down">
              <div className="node-card-title">node {node}</div>
              <div className="muted">crashed</div>
            </div>
          );
        }
        const line = headline(state, model.conventions);
        const role = typeof state['role'] === 'string' ? state['role'] : null;
        return (
          <div key={node} className="node-card" style={role !== null ? { borderTopColor: roleColour(role) } : undefined}>
            <div className="node-card-title">node {node}</div>
            {line !== null && <div className="node-card-headline">{line}</div>}
            <dl className="node-fields">
              {Object.entries(state)
                .filter(([key]) => !(line !== null && (key === 'role' || key === 'currentTerm' || key === 'term' || key === 'leaderId')))
                .map(([key, value]) => (
                  <div key={key} className="node-field" title={JSON.stringify(value)}>
                    <dt>{key}</dt>
                    <dd>{describe(value)}</dd>
                  </div>
                ))}
            </dl>
          </div>
        );
      })}
    </div>
  );
}
