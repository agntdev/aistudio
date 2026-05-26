/**
 * Lightweight in-process metrics (T08).
 *
 * Stores counters and histograms in module-local maps and exposes them
 * in Prometheus exposition format via /api/metrics. This is enough for
 * single-instance MVP deployments; a real prod cluster would replace
 * the in-memory store with a push to a stats backend (StatsD, OTLP).
 *
 * Usage:
 *   counters.inc('generations.started', { status: 'queued' });
 *   const stop = timers.start('replicate.request');
 *   try { ... } finally { stop({ outcome: 'ok' }); }
 */

type Labels = Record<string, string>;

function labelsKey(labels?: Labels): string {
  if (!labels) return '';
  const keys = Object.keys(labels).sort();
  return keys.map((k) => `${k}="${escapeLabel(labels[k])}"`).join(',');
}

function escapeLabel(v: string): string {
  return v.replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/\n/g, '\\n');
}

const counterStore = new Map<string, Map<string, number>>();
const histogramStore = new Map<string, Map<string, number[]>>();

export const counters = {
  inc(name: string, labels?: Labels, by = 1) {
    let metric = counterStore.get(name);
    if (!metric) {
      metric = new Map();
      counterStore.set(name, metric);
    }
    const key = labelsKey(labels);
    metric.set(key, (metric.get(key) || 0) + by);
  },
  get(name: string, labels?: Labels): number {
    return counterStore.get(name)?.get(labelsKey(labels)) ?? 0;
  },
};

export const histograms = {
  observe(name: string, value: number, labels?: Labels) {
    let metric = histogramStore.get(name);
    if (!metric) {
      metric = new Map();
      histogramStore.set(name, metric);
    }
    const key = labelsKey(labels);
    const arr = metric.get(key);
    if (arr) arr.push(value);
    else metric.set(key, [value]);
  },
  snapshot(name: string, labels?: Labels) {
    const arr = histogramStore.get(name)?.get(labelsKey(labels));
    if (!arr || arr.length === 0) return null;
    const sorted = [...arr].sort((a, b) => a - b);
    const pct = (p: number) => sorted[Math.min(sorted.length - 1, Math.floor(p * sorted.length))];
    return {
      count: sorted.length,
      sum: arr.reduce((s, x) => s + x, 0),
      p50: pct(0.5),
      p95: pct(0.95),
      p99: pct(0.99),
    };
  },
};

export const timers = {
  start(name: string) {
    const startedAt = Date.now();
    return (labels?: Labels) => {
      const elapsed = Date.now() - startedAt;
      histograms.observe(name, elapsed, labels);
      return elapsed;
    };
  },
};

/** Prometheus exposition format renderer. */
export function renderPrometheus(): string {
  const lines: string[] = [];

  for (const [name, perLabel] of counterStore) {
    lines.push(`# TYPE ${name} counter`);
    for (const [labelKey, value] of perLabel) {
      lines.push(labelKey ? `${name}{${labelKey}} ${value}` : `${name} ${value}`);
    }
  }

  for (const [name, perLabel] of histogramStore) {
    lines.push(`# TYPE ${name} summary`);
    for (const labelKey of perLabel.keys()) {
      const snap = histograms.snapshot(name, parseLabelKey(labelKey));
      if (!snap) continue;
      const labelPart = labelKey ? `,${labelKey}` : '';
      lines.push(`${name}{quantile="0.5"${labelPart}} ${snap.p50}`);
      lines.push(`${name}{quantile="0.95"${labelPart}} ${snap.p95}`);
      lines.push(`${name}{quantile="0.99"${labelPart}} ${snap.p99}`);
      lines.push(`${name}_count${labelKey ? `{${labelKey}}` : ''} ${snap.count}`);
      lines.push(`${name}_sum${labelKey ? `{${labelKey}}` : ''} ${snap.sum}`);
    }
  }

  return lines.join('\n') + '\n';
}

// Parses `foo="bar",baz="qux"` back into an object — needed when the
// snapshot helper is called with a pre-serialised key.
function parseLabelKey(key: string): Labels | undefined {
  if (!key) return undefined;
  const out: Labels = {};
  // Simple split; values cannot contain unescaped commas because we
  // escaped them in labelsKey.
  for (const part of key.split(',')) {
    const eq = part.indexOf('=');
    if (eq < 0) continue;
    const k = part.slice(0, eq);
    const v = part.slice(eq + 1).replace(/^"|"$/g, '');
    out[k] = v;
  }
  return out;
}
