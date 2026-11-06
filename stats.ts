export const TURN_TYPE = 'session-tokens.turn.v1';
export const START_TYPE = 'session-tokens.start.v1';
/** Pi session entries are loosely typed here on purpose; only shape matters. */
export type Entry = any;
export type Usage = {
  input: number; output: number; cacheRead: number; cacheWrite: number;
  totalTokens?: number; cacheWrite1h?: number; reasoning?: number;
};
export type Totals = {
  total: number; input: number; output: number; cacheRead: number; cacheWrite: number;
  unknown: number; calls: number;
};
export type Rgb = [number, number, number];

export const unique = (entries: Entry[]) => [...new Map(entries.map(e => [e.id, e])).values()];
const valid = (n: unknown): n is number => typeof n === 'number' && Number.isFinite(n) && n >= 0;

// Pi's normalized input/output/cache fields are disjoint. Reasoning is a subset
// of output; cacheWrite1h is a subset of cacheWrite. Never add those twice.
export function entryUsage(e: Entry): Usage | null | undefined {
  if (e.type === 'message' && e.message?.role === 'assistant') return e.message.usage ?? null;
  if (e.type === 'message' && e.message?.role === 'toolResult') return e.message.usage;
  if (['usage', 'compaction', 'branch_summary'].includes(e.type)) return e.usage;
}
export function sum(entries: Entry[]): Totals {
  const result = { total: 0, input: 0, output: 0, cacheRead: 0, cacheWrite: 0, unknown: 0, calls: 0 };
  for (const e of unique(entries)) {
    const u = entryUsage(e);
    if (u === undefined) continue;
    result.calls++;
    if (!u) { result.unknown++; continue; }
    const keys = ['input', 'output', 'cacheRead', 'cacheWrite'];
    const complete = keys.every(k => valid(u[k]));
    const subtotal = keys.reduce((n, k) => n + (valid(u[k]) ? u[k] : 0), 0);
    for (const k of keys) result[k] += valid(u[k]) ? u[k] : 0;
    result.total += complete ? subtotal : valid(u.totalTokens) ? u.totalTokens : subtotal;
    if (!complete) result.unknown++;
    // Failed requests often contain a zero-initialized usage, not a measured zero.
    else if (subtotal === 0 && ['error', 'aborted'].includes(e.message?.stopReason)) result.unknown++;
  }
  return result;
}
export function pathTo(entries: Entry[], leaf: string | null): Entry[] {
  const map = new Map(entries.map(e => [e.id, e]));
  const path: Entry[] = [], seen = new Set<string>();
  while (leaf && map.has(leaf) && !seen.has(leaf)) {
    seen.add(leaf);
    const e = map.get(leaf);
    path.push(e); leaf = e.parentId ?? null;
  }
  return path.reverse();
}
export function turns(entries: Entry[]) {
  const records = unique(entries).filter(e => e.type === 'custom' && e.customType === TURN_TYPE && e.data?.version === 1);
  const covered = new Set(records.flatMap(e => e.data.entryIds ?? []));
  const incomplete = entries.some(e => e.type === 'message' && e.message?.role === 'assistant' && !covered.has(e.id));
  return { count: records.length, incomplete };
}
export function turnLabel(entries: Entry[]) {
  const t = turns(entries);
  return `T${t.count}${t.incomplete ? '+' : ''}`;
}
export function branches(entries: Entry[], currentLeaf: string | null) {
  entries = unique(entries);
  // Metadata appended without advancing the leaf must not create phantom branches.
  const structural = entries.filter(e => !['label', 'session_info'].includes(e.type));
  const children = new Map<string | null, number>();
  for (const e of structural) children.set(e.parentId, (children.get(e.parentId) ?? 0) + 1);
  const leaves = structural.filter(e => !children.has(e.id)).map(e => e.id);
  if (currentLeaf && !leaves.includes(currentLeaf)) leaves.unshift(currentLeaf);
  const labels = new Map();
  for (const e of entries) if (e.type === 'label') labels.set(e.targetId, e.label);
  return leaves.map(leaf => {
    const path = pathTo(entries, leaf);
    let forkIndex = -1;
    for (let i = 0; i < path.length - 1; i++) if ((children.get(path[i].id) ?? 0) > 1) forkIndex = i;
    const own = path.slice(forkIndex + 1);
    const label = [...path].reverse().map(e => labels.get(e.id)).find(Boolean);
    // First entry after the fork remains stable while this branch grows.
    const id = own[0]?.id ?? leaf;
    return { id, leaf, fork: path[forkIndex]?.id ?? null, label, current: leaf === currentLeaf,
      total: sum(path), added: sum(own), turns: turnLabel(path) };
  }).sort((a, b) => Number(b.current) - Number(a.current));
}
export function formatTokens(n: number): string {
  if (n < 1000) return String(n);
  // Floor instead of rounding into the next tier/unit prematurely.
  const unit = n < 1e6 ? 1e3 : 1e6;
  return `${(Math.floor(n / unit * 10) / 10).toFixed(1)}${unit === 1e3 ? 'k' : 'M'}`;
}
export function amount(s: Totals, exact = false): string {
  if (s.calls && s.unknown === s.calls && !s.total) return '—';
  return `${exact ? s.total.toLocaleString('en-US') : formatTokens(s.total)}${s.unknown ? '*' : ''}`;
}
export function duration(ms: number | null | undefined): string {
  if (ms == null) return '—';
  const seconds = Math.floor(ms / 1000);
  if (seconds < 60) return `${seconds}s`;
  return `${Math.floor(seconds / 60)}m ${String(seconds % 60).padStart(2, '0')}s`;
}
export function tier(n: number): number {
  return n < 100000 ? 0 : n < 500000 ? 1 : n < 2000000 ? 2
    : n < 10000000 ? 3 : n < 30000000 ? 4 : n < 100000000 ? 5 : 6;
}
// Safe zone is green: a common 500k-2M turn must read as "not much", not as gold.
// Tiers 1-2 are a light/deep green pair, then orange -> purple -> rose -> gold.
// No blue hues, no red (reads as error); only 10M+ is bold.
export const palettes: { dark: (Rgb | null)[]; light: (Rgb | null)[] } = {
  dark: [null, [140, 200, 96], [98, 168, 86], [235, 124, 58], [201, 118, 188], [235, 112, 152], [245, 208, 88]],
  light: [null, [58, 116, 28], [42, 100, 56], [168, 66, 10], [146, 54, 132], [172, 42, 96], [128, 92, 0]],
};
