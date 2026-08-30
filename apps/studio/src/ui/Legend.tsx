// The legend, in everyday words. When the trace has no `role` field the
// lanes cannot be coloured by state, and the legend says so instead of
// leaving grey lanes for the viewer to puzzle over (SPEC §9).

import type { TraceModel } from '../trace/model';
import { ROLE_COLOURS, messageLabel } from '../trace/labels';
import { isElectionTraffic } from './Timeline';

export function Legend({ model }: { model: TraceModel }) {
  return (
    <div className="legend">
      {model.conventions.role ? (
        <div className="legend-row">
          <span className="legend-title">lane colour</span>
          <Chip colour={ROLE_COLOURS['leader'] as string} label="leader" />
          <Chip colour={ROLE_COLOURS['candidate'] as string} label="trying to become leader (an election)" />
          <Chip colour={ROLE_COLOURS['follower'] as string} label="follower" faint />
          {model.conventions.term ? (
            <span className="legend-note">t2, t3… = the term (each election starts a new one)</span>
          ) : (
            <span className="legend-warning">this trace has no term field, so lanes carry no term labels; see SPEC §9</span>
          )}
        </div>
      ) : (
        <div className="legend-row">
          <span className="legend-warning">
            this trace has no top-level <code>role</code> field, so lanes aren&apos;t coloured by state; see SPEC §9
          </span>
        </div>
      )}
      <div className="legend-row">
        <span className="legend-title">arcs</span>
        {model.messageTypes.map((type) => (
          <span key={type} className={isElectionTraffic(type) ? 'legend-item' : 'legend-item legend-item-quiet'}>
            <span className="legend-line" style={{ borderColor: arcColourFor(type) }} /> {messageLabel(type)}
          </span>
        ))}
        <span className="legend-item">
          <span className="legend-x">×</span> message lost (at the wall when a partition stopped it)
        </span>
        <span className="legend-item">
          <span className="legend-hatch" /> crashed
        </span>
      </div>
    </div>
  );
}

function Chip({ colour, label, faint }: { colour: string; label: string; faint?: boolean }) {
  return (
    <span className="legend-item">
      <span className="legend-chip" style={{ background: colour, opacity: faint ? 0.55 : 0.9 }} /> {label}
    </span>
  );
}

const ARC_LEGEND_COLOURS: Readonly<Record<string, string>> = {
  RequestVote: '#e0a100',
  RequestVoteResponse: '#efc65a',
  AppendEntries: '#7a8ba8',
  AppendEntriesResponse: '#b8c2d3',
};

function arcColourFor(type: string): string {
  return ARC_LEGEND_COLOURS[type] ?? '#8c8c86';
}
