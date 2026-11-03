import { execFile } from 'node:child_process';
import {
  refreshBrowserSession,
  type BrowserSession,
} from '../../core/browser-sign-in';
import {
  readConfig,
  readLocalConfig,
  updateLocalConfig,
  writeConfig,
} from './config';

/** Renewed this long before it expires, so a command never starts on its last seconds. */
const RENEW_BEFORE_MS = 60_000;

/** Best effort: on a machine with no browser, the address is on the screen anyway. */
export function openInBrowser(url: string): void {
  const [command, args] =
    process.platform === 'win32'
      ? (['rundll32', ['url.dll,FileProtocolHandler', url]] as const)
      : process.platform === 'darwin'
        ? (['open', [url]] as const)
        : (['xdg-open', [url]] as const);
  execFile(command, [...args], () => {});
}

/**
 * Before a command runs, a browser sign-in whose access token is about to expire
 * gets a new one, in the same config it came from. A login with `--token` has no
 * session and is left alone.
 *
 * If the renewal fails the command goes on, and fails on its own call with the
 * platform's answer, unless the session was cut: then it says to log in again.
 */
export async function renewStoredSession(cwd?: string): Promise<void> {
  const local = readLocalConfig(cwd);
  const stored = local?.session ?? readConfig()?.session;
  if (!stored || stored.expiresAt - Date.now() > RENEW_BEFORE_MS) return;

  let next: BrowserSession;
  try {
    next = await refreshBrowserSession(stored);
  } catch (error) {
    console.error(
      `Could not renew your sign-in: ${error instanceof Error ? error.message : String(error)}`,
    );
    console.error('If this keeps happening, run `thatopen login` again.');
    return;
  }

  storeSession(next, cwd);
}

/** The stored session this token belongs to, if it came from a browser sign-in. */
export function storedSessionFor(
  accessToken: string,
  cwd?: string,
): BrowserSession | undefined {
  return [readLocalConfig(cwd)?.session, readConfig()?.session].find(
    (session) => session?.accessToken === accessToken,
  );
}

/** Puts a renewed session back where it came from: its refresh token has rotated. */
export function storeSession(session: BrowserSession, cwd?: string): void {
  const fields = {
    accessToken: session.accessToken,
    apiUrl: session.apiUrl,
    session,
  };
  if (readLocalConfig(cwd)?.session) updateLocalConfig(fields, cwd);
  else writeConfig(fields);
}
