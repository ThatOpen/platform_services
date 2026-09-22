/**
 * The platform channel, pre-wired: typed commands that an external tool (an
 * MCP server, a CLI, a desktop LLM, a plugin) can send this app while it runs,
 * and a collaboration room where every open tab of this app hears the others.
 *
 * The app never opens a socket. The platform shell owns the one connection and
 * relays over `postMessage`; `client.channel` is the typed layer on top. That
 * also means this only works inside the platform iframe — `setupChannel` is
 * called from a try/catch in `main.ts` so the app still boots anywhere else.
 *
 * To extend: add a command to {@link AppCommands} and handle it below. What a
 * handler returns is sent back to whoever asked; throw and they get the error.
 * Full walkthrough: `node_modules/@thatopen/services/src/core/examples/channel.ts`.
 */
import * as OBC from "@thatopen/components";
import { PlatformClient } from "@thatopen/services";

/**
 * The contract with external tools. Each command names its payload and, when
 * the caller waits for an answer, its reply. A command without `reply` is a
 * notification. This type is the whole API an MCP server sees: keep it honest.
 */
export type AppCommands = {
  /** Liveness check — answer whoever is probing that this app is listening. */
  ping: { payload: { echo?: string } | undefined; reply: { pong: true; echo?: string } };
  /** The ids of the models currently loaded in the viewer. */
  "get-loaded-models": { payload: undefined; reply: { models: string[] } };
};

/** Events tabs of this app send each other. Events, so no replies. */
export type AppCollabEvents = {
  /** Sent once on join, so other tabs can log or greet. Replace with your own. */
  hello: { at: number };
};

/**
 * Wires both rooms and joins them at boot. Joining is what makes the app
 * reachable — until then, nothing arrives. If you'd rather listen only when
 * the user opts in, move the `join()` calls behind a button.
 */
export function setupChannel(
  client: PlatformClient,
  components: OBC.Components,
) {
  // Commands from every kind of external tool of this account. Narrow with
  // `client.channel.external<AppCommands>("mcp")` to hear one kind only.
  const external = client.channel.external<AppCommands>();

  external.on("ping", (payload) => ({ pong: true as const, echo: payload?.echo }));

  external.on("get-loaded-models", () => {
    const fragments = components.get(OBC.FragmentsManager);
    return { models: [...fragments.list.keys()] };
  });

  // Collaboration: other users' tabs of this same app, across accounts.
  const collab = client.channel.collab<AppCollabEvents>();
  collab.on("hello", (event, { from }) => {
    console.log(`[channel] tab ${from} joined the collaboration`, event);
  });
  collab.onPeerLeft(({ from }) => {
    console.log(`[channel] tab ${from} left the collaboration`);
  });

  // Fire-and-forget joins: the app is usable with or without the channel, so
  // a failure is a warning, never a boot error.
  external
    .join()
    .catch((error) => console.warn("[channel] external join failed:", error));
  collab
    .join()
    .then(() => collab.send("hello", { at: Date.now() }))
    .catch((error) => console.warn("[channel] collab join failed:", error));

  return { external, collab };
}
