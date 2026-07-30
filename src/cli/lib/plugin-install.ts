import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { EngineServicesClient } from '../../core/client';
import { setupNpmrc } from './npmrc';

/**
 * Downloads a private plug-in package and hands back the folder it unpacked into.
 *
 * npm does the work on purpose. It resolves what "latest" means, it authenticates against the
 * restricted scope, and it verifies the tarball's integrity — three things this would otherwise
 * hand-roll over HTTP and get subtly wrong. The only thing we add is the platform token, which
 * `setupNpmrc` trades for registry credentials exactly as the `--beta` flows do. No npm account is
 * involved and no npm token is ever asked for.
 */
export async function fetchPluginPackage(
  client: EngineServicesClient,
  pkg: string,
  version = 'latest',
): Promise<{ dir: string; cleanup: () => void }> {
  const work = mkdtempSync(join(tmpdir(), 'thatopen-plugin-'));
  const cleanup = () => {
    try {
      rmSync(work, { recursive: true, force: true });
    } catch {
      // A temp folder we could not delete is not worth failing an install over.
    }
  };

  try {
    const creds = await setupNpmrc(client, work);
    if (creds.status === 'forbidden') {
      throw new Error(
        'Your account does not have access to the private plug-in packages. ' +
          'They need Founding access, the same as the beta engine libraries.',
      );
    }
    if (creds.status === 'error') {
      throw new Error(`Could not get registry credentials: ${creds.message}`);
    }

    // `npm pack` rather than `npm install`: we want the files, not a node_modules tree, and pack
    // leaves a single tarball whose name tells us the version that was actually resolved.
    execFileSync('npm', ['pack', `${pkg}@${version}`, '--silent'], {
      cwd: work,
      stdio: ['ignore', 'ignore', 'inherit'],
      shell: process.platform === 'win32',
    });

    const tgz = readdirSync(work).find((f) => f.endsWith('.tgz'));
    if (!tgz) throw new Error(`npm pack produced no tarball for ${pkg}@${version}.`);

    // tar ships with Windows 10 and later, and with every platform this CLI runs on.
    execFileSync('tar', ['-xzf', tgz], { cwd: work, stdio: 'inherit' });

    // npm tarballs always unpack into a folder called `package`.
    const dir = join(work, 'package');
    if (!existsSync(dir)) throw new Error(`${tgz} did not unpack into a package/ folder.`);

    return { dir, cleanup };
  } catch (err) {
    cleanup();
    throw err;
  }
}

/**
 * Refuses to install while the host application is running.
 *
 * This is not caution, it is the difference between a failed install and a broken one. Both Revit
 * and Rhino hold their plug-in assemblies open for the whole session, so a copy over a running host
 * fails on the first locked file — AFTER copying the ones it reached. The result is a folder holding
 * some new DLLs and some old, which loads, misbehaves, and looks like a bug in the product.
 */
export function assertHostClosed(processName: string, friendly: string): void {
  let running = false;
  try {
    const out = execFileSync(
      'powershell',
      ['-NoProfile', '-Command', `if (Get-Process -Name ${processName} -ErrorAction SilentlyContinue) { 'yes' }`],
      { encoding: 'utf-8' },
    );
    running = out.trim() === 'yes';
  } catch {
    // If we cannot tell, let the install proceed rather than block on a broken check.
    return;
  }

  if (running) {
    throw new Error(
      `${friendly} is running. Close it and run this again.\n\n` +
        `Its plug-in files are locked while it is open, so installing now would replace some of ` +
        `them and not others.`,
    );
  }
}
