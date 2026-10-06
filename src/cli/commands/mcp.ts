import { Command } from 'commander';
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { io, Socket } from 'socket.io-client';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';
import { resolveConfig } from '../lib/config';

/**
 * `thatopen mcp` — an MCP server over stdio that lets an LLM on the desktop
 * (Claude, or anything that speaks MCP) drive a running That Open app through
 * the platform channel: the same relay the app's `src/setups/channel.ts`
 * already listens to, reached as one external channel of kind `mcp`.
 *
 * stdout is the MCP wire. Nothing here may write to it — status and errors go
 * to stderr, and `src/cli/index.ts` skips its update banner for this command.
 *
 * Credentials resolve like every other CLI command (`resolveConfig`): the
 * project's `.thatopen`, then `~/.thatopen/config.json` from `thatopen login`.
 * `THATOPEN_TOKEN` / `THATOPEN_API_URL` override both, for MCP client configs
 * that inject their own environment.
 */

const SUBSCRIBE_TIMEOUT_MS = 10_000;
const DEFAULT_REPLY_TIMEOUT_MS = 10_000;
const MAX_REPLY_TIMEOUT_MS = 60_000;

interface ChannelMessage {
  type: string;
  requestId?: string;
  payload?: unknown;
}

function resolveCredentials(): { accessToken: string; apiUrl: string } | null {
  const envToken = process.env.THATOPEN_TOKEN;
  const envUrl = process.env.THATOPEN_API_URL;
  if (envToken && envUrl) return { accessToken: envToken, apiUrl: envUrl };
  const config = resolveConfig();
  if (!config) return null;
  return {
    accessToken: envToken ?? config.accessToken,
    apiUrl: envUrl ?? config.apiUrl,
  };
}

/** A project id, or any URL that carries one (the dashboard's project URL). */
function projectIdFrom(input: string): string | null {
  const trimmed = input.trim();
  if (/^[0-9a-f]{24}$/i.test(trimmed)) return trimmed;
  return trimmed.match(/projects?\/([0-9a-f]{24})/i)?.[1] ?? null;
}

/**
 * One socket for the whole MCP session, subscribed as a bare external channel
 * (no default project): every publish names its own target, so one session can
 * address whichever project the user is working on. Created on first use and
 * re-subscribed by the `connect` handler after every reconnect.
 */
class ChannelConnection {
  #socket?: Socket;
  #subscribed?: Promise<void>;

  constructor(private readonly credentials: { accessToken: string; apiUrl: string }) {}

  get connected(): boolean {
    return this.#socket?.connected ?? false;
  }

  async ready(): Promise<void> {
    if (this.#socket?.connected && this.#subscribed) return this.#subscribed;
    this.#subscribed = this.#open();
    return this.#subscribed;
  }

  #open(): Promise<void> {
    // WebSocket-only: the long-polling handshake spreads several HTTP
    // requests across the platform's load-balanced instances and can die
    // before it upgrades. The token rides the auth payload, not the URL.
    this.#socket ??= io(this.credentials.apiUrl, {
      transports: ['websocket'],
      auth: { accessToken: this.credentials.accessToken },
    });
    const socket = this.#socket;

    return new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => {
        cleanup();
        reject(new Error('The platform did not confirm the subscription in time.'));
      }, SUBSCRIBE_TIMEOUT_MS);

      const onMessage = (message: ChannelMessage) => {
        if (message?.type === 'channel:subscribed') {
          cleanup();
          resolve();
        } else if (message?.type === 'channel:error') {
          cleanup();
          reject(new Error(String(message.payload)));
        }
      };
      const onDisconnect = (reason: string) => {
        cleanup();
        // The gateway disconnects a socket it refuses, so this usually means
        // the token did not pass — name that instead of the raw reason.
        reject(
          new Error(
            `Disconnected while subscribing (${reason}). The token may be invalid or expired — run \`thatopen login\` again.`,
          ),
        );
      };
      const onError = (error: Error) => {
        cleanup();
        reject(new Error(`Could not connect to ${this.credentials.apiUrl}: ${error.message}`));
      };
      const cleanup = () => {
        clearTimeout(timer);
        socket.off('channelMessage', onMessage);
        socket.off('disconnect', onDisconnect);
        socket.off('connect_error', onError);
      };

      socket.on('channelMessage', onMessage);
      socket.on('disconnect', onDisconnect);
      socket.on('connect_error', onError);
      const subscribe = () => socket.emit('channelSubscribe', { kind: 'mcp' });
      if (socket.connected) subscribe();
      else socket.once('connect', subscribe);
    });
  }

  /** Publishes one command and resolves with the ack and, when asked, the reply. */
  async send(options: {
    projectId: string;
    appId?: string;
    type: string;
    payload?: unknown;
    waitForReply: boolean;
    timeoutMs: number;
  }): Promise<{ delivered: number; error?: string; reply?: unknown; replyError?: string; timedOut?: boolean }> {
    await this.ready();
    const socket = this.#socket!;
    const requestId = options.waitForReply ? randomUUID() : undefined;

    const ack = await new Promise<{ delivered: number; error?: string }>((resolve, reject) => {
      const timer = setTimeout(
        () => reject(new Error('The platform did not acknowledge the publish in time.')),
        SUBSCRIBE_TIMEOUT_MS,
      );
      socket.emit(
        'channelPublish',
        {
          type: options.type,
          requestId,
          payload: options.payload,
          projectId: options.projectId,
          appId: options.appId,
        },
        (response: { delivered: number; error?: string }) => {
          clearTimeout(timer);
          resolve(response);
        },
      );
    });

    if (!requestId || ack.delivered === 0 || ack.error) return ack;

    return new Promise((resolve) => {
      const timer = setTimeout(() => {
        cleanup();
        resolve({ ...ack, timedOut: true });
      }, options.timeoutMs);
      const onMessage = (message: ChannelMessage) => {
        if (message?.requestId !== requestId) return;
        if (message.type === 'reply') {
          cleanup();
          resolve({ ...ack, reply: message.payload });
        } else if (message.type === 'reply-error') {
          cleanup();
          const detail = (message.payload as { error?: string } | undefined)?.error;
          resolve({ ...ack, replyError: detail ?? 'The app reported an error.' });
        }
      };
      const cleanup = () => {
        clearTimeout(timer);
        socket.off('channelMessage', onMessage);
      };
      socket.on('channelMessage', onMessage);
    });
  }
}

