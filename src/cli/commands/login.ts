import { Command } from 'commander';
import { readFileSync } from 'node:fs';
import { hostname } from 'node:os';
import { join } from 'node:path';
import { signInWithBrowser } from '../../core/browser-sign-in';
import { openInBrowser } from '../lib/browser-session';
import { writeConfig, updateLocalConfig, readLocalConfig } from '../lib/config';
import { cliClient } from '../lib/cli-client';
import { setupNpmrc } from '../lib/npmrc';

const PACKAGE_VERSION: string = JSON.parse(
  readFileSync(join(__dirname, '..', 'package.json'), 'utf-8'),
).version;

const signIn = async (apiUrl: string) => {
  try {
    return await signInWithBrowser({
      apiUrl,
      application: 'That Open CLI',
      machine: hostname(),
      version: PACKAGE_VERSION,
      onVerification: ({ url, userCode, manualUrl }) => {
        console.log('');
        console.log(`  Your code: ${userCode}`);
        console.log('');
        console.log('  Confirm it in the browser that has just opened.');
        console.log(`  If none did, go to ${manualUrl} and enter the code.`);
        console.log('');
        openInBrowser(url);
      },
    });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`Could not sign in: ${msg}`);
    console.error(
      'You can also log in with a token from the dashboard: thatopen login --token <token>',
    );
    process.exit(1);
  }
};

export const loginCommand = new Command('login')
  .description('Authenticate with the ThatOpen platform')
  .option(
    '--token <token>',
    'Access token from the dashboard. Without one, you sign in through your browser',
  )
  .option(
    '--api-url <url>',
    'API URL (defaults to production; pass https://dev.platform.thatopen.com for the dev environment)',
    'https://platform.thatopen.com',
  )
  .option(
    '--local',
    'Save credentials to local .thatopen file instead of global config',
  )
  .action(async (opts: { token?: string; apiUrl: string; local?: boolean }) => {
    const apiUrl = opts.apiUrl.replace(/\/$/, '');

    const session = opts.token ? undefined : await signIn(apiUrl);
    const accessToken = opts.token ?? session!.accessToken;

    console.log('Validating token...');

    const client = cliClient(accessToken, apiUrl);

    try {
      await client.listApps();
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error(`Token validation failed: ${msg}`);
      console.error('Check your token and API URL.');
      process.exit(1);
    }

    if (opts.local) {
      updateLocalConfig({ accessToken, apiUrl, session });
      console.log('Logged in successfully. Config saved to .thatopen');
    } else {
      writeConfig({ accessToken, apiUrl, session });
      console.log(
        'Logged in successfully. Config saved to ~/.thatopen/config.json',
      );
    }

    // In a beta project, refresh .npmrc so a rotated Founders token propagates
    // on the next login. Best-effort — never blocks login.
    if (readLocalConfig()?.beta) {
      const result = await setupNpmrc(client, process.cwd());
      if (result.status === 'written') {
        console.log(`Beta access refreshed — updated .npmrc for ${result.scope}.`);
      }
    }
  });
