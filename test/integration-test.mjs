import assert from 'node:assert/strict';
import { pathToFileURL, fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
import { pathTo, TURN_TYPE, amount, tier, palettes } from '../stats.ts';
const root = process.env.PI_TEST_ROOT ?? 'C:/Users/Pondsi/.pi/agent/install/releases/1.5.0/node_modules/@earendil-works/pi-coding-agent';
const host = rel => import(pathToFileURL(resolve(root, rel)).href);
const { loadExtensions, createExtensionRuntime } = await host('dist/core/extensions/loader.js');
const { getThemeByName } = await host('dist/modes/interactive/theme/theme.js');
const { visibleWidth } = await import(pathToFileURL(resolve(root, '../pi-tui/dist/index.js')).href);
let entries = [], leaf = null, serial = 0, status;
const append = entry => { const e = { id: `test${++serial}`, parentId: leaf, timestamp: new Date().toISOString(), ...entry }; entries.push(e); leaf = e.id; return e; };
const runtime = createExtensionRuntime();
runtime.appendEntry = (customType, data) => append({ type: 'custom', customType, data });
const source = fileURLToPath(new URL('../index.ts', import.meta.url));
const loaded = await loadExtensions([source], process.cwd(), undefined, runtime);
assert.deepEqual(loaded.errors, [], 'Pi real extension loader must accept source');
const ext = loaded.extensions[0];
const liveTimers = new Set();
const originalSetInterval = globalThis.setInterval;
const originalClearInterval = globalThis.clearInterval;
globalThis.setInterval = (...args) => { const timer = originalSetInterval(...args); liveTimers.add(timer); return timer; };
globalThis.clearInterval = timer => { liveTimers.delete(timer); return originalClearInterval(timer); };
const ctx = { hasUI: true, mode: 'tui', sessionManager: {
  getEntries: () => entries, getBranch: () => pathTo(entries, leaf), getLeafId: () => leaf,
}, ui: { setStatus: (_key, s) => status = s } };
const emit = async (name, event = {}) => { for (const h of ext.handlers.get(name) ?? []) await h({ type: name, ...event }, ctx); };
const assistant = (n, stopReason = 'stop') => append({ type: 'message', message: { role: 'assistant', stopReason,
  usage: { input: n, output: 0, cacheRead: 0, cacheWrite: 0 } } });
await emit('session_start');
await emit('before_agent_start');
assert.equal(liveTimers.size, 1);
assert.match(status, /◷ 0s$/);
await new Promise(resolve => setTimeout(resolve, 1150));
assert.match(status, /◷ [1-9]\d*s$/, 'clock must advance without model events');
assistant(20000);
await emit('turn_end');
await emit('agent_end');
await emit('agent_start'); // auto continuation must not start a second user turn
assert.equal(liveTimers.size, 1);
assert.match(status, /◷ [1-9]\d*s$/, 'retry must not reset clock');
assistant(10000);
await emit('agent_settled', { aborted: false });
await emit('agent_settled', { aborted: false });
let records = entries.filter(e => e.customType === TURN_TYPE);
assert.equal(records.length, 1);
assert.equal(records[0].data.usage.total, 30000);
assert.equal(status, 'Σ 30.0k · ⎇ 30.0k');
assert.equal(liveTimers.size, 0);
const settledStatus = status;
await new Promise(resolve => setTimeout(resolve, 1100));
assert.equal(status, settledStatus, 'no timer repaint after settlement');
await emit('session_start', { reason: 'reload' });
assert.equal(entries.filter(e => e.customType === TURN_TYPE).length, 1);
const firstLeaf = leaf;
await emit('before_agent_start'); assistant(5000);
await emit('agent_settled', { aborted: true });
assert.equal(status, 'Σ 35.0k · ⎇ 35.0k');
assert.equal(liveTimers.size, 0, 'abort clears clock');
leaf = firstLeaf;
await emit('session_tree');
assert.equal(status, 'Σ 35.0k · ⎇ 30.0k');
await emit('before_agent_start'); assistant(2000);
await emit('session_start'); // simulate process interruption/restart
records = entries.filter(e => e.customType === TURN_TYPE);
assert.equal(liveTimers.size, 0, 'session replacement clears old clock');
assert.equal(records.at(-1).data.recovered, true);
assert.equal(records.at(-1).data.elapsedMs, null);
assert.equal(records.at(-1).data.usage.total, 2000);
const renderer = ext.entryRenderers.get(TURN_TYPE);
const TIER_SAMPLES = [0, 99999, 100000, 500000, 2000000, 9999999, 10000000, 30000000, 100000000];
const colorOf = (line, tokenText) => {
  const index = line.indexOf(tokenText);
  if (index < 0) return undefined;
  const escapes = [...line.slice(0, index).matchAll(/\x1b\[38;2;\d+;\d+;\d+m/g)];
  return escapes.at(-1)?.[0];
};
for (const name of ['dark', 'light']) {
  const theme = getThemeByName(name);
  assert.ok(theme);
  const seen = new Map();
  for (const n of TIER_SAMPLES) {
    const record = { ...records[0], data: { ...records[0].data, usage: { ...records[0].data.usage, total: n } } };
    const component = renderer(record, { expanded: true }, theme);
    for (const width of [20, 40, 100]) assert.ok(component.render(width).every(s => visibleWidth(s) <= width));
    const line = component.render(100)[0];
    assert.doesNotMatch(line, /T\d/, 'inline summary should not show turn numbers');
    assert.doesNotMatch(line, /\d\.\ds|\d\.\d /, 'durations must not show decimals');
    const level = tier(n);
    const tokenText = `${amount({ total: n, calls: 1, unknown: 0 })} tok`;
    const expected = palettes[name === 'light' ? 'light' : 'dark'][level];
    const actual = colorOf(line, tokenText);
    if (level === 0) {
      // Regression: the neutral tier used to emit raw text, which renders in the
      // terminal's own (often warm/gold) foreground instead of the theme text color.
      assert.ok(line.includes(theme.fg('text', tokenText)), 'neutral tier uses theme text color');
    } else {
      // Exact palette color per tier: catches off-by-one indexes and stale palettes.
      assert.equal(actual, `\x1b[38;2;${expected.join(';')}m`, `${name} tier ${level} (${n}) color`);
    }
    assert.equal(seen.has(level) ? seen.get(level) : actual, actual, 'one color per tier');
    seen.set(level, actual);
    if (process.env.NO_COLOR === undefined && process.env.TERM !== 'dumb') {
      if (n >= 10000000) assert.match(line, /\x1b\[1m/, '10M+ gets bold');
      else assert.doesNotMatch(line, /\x1b\[1m/, 'ordinary million-token turns are not bold');
    }
    component.invalidate();
  }
  assert.equal(new Set(seen.values()).size, 7, 'every tier renders a distinct color');
}
process.env.NO_COLOR = '1';
assert.ok(renderer(records[0], { expanded: true }, getThemeByName('dark')).render(100).every(s => !s.includes('\x1b')));
delete process.env.NO_COLOR;
let panelChecked = false;
ctx.ui.custom = async factory => {
  const component = factory({ terminal: { rows: 24 }, requestRender() {} }, getThemeByName('dark'), { matches: (data, key) => data === key }, () => {});
  const lines = component.render(80);
  assert.ok(lines.some(s => s.includes('SESSION')));
  assert.ok(component.render(24).every(s => visibleWidth(s) <= 24));
  component.handleInput('tui.select.down'); component.handleInput('tui.select.cancel');
  panelChecked = true;
};
await ext.commands.get('tokens').handler('', ctx);
assert.equal(panelChecked, true);
ctx.hasUI = false; ctx.mode = 'print';
await emit('before_agent_start');
assert.equal(liveTimers.size, 0, 'non-UI mode needs no timer');
assistant(1000); await emit('agent_settled', { aborted: false });
await emit('session_shutdown');
entries = []; leaf = null; ctx.hasUI = true;
await emit('session_start', { reason: 'new' });
assert.equal(status, 'Σ 0 · ⎇ 0');
for (const name of ['dark', 'light']) {
  ctx.ui.theme = getThemeByName(name);
  await emit('session_tree');
  const theme = ctx.ui.theme;
  const expected = process.env.NO_COLOR !== undefined || process.env.TERM === 'dumb'
    ? 'Σ 0 · ⎇ 0'
    : theme.fg('dim', 'Σ ') + theme.fg('text', '0') + theme.fg('dim', ' · ⎇ 0');
  assert.equal(status, expected, 'only total uses normal foreground; surrounding status is dim');
}
await emit('before_agent_start');
assert.equal(liveTimers.size, 1);
await emit('session_shutdown');
assert.equal(liveTimers.size, 0, 'shutdown clears active timer');
assert.equal(status, undefined);
globalThis.setInterval = originalSetInterval;
globalThis.clearInterval = originalClearInterval;
console.log('PASS: real Pi loader, live clock, timer cleanup, multi-call turns, retry, abort, reload, recovery, tree, themes, widths, panel, non-UI, new session');