function text(value: unknown) {
  return {
    content: [
      {
        type: 'text' as const,
        text: typeof value === 'string' ? value : JSON.stringify(value, null, 2),
      },
    ],
  };
}

async function startMcpServer() {
  // Same resolution as src/cli/index.ts: the bundle lives in dist/, the
  // package.json one directory up.
  const pkg = JSON.parse(
    readFileSync(join(__dirname, '..', 'package.json'), 'utf-8'),
  );
  const server = new McpServer({ name: 'thatopen-platform', version: pkg.version });

  const credentials = resolveCredentials();
  let connection: ChannelConnection | undefined;
  const connect = () => {
    if (!credentials) {
      throw new Error(
        'No platform credentials found. Run `thatopen login` first, or set THATOPEN_TOKEN and THATOPEN_API_URL in this MCP server\'s environment.',
      );
    }
    connection ??= new ChannelConnection(credentials);
    return connection;
  };

  server.tool(
    'platform-status',
    'Reports whether this MCP server can reach the That Open Platform: which API it points at, whether credentials were found, and whether the channel subscription works. Call it first when another tool fails.',
    {},
    async () => {
      if (!credentials) {
        return text(
          'No credentials. Ask the user to run `thatopen login`, or to set THATOPEN_TOKEN and THATOPEN_API_URL in the MCP server config.',
        );
      }
      try {
        await connect().ready();
        return text({ apiUrl: credentials.apiUrl, subscribed: true });
      } catch (error) {
        return text({
          apiUrl: credentials.apiUrl,
          subscribed: false,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    },
  );

  server.tool(
    'send-app-command',
    'Sends a command to a running That Open app through the platform channel and returns its reply. The app must be open in a browser tab and listening (apps scaffolded by `thatopen create` handle `ping` and `get-loaded-models` out of the box; apps declare their own commands in src/setups/channel.ts). While the user iterates with `thatopen serve`, omit app_id — the dev channel is keyed to the account; pass it once the app is published. `delivered: 0` means no tab of the app has the channel joined, usually because the app is simply not open — ask the user to open or reload the app tab.',
    {
      project: z
        .string()
        .describe('The project id (24 hex characters), or the project\'s dashboard URL.'),
      command: z
        .string()
        .describe('The command name the app handles, e.g. "ping" or "get-loaded-models".'),
      payload: z
        .unknown()
        .optional()
        .describe('JSON payload for the command, if it takes one.'),
      app_id: z
        .string()
        .regex(/^[0-9a-f]{24}$/i)
        .optional()
        .describe('The published app\'s id. Omit while the app runs under `thatopen serve`.'),
      wait_for_reply: z
        .boolean()
        .optional()
        .describe('Default true. Set false for fire-and-forget notifications.'),
      timeout_ms: z
        .number()
        .int()
        .min(1000)
        .max(MAX_REPLY_TIMEOUT_MS)
        .optional()
        .describe(`How long to wait for the app's reply. Default ${DEFAULT_REPLY_TIMEOUT_MS}.`),
    },
    async (args) => {
      const projectId = projectIdFrom(args.project);
      if (!projectId) {
        return text(
          `Could not find a project id in "${args.project}". Pass the 24-hex id or the dashboard URL of the project.`,
        );
      }
      const result = await connect().send({
        projectId,
        appId: args.app_id,
        type: args.command,
        payload: args.payload,
        waitForReply: args.wait_for_reply !== false,
        timeoutMs: args.timeout_ms ?? DEFAULT_REPLY_TIMEOUT_MS,
      });
      if (result.error) return text({ delivered: result.delivered, error: result.error });
      if (result.delivered === 0) {
        return text({
          delivered: 0,
          hint: 'No tab of that app has the channel joined — usually the app is simply not open. Ask the user to open (or reload) the app tab and retry.',
        });
      }
      if (result.timedOut) {
        return text({
          delivered: result.delivered,
          hint: `The app received the command but did not reply within ${args.timeout_ms ?? DEFAULT_REPLY_TIMEOUT_MS} ms. Either the command declares no reply, or its handler is slow — retry with a larger timeout_ms, or set wait_for_reply to false for notifications.`,
        });
      }
      if (result.replyError !== undefined) {
        return text({ delivered: result.delivered, error: result.replyError });
      }
      return text({ delivered: result.delivered, reply: result.reply ?? null });
    },
  );

  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error('[thatopen mcp] ready on stdio');
}

export const mcpCommand = new Command('mcp')
  .description(
    'Start an MCP server (stdio) that lets an LLM drive a running That Open app through the platform channel',
  )
  .action(async () => {
    try {
      await startMcpServer();
    } catch (error) {
      console.error(
        `[thatopen mcp] failed to start: ${error instanceof Error ? error.message : error}`,
      );
      process.exit(1);
    }
  });
