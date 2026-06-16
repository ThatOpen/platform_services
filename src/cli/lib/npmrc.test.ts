import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
  mkdtempSync,
  rmSync,
  existsSync,
  readFileSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { setupNpmrc } from './npmrc';
import { RequestError } from '../../core/request-error';
import type { EngineServicesClient } from '../../core/client';

function fakeClient(getNpmCredentials: () => Promise<unknown>): EngineServicesClient {
  return { getNpmCredentials } as unknown as EngineServicesClient;
}

describe('setupNpmrc', () => {
  let dir: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'npmrc-test-'));
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it('writes .npmrc and returns written on success', async () => {
    const npmrc =
      '@thatopen-platform:registry=https://registry.npmjs.org/\n' +
      '//registry.npmjs.org/:_authToken=npm_ro\n';
    const client = fakeClient(async () => ({
      registry: 'https://registry.npmjs.org/',
      scope: '@thatopen-platform',
      token: 'npm_ro',
      npmrc,
    }));

    const result = await setupNpmrc(client, dir);

    expect(result).toEqual({ status: 'written', scope: '@thatopen-platform' });
    expect(readFileSync(join(dir, '.npmrc'), 'utf-8')).toBe(npmrc);
  });

  it('returns forbidden and writes nothing on a 403', async () => {
    const client = fakeClient(async () => {
      throw new RequestError(
        403,
        'Forbidden',
        JSON.stringify({ message: 'Community membership required' }),
      );
    });

    const result = await setupNpmrc(client, dir);

    expect(result).toEqual({ status: 'forbidden' });
    expect(existsSync(join(dir, '.npmrc'))).toBe(false);
  });

  it('returns error (and writes nothing) on any other failure', async () => {
    const client = fakeClient(async () => {
      throw new Error('network down');
    });

    const result = await setupNpmrc(client, dir);

    expect(result.status).toBe('error');
    expect(existsSync(join(dir, '.npmrc'))).toBe(false);
  });

  describe('.gitignore protection (Sergio review #19)', () => {
    const okClient = () =>
      fakeClient(async () => ({
        registry: 'https://registry.npmjs.org/',
        scope: '@thatopen-platform',
        token: 'npm_ro',
        npmrc: '//registry.npmjs.org/:_authToken=npm_ro\n',
      }));

    const gitignore = () =>
      readFileSync(join(dir, '.gitignore'), 'utf-8');

    it('creates .gitignore ignoring .npmrc when none exists', async () => {
      await setupNpmrc(okClient(), dir);
      expect(gitignore()).toBe('.npmrc\n');
    });

    it('appends .npmrc to an existing .gitignore that lacks it', async () => {
      writeFileSync(join(dir, '.gitignore'), 'node_modules\ndist\n');
      await setupNpmrc(okClient(), dir);
      expect(gitignore()).toBe('node_modules\ndist\n.npmrc\n');
    });

    it('adds a newline before appending when the file has no trailing newline', async () => {
      writeFileSync(join(dir, '.gitignore'), 'node_modules');
      await setupNpmrc(okClient(), dir);
      expect(gitignore()).toBe('node_modules\n.npmrc\n');
    });

    it('does not duplicate .npmrc when already ignored', async () => {
      writeFileSync(join(dir, '.gitignore'), 'node_modules\n.npmrc\ndist\n');
      await setupNpmrc(okClient(), dir);
      expect(gitignore()).toBe('node_modules\n.npmrc\ndist\n');
    });

    it('does not write .gitignore when the account is forbidden', async () => {
      const client = fakeClient(async () => {
        throw new RequestError(403, 'Forbidden', '{}');
      });
      await setupNpmrc(client, dir);
      expect(existsSync(join(dir, '.gitignore'))).toBe(false);
    });
  });
});
