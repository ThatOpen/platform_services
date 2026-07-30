import { execFileSync } from 'node:child_process';
import { existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { Command } from 'commander';
import { EngineServicesClient } from '../../core/client';
import { requireResolvedConfig } from '../lib/config';
import { assertHostClosed, fetchPluginPackage } from '../lib/plugin-install';
import { callAddin, configureAddin } from '../lib/revit-addin';

/** One package per plug-in: they share no version relationship, only the platform and the .frag
 *  format, whose compatibility is carried by the schema string inside each file. */
const REVIT_ADDIN_PACKAGE = '@thatopen-platform/flow-revit';

/**
 * `thatopen revit ...` — Revit collaboration commands. They drive the local
 * That Open Revit add-in (revit-flow): publish a shared central, join one, and sync.
 * Auth comes from `thatopen login` (~/.thatopen/config.json) and is forwarded to
 * the add-in, so the user never re-enters a token here.
 */
export const revitCommand = new Command('revit').description(
  'Revit collaboration — drive the That Open Revit add-in from the CLI',
);

async function connect() {
  const cfg = requireResolvedConfig();
  await configureAddin(cfg.apiUrl, cfg.accessToken);
  return cfg;
}

revitCommand
  .command('status')
  .description('Show the add-in status and the current project / central')
  .action(async () => {
    await connect();
    const r = await callAddin('status');
    console.log(JSON.stringify(r, null, 2));
  });

revitCommand
  .command('inspect')
  .description('Check whether a .rvt is already a workshared central (before sharing)')
  .requiredOption('--file <path>', 'Absolute path to the .rvt to inspect')
  .action(async (opts: { file: string }) => {
    await connect();
    const r = await callAddin('inspect', { file: opts.file });
    console.log(JSON.stringify(r, null, 2));
    if (r.isCentral) {
      console.log('\nThis file is already a central — you can share it as-is (a copy is uploaded; your original is untouched).');
    } else {
      console.log('\nThis file is NOT a central yet. To share it, it must be converted into one.');
      console.log('Publishing works on a COPY, so your original file is never modified.');
      console.log('Ask the user for consent, then run publish-central with --convert.');
    }
  });

revitCommand
  .command('publish-central')
  .description('Turn a .rvt into a shared central and upload it to a project')
  .requiredOption('--project <id>', 'Platform project id')
  .requiredOption('--doc <name>', 'A short name for this central (e.g. tower-central)')
  .requiredOption('--file <path>', 'Absolute path to the source .rvt on this machine')
  .option('--convert', 'Allow converting a non-central .rvt into one (on a copy; original untouched)')
  .action(async (opts: { project: string; doc: string; file: string; convert?: boolean }) => {
    await connect();
    console.log(`Publishing "${opts.file}" as central "${opts.doc}"...`);
    console.log('(Revit is enabling worksharing and saving the central — this can take a bit.)');
    const r = await callAddin('publish-central', {
      project: opts.project,
      doc: opts.doc,
      file: opts.file,
      convert: !!opts.convert,
    });
    const how = r.wasCentral ? 'copied the existing central' : 'converted a copy into a central';
    console.log(`Published (${how}). Central: ${r.central} (version ${r.version}).`);
    console.log(`Your original file was not modified. Collaborators can now join with:`);
    console.log(`  thatopen revit join --project ${opts.project} --doc ${opts.doc}`);
  });

revitCommand
  .command('join')
  .description('Download a shared central and create + open your local in Revit')
  .option('--folder-id <id>', "The central's project folder id (the revit-<doc> folder in That Open)")
  .option('--path <path>', 'Local path to the shared central (C:\\ThatOpenShared\\<proj>\\<doc>\\<name>.rvt)')
  .option('--project <id>', 'Platform project id (use together with --doc)')
  .option('--doc <name>', 'The central name to join (use together with --project)')
  .action(
    async (opts: { folderId?: string; path?: string; project?: string; doc?: string }) => {
      await connect();
      if (!opts.folderId && !opts.path && !(opts.project && opts.doc)) {
        console.error(
          'Identify the central to join with one of: --folder-id, --path, or --project + --doc.',
        );
        process.exit(1);
      }
      console.log('Joining...');
      const r = await callAddin('join', {
        folderId: opts.folderId,
        path: opts.path,
        project: opts.project,
        doc: opts.doc,
      });
      console.log(`Joined. Your local was created and opened in Revit:`);
      console.log(`  ${r.local}`);
      console.log(`Model as usual, then run "thatopen revit sync" (or the "Sync to team" button).`);
    },
  );

revitCommand
  .command('sync')
  .description('Synchronize your local with the team (queued, no divergence)')
  .action(async () => {
    await connect();
    console.log('Syncing with the team...');
    const r = await callAddin('sync');
    console.log(`Synced.  v${r.verB} → v${r.verA}.`);
  });

revitCommand
  .command('worksets')
  .description('List the model worksets and who owns each')
  .action(async () => {
    await connect();
    const r = await callAddin('worksets');
    console.log(JSON.stringify(r.worksets, null, 2));
  });

revitCommand
  .command('take')
  .description('Take ownership of a workset (only one person at a time — the team lock arbitrates)')
  .requiredOption('--workset <name>', 'The workset name to take')
  .action(async (opts: { workset: string }) => {
    await connect();
    const r = await callAddin('take', { workset: opts.workset });
    if (r.taken) console.log(`✓ Took workset "${r.workset}" (${r.result}). You can now edit its elements.`);
    else console.log(`✗ Could NOT take "${r.workset}" — it is held by "${r.deniedBy}". Ask them to release it (untake).`);
  });

revitCommand
  .command('untake')
  .description('Release a workset you own so teammates can take it')
  .requiredOption('--workset <name>', 'The workset name to release')
  .action(async (opts: { workset: string }) => {
    await connect();
    const r = await callAddin('untake', { workset: opts.workset });
    console.log(`Released workset "${r.released}".`);
  });

/**
 * Installing is the CLI's job rather than the add-in's, and not by preference. Revit holds the
 * add-in's assemblies open for the whole session, so the add-in can never replace itself — it can
 * only notice it is out of date and say so. The CLI runs with Revit closed, which is the one moment
 * the files can actually be written.
 */
revitCommand
  .command('install')
  .alias('update')
  .description('Install or update the That Open Revit add-in (Revit must be closed)')
  .option('--version <version>', 'A specific version instead of the latest', 'latest')
  .action(async (opts: { version: string }) => {
    const cfg = requireResolvedConfig();
    assertHostClosed('Revit', 'Revit');

    const client = new EngineServicesClient(cfg.accessToken, cfg.apiUrl);
    console.log(`Fetching ${REVIT_ADDIN_PACKAGE}@${opts.version}...`);
    const { dir, cleanup } = await fetchPluginPackage(
      client,
      REVIT_ADDIN_PACKAGE,
      opts.version,
    );

    try {
      const installer = join(dir, 'install.ps1');
      if (!existsSync(installer)) {
        throw new Error(`The package has no install.ps1. Got: ${readdirSync(dir).join(', ')}`);
      }
      // The package ships its own installer, so the CLI does not need to know where Revit keeps
      // its add-ins, nor which files there are. One place knows that, and it travels with the
      // build it belongs to.
      execFileSync('powershell', ['-ExecutionPolicy', 'Bypass', '-File', installer], {
        stdio: 'inherit',
      });
      console.log('\nStart Revit. The That Open tab will be there.');
    } finally {
      cleanup();
    }
  });
