import { describe, it, expect } from 'vitest';
import { fork } from 'node:child_process';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { buildEngineScript } from './engine-script';

/**
 * The local engine must offer the same executionReporter as the platform's,
 * including error(), which the cloud-component README documents.
 */
describe('buildEngineScript', () => {
  it('provides executionReporter.error', async () => {
    const root = mkdtempSync(join(tmpdir(), 'thatopen-engine-'));
    const services = join(root, 'node_modules', '@thatopen', 'services');
    mkdirSync(services, { recursive: true });
    writeFileSync(join(services, 'index.js'), 'exports.EngineServicesClient = class {};');
    const bundle = `var main = async () => {
      executionReporter.error('bad row');
      return { type: 'SUCCESS', message: 'done' };
    };`;
    const script = join(root, 'engine.js');
    writeFileSync(
      script,
      buildEngineScript(bundle, 'token', 'http://localhost', {}, {
        executionId: 'e',
        toolId: 'local',
        toolVersion: 'local',
      }),
    );

    const messages = await new Promise<unknown[]>((resolve, reject) => {
      const received: unknown[] = [];
      const child = fork(script, [], { stdio: ['ignore', 'ignore', 'ignore', 'ipc'] });
      child.on('message', (m) => received.push(m));
      child.on('error', reject);
      child.on('exit', () => resolve(received));
      setTimeout(() => child.kill(), 5000);
    });

    expect(messages).toEqual([
      { type: 'ERROR', message: 'bad row' },
      { type: 'SUCCESS', message: 'done' },
    ]);
  });
});
