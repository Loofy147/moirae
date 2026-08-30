// The studio is a pure function of a trace file (ADR-003): it reads JSONL,
// derives, renders. It never runs a simulation and imports nothing from the
// engine but the trace schema type — enforced by lint.

export function App() {
  return (
    <main className="studio">
      <header className="studio-header">
        <h1>moira studio</h1>
        <p className="muted">Load a trace to replay it.</p>
      </header>
    </main>
  );
}
