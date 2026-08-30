import type { TraceModel } from '../trace/model';
import { messageLabel } from '../trace/labels';
import { formatTime } from './layout';

const DROP_WORDS: Readonly<Record<string, string>> = {
  partition: 'lost at the wall — a partition stopped it',
  loss: 'lost in the network',
  crashed: 'the receiver was down',
};

export function MessageDetail({ model, msgId }: { model: TraceModel; msgId: number }) {
  const m = model.byMsgId.get(msgId);
  if (m === undefined) return null;
  const type = m.send.msg.type;
  const fate =
    m.drop !== null
      ? DROP_WORDS[m.drop.reason] ?? `dropped (${m.drop.reason})`
      : m.delivers.length === 0
        ? 'still in flight when the trace ended'
        : m.delivers.map((d) => `delivered ${formatTime(d.t)}${d.dup ? ' (duplicate)' : ''}`).join(', ');
  return (
    <div className="message-detail">
      <strong>{messageLabel(type)}</strong> <span className="muted">({type})</span> from node {m.send.from} to node{' '}
      {m.send.to}, sent {formatTime(m.send.t)} — {fate}
      <details>
        <summary>payload</summary>
        <code>{JSON.stringify(m.send.msg)}</code>
      </details>
    </div>
  );
}
