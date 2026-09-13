export function createTransitionMetrics({ now = () => performance.now(), emit, id }) {
  const started = now();
  const stages = {};
  const marks = {};
  const pending = new Map();
  let finished = false;
  return {
    async measure(name, operation) {
      const start = now();
      try { return await operation(); }
      finally { stages[name] = (stages[name] || 0) + now() - start; }
    },
    mark(name) {
      const time = now();
      marks[name] = time - started;
      if (name.endsWith(':start')) pending.set(name.slice(0, -6), time);
      if (name.endsWith(':end')) {
        const stage = name.slice(0, -4);
        if (pending.has(stage)) {
          stages[stage] = (stages[stage] || 0) + time - pending.get(stage);
          pending.delete(stage);
        }
      }
    },
    finish() {
      if (finished) return;
      finished = true;
      stages.total = now() - started;
      // Telemetry must not turn a successful load into a failed load.
      try { emit({ id, stages: { ...stages }, marks: { ...marks } }); } catch { /* logging only */ }
    }
  };
}
