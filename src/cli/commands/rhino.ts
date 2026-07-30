import { execFileSync } from 'node:child_process';
import { existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { Command } from 'commander';
import { EngineServicesClient } from '../../core/client';
import { requireResolvedConfig } from '../lib/config';
import { assertHostClosed, fetchPluginPackage } from '../lib/plugin-install';

const RHINO_PLUGIN_PACKAGE = '@thatopen-platform/flow-rhino';

/**
 * `thatopen rhino ...` — installs the That Open Rhino plug-in.
 *
 * Deliberately much smaller than the Revit group. The Rhino plug-in's whole job in the
 * interoperability layer is to PUBLISH what Rhino has; it applies nothing, so there is nothing to
 * drive from here. Everything that turns a Rhino model into a change in somebody else's model lives
 * in the platform, not in a plug-in.
 */
export const rhinoCommand = new Command('rhino').description(
  'Rhino interoperability — install the That Open Rhino plug-in',
);

/**
 * Installed through Yak rather than by copying files, because a Rhino package is not just files:
 * Yak records which Rhino versions the plug-in targets and refuses to install into one it was not
 * built for. Copying the .rhp by hand would skip that check and fail later, inside Rhino, with a
 * message about a missing type.
 */
rhinoCommand
  .command('install')
  .alias('update')
  .description('Install or update the That Open Rhino plug-in (Rhino must be closed)')
  .option('--version <version>', 'A specific version instead of the latest', 'latest')
  .action(async (opts: { version: string }) => {
    const cfg = requireResolvedConfig();
    assertHostClosed('Rhino', 'Rhino');

    const yak = findYak();
    if (!yak) {
      throw new Error(
        'Could not find Yak.exe. It ships with Rhino, at ' +
          'C:\\Program Files\\Rhino 8\\System\\Yak.exe. Is Rhino 8 installed?',
      );
    }

    const client = new EngineServicesClient(cfg.accessToken, cfg.apiUrl);
    console.log(`Fetching ${RHINO_PLUGIN_PACKAGE}@${opts.version}...`);
    const { dir, cleanup } = await fetchPluginPackage(client, RHINO_PLUGIN_PACKAGE, opts.version);

    try {
      const pkgDir = join(dir, 'pkg');
      const yakFile = existsSync(pkgDir)
        ? readdirSync(pkgDir).find((f) => f.endsWith('.yak'))
        : undefined;
      if (!yakFile) {
        throw new Error(`The package has no .yak under pkg/. Got: ${readdirSync(dir).join(', ')}`);
      }

      // `--source .` points Yak at the folder rather than the public server, so it installs the
      // file we just downloaded instead of going looking for a package of the same name online.
      execFileSync(yak, ['install', '--source', '.', 'rhino-flow'], {
        cwd: pkgDir,
        stdio: 'inherit',
      });

      console.log(`\nInstalled ${yakFile}.`);
      console.log('Start Rhino. The plug-in loads at startup, so its local server comes up with it.');
    } finally {
      cleanup();
    }
  });

/** Yak lives inside the Rhino installation, so its path is a Rhino version away. */
function findYak(): string | undefined {
  const candidates = [
    'C:\\Program Files\\Rhino 8\\System\\Yak.exe',
    'C:\\Program Files\\Rhino 9\\System\\Yak.exe',
    'C:\\Program Files\\Rhino 8 WIP\\System\\Yak.exe',
  ];
  return candidates.find((p) => existsSync(p));
}
