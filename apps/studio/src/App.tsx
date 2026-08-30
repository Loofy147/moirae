// The studio is a pure function of a trace file (ADR-003): it reads JSONL,
// derives, renders. It never runs a simulation and imports nothing from the
// engine but the trace schema type — enforced by lint.

import { useEffect, useState } from 'react';
import { deriveModel, type TraceModel } from './trace/model';
import { parseJsonl } from './trace/parse';
import { Legend } from './ui/Legend';
import { MessageDetail } from './ui/MessageDetail';
import { Scrubber } from './ui/Scrubber';
import { StatePanel } from './ui/StatePanel';
import { Timeline } from './ui/Timeline';
import { usePlayback } from './ui/usePlayback';

type Status =
  | { kind: 'idle' }
  | { kind: 'loading'; source: string }
  | { kind: 'error'; source: string; message: string }
  | { kind: 'ready'; source: string; model: TraceModel };

export function App() {
  const [status, setStatus] = useState<Status>({ kind: 'idle' });

  useEffect(() => {
    const url = new URLSearchParams(window.location.search).get('trace');
    if (url === null) return;
    setStatus({ kind: 'loading', source: url });
    fetch(url)
      .then(async (res) => {
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        return res.text();
      })
      .then((text) => setStatus({ kind: 'ready', source: url, model: deriveModel(parseJsonl(text)) }))
      .catch((err: unknown) =>
        setStatus({ kind: 'error', source: url, message: err instanceof Error ? err.message : String(err) }),
      );
  }, []);

  return (
    <main className="studio">
      <header className="studio-header">
        <h1>moira studio</h1>
        {status.kind === 'idle' && <p className="muted">Open with ?trace=URL to replay a trace.</p>}
        {status.kind === 'loading' && <p className="muted">Loading {status.source}…</p>}
        {status.kind === 'error' && (
          <p className="error">
            Could not load {status.source}: {status.message}
          </p>
        )}
        {status.kind === 'ready' && (
          <p className="muted">
            {status.source} — seed {status.model.header.seed}, {status.model.nodes.length} nodes,{' '}
            {status.model.messages.length} messages
          </p>
        )}
      </header>
      {status.kind === 'ready' && <Viewer model={status.model} />}
    </main>
  );
}

function initialPlayhead(duration: number): number {
  const raw = new URLSearchParams(window.location.search).get('t');
  const t = raw === null ? Number.NaN : Number(raw);
  return Number.isFinite(t) ? t : duration;
}

function Viewer({ model }: { model: TraceModel }) {
  const playback = usePlayback(model.duration, initialPlayhead(model.duration));
  const [selected, setSelected] = useState<number | null>(null);

  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLSelectElement) return;
      if (e.key === ' ') {
        e.preventDefault();
        playback.toggle();
      } else if (e.key === 'ArrowLeft') playback.seek(playback.t - 50);
      else if (e.key === 'ArrowRight') playback.seek(playback.t + 50);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [playback]);

  return (
    <>
      <Legend model={model} />
      <Scrubber playback={playback} duration={model.duration} />
      <Timeline model={model} playhead={playback.t} selected={selected} onSeek={playback.seek} onSelect={setSelected} />
      {selected !== null && <MessageDetail model={model} msgId={selected} />}
      <StatePanel model={model} t={playback.t} />
    </>
  );
}
