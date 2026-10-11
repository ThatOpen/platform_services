import { existsSync, realpathSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fork, type ChildProcess } from 'node:child_process';

const flags = process.allowedNodeEnvironmentFlags;
const PERMISSION_FLAG = flags.has('--permission')
  ? '--permission'
  : flags.has('--experimental-permission')
    ? '--experimental-permission'
    : undefined;

/**
 * Forks the engine script for a locally run cloud component, matching the cloud
 * worker: Node's permission model (no file writes, child processes or worker
 * threads) and none of the developer's environment variables. The component
 * may read its project folder, the engine script and any node_modules above
 * either of them (hoisted workspaces, or a node_modules in the home folder).
 *
 * Paths are resolved first: the permission model checks real paths, and the
 * system temp folder is a symlink on macOS.
 */
export function forkEngine(cwd: string, scriptPath: string): ChildProcess {
  const script = realpathSync(scriptPath);
  const project = realpathSync(cwd);
  const readable = new Set([script, project]);
  // Node searches node_modules above the script before NODE_PATH, and the
  // dependencies' own lookups climb above the project: allow both chains, so
  // modules resolve exactly as they did without the permission model.
  for (const start of [dirname(script), dirname(project)]) {
    for (let dir = start; ; dir = dirname(dir)) {
      const modules = join(dir, 'node_modules');
      if (existsSync(modules)) readable.add(modules);
      if (dirname(dir) === dir) break;
    }
  }

  const env: NodeJS.ProcessEnv = { NODE_PATH: join(project, 'node_modules') };
  // Windows needs SystemRoot for crypto and networking in the child.
  if (process.env.SystemRoot) env.SystemRoot = process.env.SystemRoot;

  return fork(script, [], {
    execArgv: PERMISSION_FLAG
      ? [PERMISSION_FLAG, ...[...readable].map((p) => `--allow-fs-read=${p}`)]
      : [],
    stdio: ['inherit', 'inherit', 'inherit', 'ipc'],
    env,
  });
}

export const permissionModelAvailable = PERMISSION_FLAG !== undefined;
