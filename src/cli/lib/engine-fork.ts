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
 * the project (hoisted workspaces).
 *
 * Paths are resolved first: the permission model checks real paths, and the
 * system temp folder is a symlink on macOS.
 */
export function forkEngine(cwd: string, scriptPath: string): ChildProcess {
  const script = realpathSync(scriptPath);
  const project = realpathSync(cwd);
  const readable = [script, project];
  for (let dir = dirname(project); ; dir = dirname(dir)) {
    const modules = join(dir, 'node_modules');
    if (existsSync(modules)) readable.push(modules);
    if (dirname(dir) === dir) break;
  }

  const env: NodeJS.ProcessEnv = { NODE_PATH: join(project, 'node_modules') };
  // Windows needs SystemRoot for crypto and networking in the child.
  if (process.env.SystemRoot) env.SystemRoot = process.env.SystemRoot;

  return fork(script, [], {
    execArgv: PERMISSION_FLAG
      ? [PERMISSION_FLAG, ...readable.map((p) => `--allow-fs-read=${p}`)]
      : [],
    stdio: ['inherit', 'inherit', 'inherit', 'ipc'],
    env,
  });
}

export const permissionModelAvailable = PERMISSION_FLAG !== undefined;
