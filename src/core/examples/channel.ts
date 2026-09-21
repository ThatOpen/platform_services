// description: "Platform channel (app-side, runs inside the platform iframe) — a collaboration room with presence, and typed commands from external tools (MCP, CLI, Revit, etc) with automatic replies."
import { PlatformClient } from '../platform-client';

// Unlike the other examples this is not a Node script: `client.channel` only
// exists inside an app running in the platform's iframe, and throws anywhere
// else. Copy `setupChannel` into your app.

// The contract with an external tool, written once. Each command names its
// payload and, if the caller waits for an answer, its reply. Use `type`, and
// list only what the app handles.
type McpCommands = {
  'select-by-category': {
    payload: { category: string };
    reply: { count: number };
  };
  'get-loaded-models': { payload: undefined; reply: { models: string[] } };
};

// What tabs of this app send each other. No replies: these are events.
type CollabEvents = {
  'cursor-position': { userName: string; x: number; y: number; z: number };
};

export async function setupChannel(client: PlatformClient) {
  // Commands from this account's MCP server only. `external()` with no kind
  // hears every kind of external tool (MCP, CLI, Revit plugin, etc...).
  const mcp = client.channel.external<McpCommands>('mcp');

  // What you return is sent back to whoever asked. Throw and it gets an error
  // instead of waiting for a timeout. A command that was sent without waiting
  // for an answer (a notification) has its return value ignored.
  mcp.on('select-by-category', async ({ category }) => {
    const count = await selectByCategory(category);
    return { count };
  });
  mcp.on('get-loaded-models', () => ({ models: listModels() }));

  // Joining is opt-in. Nothing reaches this app until it joins, so wire it to
  // a button, or join at startup if the app should always listen.
  await mcp.join();

  // Collaboration: other users' tabs of this same app, across accounts.
  const collab = client.channel.collab<CollabEvents>();
  collab.on('cursor-position', (cursor, { from }) => moveAvatar(from, cursor));
  // `from` identifies a tab, so a departure removes exactly its avatar.
  collab.onPeerLeft(({ from }) => removeAvatar(from));
  await collab.join();

  // Sending does nothing until the platform has confirmed the join.
  collab.send('cursor-position', { userName: 'Ada', x: 0, y: 0, z: 0 });

  // Being in a room says this tab is listening, not that anyone is there.
  // `peers` is who the platform reports on the other end right now.
  mcp.onChange(() => {
    console.log(`MCP: ${mcp.joined ? 'listening' : 'off'}, ${mcp.peers.length} connected`);
  });

  return { mcp, collab };
}

// Stand-ins for the app's own logic.
declare function selectByCategory(category: string): Promise<number>;
declare function listModels(): string[];
declare function moveAvatar(id: string, cursor: unknown): void;
declare function removeAvatar(id: string): void;
