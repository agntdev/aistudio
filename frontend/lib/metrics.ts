/**
 * In-process performance metrics (T08).
 *
 * Lightweight counter + histogram primitives so route handlers and the
 * worker can emit metrics without pulling in a full Prometheus client.
 * Snapshots are exposed via `/api/metrics` for scraping and consumed by
 * `/api/health` for hot-path SLO summaries.
 *
 * Numbers are kept on `globalThis` so HMR + Next.js bundle splits don't
 * reset them between requests. They are intentionally process-local;
 * production aggregation should happen in Sentry / Prometheus / your
 * APM of choice.
 */

const GLOBAL_KEY = Symbol.for('aistudio.metrics');

interface Snapshot {
  counters: Record<string, number>;
  histograms: Record<string, { count: number; sum: number; min: number; max: number; buckets: Record<string, number> }>;
  startedAt: number;
}

type Store = {
  counters: Map<string, number>;
  histograms: Map<string, { count: number; sum: number; min: number; max: number; buckets: Record<string, number> }>;
  startedAt: number;
};

type MetricsGlobal = typeof globalThis & { [GLOBAL_KEY]?: Store };

const BUCKETS_MS = [5, 10, 25, 50, 100, 250, 500, 1000, 2500, 5000, 10000, Infinity];

function store(): Store {
  const g = globalThis as MetricsGlobal;
  if (!g[GLOBAL_KEY]) {
    g[GLOBAL_KEY] = {
      counters: new Map(),
      histograms: new Map(),
      startedAt: Date.now(),
    };
  }
  return g[GLOBAL_KEY];
}

function keyWithLabels(name: string, labels?: Record<string, string | number>): string {
  if (!labels) return name;
  const parts = Object.entries(labels)
    .map(([k, v]) => `${k}=${String(v)}`)
    .sort();
  return parts.length ? `${name}{${parts.join(',')}}` : name;
}

export function incCounter(name: string, labels?: Record<string, string | number>, by = 1): void {
  const key = keyWithLabels(name, labels);
  const m = store().counters;
  m.set(key, (m.get(key) ?? 0) + by);
}

/**
 * Record a duration (ms) into a fixed-bucket histogram.
 *
 * For the canonical SLO use-case we measure HTTP / queue / DB latencies
 * — anything sub-second matters most, so most buckets sit under 1s.
 */
export function observeMs(name: string, durationMs: number, labels?: Record<string, string | number>): void {
  const key = keyWithLabels(name, labels);
  const m = store().histograms;
  const h = m.get(key) ?? {
    count: 0,
    sum: 0,
    min: Number.POSITIVE_INFINITY,
    max: 0,
    buckets: Object.fromEntries(BUCKETS_MS.map((b) => [`<=${b}`, 0])),
  };
  h.count += 1;
  h.sum += durationMs;
  if (durationMs < h.min) h.min = durationMs;
  if (durationMs > h.max) h.max = durationMs;
  for (const upper of BUCKETS_MS) {
    if (durationMs <= upper) h.buckets[`<=${upper}`] += 1;
  }
  m.set(key, h);
}

/** Convenience: time an async function and record the result + outcome label. */
export async function timed<T>(
  name: string,
  fn: () => Promise<T>,
  labels?: Record<string, string | number>,
): Promise<T> {
  const t0 = performance.now();
  let outcome: 'ok' | 'error' = 'ok';
  try {
    return await fn();
  } catch (err) {
    outcome = 'error';
    incCounter(`${name}.errors_total`, labels);
    throw err;
  } finally {
    observeMs(name, performance.now() - t0, { ...(labels ?? {}), outcome });
  }
}

export function snapshot(): Snapshot {
  const s = store();
  return {
    counters: Object.fromEntries(s.counters),
    histograms: Object.fromEntries(
      Array.from(s.histograms.entries()).map(([k, v]) => [
        k,
        {
          count: v.count,
          sum: v.sum,
          min: v.min === Number.POSITIVE_INFINITY ? 0 : v.min,
          max: v.max,
          buckets: { ...v.buckets },
        },
      ]),
    ),
    startedAt: s.startedAt,
  };
}

/** Best-effort Prometheus text format renderer for /api/metrics. */
export function renderProm(): string {
  const s = snapshot();
  const lines: string[] = [];
  for (const [k, v] of Object.entries(s.counters)) {
    lines.push(`# TYPE ${k.split('{')[0]} counter`);
    lines.push(`${k} ${v}`);
  }
  for (const [k, h] of Object.entries(s.histograms)) {
    const base = k.split('{')[0];
    const labels = k.includes('{') ? k.substring(k.indexOf('{') + 1, k.lastIndexOf('}')) : '';
    const labelPrefix = labels ? labels + ',' : '';
    lines.push(`# TYPE ${base} histogram`);
    for (const [le, count] of Object.entries(h.buckets)) {
      const upper = le.replace('<=', '');
      lines.push(`${base}_bucket{${labelPrefix}le="${upper === 'Infinity' ? '+Inf' : upper}"} ${count}`);
    }
    lines.push(`${base}_count{${labels}} ${h.count}`);
    lines.push(`${base}_sum{${labels}} ${h.sum.toFixed(2)}`);
  }
  return lines.join('\n') + '\n';
}
