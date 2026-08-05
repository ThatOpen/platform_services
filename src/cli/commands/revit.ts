import { execFileSync, execSync, spawn } from 'node:child_process';
import { existsSync, readdirSync } from 'node:fs';
import { basename, join, resolve } from 'node:path';
import { Command } from 'commander';
import { EngineServicesClient } from '../../core/client';
import { requireResolvedConfig } from '../lib/config';
import { assertHostClosed, fetchPluginPackage } from '../lib/plugin-install';
import { addinAlive, callAddin, configureAddin, waitForAddin } from '../lib/revit-addin';

/** Is Revit up? Only used to decide whether we are allowed to install, which needs it closed. */
function isRevitRunning(): boolean {
  if (process.platform !== 'win32') return false;
  try {
    return execSync('tasklist /FI "IMAGENAME eq Revit.exe" /NH', { encoding: 'utf-8' })
      .toLowerCase()
      .includes('revit.exe');
  } catch {
    return false;
  }
}

/** Starts Revit and returns immediately. Detached on purpose: Revit outlives this command. */
function startRevit(): void {
  const roots = ['C:\\Program Files\\Autodesk'];
  for (const root of roots) {
    if (!existsSync(root)) continue;
    for (const dir of readdirSync(root)) {
      if (!/^Revit \d{4}$/.test(dir)) continue;
      const exe = join(root, dir, 'Revit.exe');
      if (!existsSync(exe)) continue;
      spawn(exe, [], { detached: true, stdio: 'ignore' }).unref();
      return;
    }
  }
  console.log('      Could not find Revit.exe. Start Revit yourself and this will pick it up.');
}

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

/**
 * `thatopen revit share` — a .rvt on your disk to your local open in Revit, in one command.
 *
 * WHY THIS EXISTS. Everything it does was already here, in six pieces: install, start Revit,
 * inspect, publish-central, join, report. An assistant driving them one at a time spent nine
 * minutes on a job whose real work is one download, because every piece is a decision to make and
 * a result to read. Measured 2026-08-05. The pieces stay; this is the straight line through them.
 */
revitCommand
  .command('share')
  .description('Share a .rvt with your team: install if needed, publish the central, open your local')
  .requiredOption('--file <path>', 'Absolute path to the .rvt on this machine')
  .requiredOption('--project <id>', 'Platform project id (or the dashboard URL)')
  .option('--doc <name>', 'Short name for the shared central (default: from the file name)')
  .action(async (opts: { file: string; project: string; doc?: string }) => {
    const cfg = requireResolvedConfig();
    const file = resolve(opts.file);
    if (!existsSync(file)) {
      console.error(`No such file: ${file}`);
      process.exit(1);
    }
    // A dashboard URL is what people have in their clipboard; the id is buried in it.
    const project = opts.project.match(/projects\/([a-f0-9]{24})/i)?.[1] ?? opts.project;
    // A central's name becomes a folder name and a file name, so it is kebab-cased here rather
    // than left as whatever the .rvt was called ("Snowdon Towers Sample Structural").
    const doc =
      opts.doc ??
      basename(file, '.rvt').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');

    console.log(`Sharing "${basename(file)}" as "${doc}" in project ${project}.\n`);

    // 1 ── the add-in. Installing needs Revit CLOSED, so this only installs when nothing is
    //      listening AND Revit is not running.
    if (!(await addinAlive())) {
      if (!isRevitRunning()) {
        console.log('[1/5] Installing the Revit add-in...');
        const client = new EngineServicesClient(cfg.accessToken, cfg.apiUrl);
        const { dir, cleanup } = await fetchPluginPackage(client, REVIT_ADDIN_PACKAGE, 'latest');
        try {
          const installer = join(dir, 'install.ps1');
          if (!existsSync(installer)) throw new Error('The package has no install.ps1.');
          execFileSync('powershell', ['-ExecutionPolicy', 'Bypass', '-File', installer], {
            stdio: 'inherit',
          });
        } finally {
          cleanup();
        }
        console.log('[2/5] Starting Revit...');
        startRevit();
      } else {
        // Revit is up but not answering: still starting, or the add-in is not installed.
        console.log('[1/5] Waiting for Revit...');
      }
      if (!(await waitForAddin(300000))) {
        console.error(
          '\nRevit did not report in. If it is open, the add-in may not be installed:\n' +
            '  close Revit, run "thatopen revit install", and start it again.',
        );
        process.exit(1);
      }
    } else {
      console.log('[1/5] Revit is open and the add-in is answering.');
    }

    await configureAddin(cfg.apiUrl, cfg.accessToken);

    // 2 ── is it already a central? That decides whether converting is even on the table.
    console.log('[3/5] Checking the file...');
    const info = await callAddin('inspect', { file });
    console.log(
      info.isCentral
        ? '      Already a workshared central. Publishing a copy of it.'
        : '      Not a central yet. Converting a COPY. Your file is not modified.',
    );

    // 3 ── publish. Always on a copy, which is what makes convert safe to pass unconditionally.
    console.log('[4/5] Publishing to the platform (Revit is saving the central, this takes a bit)...');
    const pub = await callAddin('publish-central', { project, doc, file, convert: true });

    // 4 ── and join it, so whoever shared it works in their own local like everybody else.
    //      Sharing and then editing the original is the one reliable way to end up outside the team.
    console.log('[5/5] Creating and opening your local...');
    const joined = await callAddin('join', { project, doc });

    console.log(`\nShared. Central "${doc}" is v${pub.version} in project ${project}.`);
    console.log(`Your local, now open in Revit:\n  ${joined.local}`);
    console.log(`\nTeammates join with:\n  thatopen revit join --project ${project} --doc ${doc}`);
    console.log(`From here, Revit's own Synchronize with Central publishes to the team.`);
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
