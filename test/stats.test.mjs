import test from 'node:test';
import assert from 'node:assert/strict';
import { sum, branches, pathTo, turns, TURN_TYPE, tier, amount, duration, palettes } from '../stats.ts';
const message = (id, parentId, input) => ({ id, parentId, type: 'message', message: { role: 'assistant', usage: { input, output: 0, cacheRead: 0, cacheWrite: 0 } } });
test('all branches count shared ancestors once', () => {
  const entries = [message('root', null, 20000), message('a', 'root', 10000), message('b', 'root', 5000)];
  assert.equal(sum([...entries, entries[0]]).total, 35000);
  const rows = branches(entries, 'a');
  assert.deepEqual(rows.map(r => [r.total.total, r.added.total]), [[30000, 10000], [25000, 5000]]);
  assert.equal(rows[0].current, true);
  entries.push(message('c', 'b', 1000), message('d', 'b', 2000));
  assert.equal(branches(entries, 'c').find(r => r.leaf === 'c').fork, 'b');
  assert.equal(sum(entries).total, 38000);
});
test('normalized caches and reasoning are not double counted', () => {
  const e = message('a', null, 100);
  Object.assign(e.message.usage, { output: 40, cacheRead: 200, cacheWrite: 60, reasoning: 30, cacheWrite1h: 40, totalTokens: 400 });
  assert.equal(sum([e]).total, 400);
});
test('summary, tool, warming usage included, custom and context edits ignored', () => {
  const u = message('a', null, 100).message.usage;
  const entries = ['compaction', 'branch_summary', 'usage'].map((type, i) => ({ id: String(i), type, usage: u }));
  entries.push({ id: 't', type: 'message', message: { role: 'toolResult', usage: u } }, { id: 'x', type: 'context_edit', usage: u });
  assert.equal(sum(entries).total, 400);
});
test('missing usage, failed zero, malformed values and exact display', () => {
  const missing = { id: 'm', type: 'message', message: { role: 'assistant' } };
  assert.equal(amount(sum([missing])), '—');
  assert.equal(amount(sum([missing, message('a', null, 1000)])), '1.0k*');
  assert.equal(amount(sum([message('a', null, 12345)]), true), '12,345');
  const e = message('a', null, NaN);
  assert.equal(sum([e]).unknown, 1);
  const failed = message('z', null, 0); failed.message.stopReason = 'error';
  assert.equal(amount(sum([failed])), '—');
});
test('turn coverage survives reload and metadata never inflates counts', () => {
  const e = message('a', null, 20);
  const r = { id: 't', parentId: 'a', type: 'custom', customType: TURN_TYPE, data: { version: 1, entryIds: ['a'] } };
  assert.deepEqual(turns([e, r, r]), { count: 1, incomplete: false });
  assert.equal(turns([e]).incomplete, true);
  const label = { id: 'l', parentId: 't', type: 'label', targetId: 'a', label: 'demo' };
  assert.equal(branches([e, r, label], 't').length, 1);
  assert.equal(branches([e, r, label], 't')[0].label, 'demo');
  assert.equal(pathTo([e, r], 't').length, 2);
});
test('multiple roots and intermediate current positions are represented', () => {
  const entries = [message('a', null, 10), message('b', 'a', 20), message('c', null, 30)];
  assert.equal(branches(entries, 'a').length, 3);
  assert.equal(sum(entries).total, 60);
});
test('color thresholds are exact and palettes have dark/light variants', () => {
  assert.deepEqual([0, 99999, 100000, 499999, 500000, 1999999, 2000000,
    9999999, 10000000, 29999999, 30000000, 99999999, 100000000].map(tier),
    [0, 0, 1, 1, 2, 2, 3, 3, 4, 4, 5, 5, 6]);
  assert.equal(palettes.dark.length, 7);
  assert.equal(palettes.light.length, 7);
});
test('the common 500k-2M turn stays in a safe green band, distinct from gold', () => {
  for (const name of ['dark', 'light']) {
    const safe = palettes[name][2];
    assert.ok(safe[1] > safe[0] && safe[1] > safe[2], `${name} tier 2 must be green-dominant`);
    const gold = palettes[name][6];
    assert.ok(gold[0] > safe[0] + 80, `${name} gold must not be mistaken for the safe tier`);
    assert.ok(palettes[name][1][1] > palettes[name][2][1] - 40, `${name} green pair stays related`);
  }
  assert.equal(new Set(palettes.dark.map(c => c?.join(','))).size, palettes.dark.length);
  assert.notDeepEqual(palettes.dark, palettes.light);
  assert.equal(duration(128000), '2m 08s');
  assert.equal(duration(42900), '42s');
  assert.equal(duration(59999), '59s');
  assert.equal(duration(999), '0s');
  assert.equal(duration(null), '—');
});
