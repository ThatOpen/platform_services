import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';

/**
 * Talks to the local That Open Revit add-in (revit-flow). The add-in runs a
 * 127.0.0.1 command listener and, on startup, writes its port + token to
 * %APPDATA%\ThatOpen\revit-addin.json so the CLI can discover it. Revit-specific
 * work (create central, create local, sync) happens inside the add-in; the CLI
 * only drives it — the same "CLI does everything" model as the rest of `thatopen`.
 */

export interface AddinInfo {
  port: number;
  token: string;
  pid: number;
}

function discoveryFile(): string {
  const appData =
    process.env.APPDATA || join(homedir(), 'AppData', 'Roaming');
  return join(appData, 'ThatOpen', 'revit-addin.json');
}

/** The add-in's discovery file, or null. Unlike discoverAddin this never exits. */
export function tryDiscoverAddin(): AddinInfo | null {
  const file = discoveryFile();
  if (!existsSync(file)) return null;
  try {
    return JSON.parse(readFileSync(file, 'utf-8')) as AddinInfo;
  } catch {
    return null;
  }
}

/** Is there an add-in listening right now? Asks it, rather than trusting the file:
 *  Revit exiting leaves the file behind. */
export async function addinAlive(): Promise<boolean> {
  const info = tryDiscoverAddin();
  if (!info) return false;
  try {
    const res = await fetch(`http://127.0.0.1:${info.port}/status`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-RevitFlow-Token': info.token },
      body: '{}',
      signal: AbortSignal.timeout(4000),
    });
    return res.ok;
  } catch {
    return false;
  }
}

/** Waits for Revit to finish starting. Revit takes its time, and the add-in's
 *  listener comes up well before the splash screen goes away. */
export async function waitForAddin(timeoutMs: number): Promise<boolean> {
  const until = Date.now() + timeoutMs;
  while (Date.now() < until) {
    if (await addinAlive()) return true;
    await new Promise((r) => setTimeout(r, 2000));
  }
  return false;
}

export function discoverAddin(): AddinInfo {
  const file = discoveryFile();
  if (!existsSync(file)) {
    console.error('');
    console.error('  The That Open Revit add-in is not running.');
    console.error('  Open Revit 2026 (with the add-in installed) and try again.');
    console.error('  If it is not installed yet, install it and restart Revit.');
    console.error('');
    process.exit(1);
  }
  try {
    return JSON.parse(readFileSync(file, 'utf-8')) as AddinInfo;
  } catch {
    console.error(`Could not read the add-in discovery file at ${file}.`);
    process.exit(1);
  }
}

export async function callAddin(
  cmd: string,
  body: Record<string, unknown> = {},
): Promise<Record<string, unknown>> {
  const info = discoverAddin();
  let res: Response;
  try {
    res = await fetch(`http://127.0.0.1:${info.port}/${cmd}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-RevitFlow-Token': info.token,
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(600000),
    });
  } catch {
    console.error(
      `Could not reach the Revit add-in on port ${info.port}. Is Revit still open?`,
    );
    process.exit(1);
  }
  const text = await res.text();
  let json: Record<string, unknown>;
  try {
    json = text ? (JSON.parse(text) as Record<string, unknown>) : {};
  } catch {
    json = { raw: text };
  }
  if (!res.ok || json.ok === false || json.error) {
    const msg = json.error || json.err || res.statusText;
    console.error(`Revit add-in error: ${msg}`);
    process.exit(1);
  }
  return json;
}

/**
 * Push the logged-in user's credentials (API url + token) into the add-in so it
 * talks to the right account and environment (dev/prod). Idempotent; called
 * before each command.
 */
export async function configureAddin(
  apiUrl: string,
  accessToken: string,
): Promise<void> {
  await callAddin('settings', {
    base: apiUrl.replace(/\/$/, ''),
    key: accessToken,
  });
}
