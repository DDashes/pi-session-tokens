// Verifies the published artifact, not the working directory: pack the package,
// extract the tarball into a temp dir, and let Pi discover it as an installed
// package (manifest resolution included).
import assert from 'node:assert/strict';
import { execFileSync, execSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, rmSync, readdirSync, copyFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { resolve, join } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';

const root = process.env.PI_TEST_ROOT ?? 'C:/Users/Pondsi/.pi/agent/install/releases/1.5.0/node_modules/@earendil-works/pi-coding-agent';
const { discoverAndLoadExtensions, createExtensionRuntime } = await import(
  pathToFileURL(resolve(root, 'dist/core/extensions/loader.js')).href
);
const packageRoot = fileURLToPath(new URL('..', import.meta.url));
const work = mkdtempSync(join(tmpdir(), 'pi-session-tokens-pack-'));
// Windows ships npm as a .cmd shim, which Node refuses to spawn without a shell.
const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm';
const runNpm = args => process.platform === 'win32'
  ? execSync([npm, ...args].join(' '), { cwd: packageRoot, stdio: 'ignore' })
  : execFileSync(npm, args, { cwd: packageRoot, stdio: 'ignore' });

try {
  // Relative paths only: Windows tar treats "C:" as a remote host.
  runNpm(['pack', '--pack-destination', '.']);
  const tarball = readdirSync(packageRoot).find(name => name.endsWith('.tgz'));
  assert.ok(tarball, 'npm pack must produce a tarball');
  copyFileSync(join(packageRoot, tarball), join(work, tarball));
  rmSync(join(packageRoot, tarball));
  execFileSync('tar', ['-xzf', tarball, '-C', '.'], { cwd: work });
  const installed = join(work, 'package');

  const agentDir = join(work, 'agent');
  mkdirSync(join(agentDir, 'extensions'), { recursive: true });
  const result = await discoverAndLoadExtensions([installed], work, agentDir, undefined);
  assert.deepEqual(result.errors, [], 'the packed package must load');
  assert.equal(result.extensions.length, 1, 'exactly one extension from the tarball');
  const ext = result.extensions[0];
  assert.ok(ext.resolvedPath.startsWith(installed), 'loaded from the extracted tarball, not the source tree');
  assert.deepEqual([...ext.commands.keys()], ['tokens'], 'pi manifest exposes the command');
  assert.ok(ext.entryRenderers?.has('session-tokens.turn.v1'), 'renderer registered');
  assert.ok(ext.handlers.get('agent_settled')?.length, 'lifecycle handler registered');
  console.log('PASS: npm pack -> extract -> Pi discovery loads the published artifact');
} finally {
  rmSync(work, { recursive: true, force: true });
}
