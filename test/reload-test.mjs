// Regression for the real bug users hit: /reload re-evaluated index.ts, but a
// runtime `.mjs` dependency stayed cached in the process, so old thresholds and
// colors kept rendering. Every runtime module must now be `.ts`, and edits must
// be visible after a reload.
import assert from 'node:assert/strict';
import { pathToFileURL } from 'node:url';
import { resolve, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { mkdtempSync, copyFileSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';

const root = process.env.PI_TEST_ROOT ?? 'C:/Users/Pondsi/.pi/agent/install/releases/1.5.0/node_modules/@earendil-works/pi-coding-agent';
const host = rel => import(pathToFileURL(resolve(root, rel)).href);
const { loadExtensions, createExtensionRuntime, clearExtensionCache } = await host('dist/core/extensions/loader.js');
const { getThemeByName } = await host('dist/modes/interactive/theme/theme.js');

const source = fileURLToPath(new URL('..', import.meta.url));
const work = mkdtempSync(join(tmpdir(), 'session-tokens-reload-'));
const theme = getThemeByName('dark');
const TURN_TYPE = 'session-tokens.turn.v1';

const load = async dir => {
  const result = await loadExtensions([join(dir, 'index.ts')], dir, undefined, createExtensionRuntime());
  assert.deepEqual(result.errors, [], 'extension must load');
  return result.extensions[0];
};
const colorFor = (ext, total) => {
  const record = { id: 'r', type: 'custom', customType: TURN_TYPE, data: {
    version: 1, number: 1, startId: 'x', entryIds: [], elapsedMs: 1000, aborted: false, recovered: false,
    usage: { total, input: total, output: 0, cacheRead: 0, cacheWrite: 0, unknown: 0, calls: 1 } } };
  const line = ext.entryRenderers.get(TURN_TYPE)(record, { expanded: false }, theme).render(100)[0];
  const index = line.indexOf(' tok');
  const escapes = [...line.slice(0, index).matchAll(/\x1b\[38;2;\d+;\d+;\d+m/g)];
  return escapes.at(-1)?.[0];
};

try {
  // Ship exactly what a published package contains: no `.mjs` runtime modules.
  const files = ['index.ts', 'stats.ts'];
  for (const file of files) copyFileSync(join(source, file), join(work, file));
  const shipped = readFileSync(join(work, 'index.ts'), 'utf8').match(/from '\.\/[^']+'/g) ?? [];
  assert.deepEqual(shipped, ["from './stats.ts'"], 'all runtime imports must be .ts');
  assert.ok(!readFileSync(join(work, 'stats.ts'), 'utf8').includes('.mjs'), 'no .mjs runtime import');

  const first = await load(work);
  const before = colorFor(first, 662100);
  assert.ok(before, 'a 662.1k turn must be colored');

  // Simulate a developer editing the palette, exactly the case that was broken.
  const statsPath = join(work, 'stats.ts');
  writeFileSync(statsPath, readFileSync(statsPath, 'utf8').replace('[98, 168, 86]', '[1, 2, 3]'));
  clearExtensionCache();
  const second = await load(work);
  const after = colorFor(second, 662100);
  assert.equal(after, '\x1b[38;2;1;2;3m', 'palette edit must take effect after /reload');
  assert.notEqual(before, after);

  // Threshold edits must reload too, not just colors.
  writeFileSync(statsPath, readFileSync(statsPath, 'utf8')
    .replace('n < 100000 ? 0', 'n < 900000 ? 0'));
  clearExtensionCache();
  const third = await load(work);
  assert.equal(colorFor(third, 662100), '\x1b[38;2;222;224;225m', 'threshold edit must take effect (neutral tier)');
  console.log('PASS: no .mjs runtime dependency; palette and threshold edits are live after reload');
} finally {
  rmSync(work, { recursive: true, force: true });
}
