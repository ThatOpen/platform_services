import { describe, it, expect } from 'vitest';
import { mkdirSync, mkdtempSync, realpathSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { forkEngine, permissionModelAvailable } from './engine-fork';

/**
 * A locally run component must not get more than the cloud worker gives it:
 * no file writes, child processes or worker threads, and none of the
 * developer's environment. Module resolution (own and hoisted node_modules)
 * must keep working.
 */
describe.runIf(permissionModelAvailable)('forkEngine', () => {
  it('runs the component under the permission model with a minimal env', async () => {
    const root = realpathSync(mkdtempSync(join(tmpdir(), 'thatopen-fork-')));
    const project = join(root, 'component');
    // A workspace layout: the component's own dependency requires one that
    // is hoisted to the root node_modules. The engine script lives elsewhere,
    // as the CLI writes it to the temp folder.
    mkdirSync(join(root, 'node_modules', 'hoisted'), { recursive: true });
    mkdirSync(join(project, 'node_modules', 'own'), { recursive: true });
    writeFileSync(join(root, 'node_modules', 'hoisted', 'index.js'), 'module.exports = 42;');
    writeFileSync(join(project, 'node_modules', 'own', 'index.js'), "module.exports = require('hoisted');");
    // node_modules above the temp folder are searched before NODE_PATH, as
    // happens with a node_modules in the user's home folder.
    mkdirSync(join(root, 'tmp', 'node_modules', 'scriptside'), { recursive: true });
    writeFileSync(join(root, 'tmp', 'node_modules', 'scriptside', 'package.json'), '{"main":"main.js"}');
    writeFileSync(join(root, 'tmp', 'node_modules', 'scriptside', 'main.js'), "module.exports = 'found';");
    const script = join(root, 'tmp', 'run', 'engine.js');
    mkdirSync(join(root, 'tmp', 'run'));
    writeFileSync(
      script,
      `const r = {};
      const attempt = (name, fn) => { try { fn(); r[name] = 'allowed'; } catch (e) { r[name] = e.code || e.message; } };
      attempt('write', () => require('fs').writeFileSync(${JSON.stringify(join(project, 'out.txt'))}, '1'));
      attempt('spawn', () => require('child_' + 'process').execFileSync(process.execPath, ['-e', '0']));
      attempt('worker', () => new (require('worker_' + 'threads').Worker)('0', { eval: true }));
      r.hoisted = require('own');
      r.scriptside = require('scriptside');
      r.canary = process.env.THATOPEN_FORK_CANARY ?? null;
      process.send(r, () => process.exit(0));`,
    );

    process.env.THATOPEN_FORK_CANARY = 'leaked';
    const result = await new Promise<Record<string, unknown>>((resolve, reject) => {
      const child = forkEngine(project, script);
      child.on('message', (m) => resolve(m as Record<string, unknown>));
      child.on('error', reject);
      child.on('exit', (code) => reject(new Error(`exited ${code} without a result`)));
    }).finally(() => delete process.env.THATOPEN_FORK_CANARY);

    expect(result).toEqual({
      write: 'ERR_ACCESS_DENIED',
      spawn: 'ERR_ACCESS_DENIED',
      worker: 'ERR_ACCESS_DENIED',
      hoisted: 42,
      scriptside: 'found',
      canary: null,
    });
  });
});
