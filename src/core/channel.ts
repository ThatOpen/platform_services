/**
 * The app side of the platform channel: rooms an app can join, and the
 * messages it exchanges through them.
 *
 * The app never holds a socket. The platform shell, outside the iframe, owns
 * the connection and relays over `postMessage`; this module is the typed
 * layer on top of that contract, reached as {@link PlatformClient.channel}.
 */

/** What a command looks like: the payload it carries and the reply it expects. */
export interface ChannelCommandShape {
  payload?: unknown;
  reply?: unknown;
}

/**
 * The default command map, when none is given: every command name is allowed
 * and nothing is typed. Give `external<Commands>()` your own map to get
 * payloads and replies checked at compile time.
 */
export type AnyChannelCommands = Record<string, ChannelCommandShape>;

/** The default event map for {@link CollabRoom}: any name, any payload. */
export type AnyChannelEvents = Record<string, unknown>;

type PayloadOf<T> = 'payload' extends keyof T ? T['payload'] : undefined;
// A command that declares no `reply` is a notification: nothing to return.
type ReplyOf<T> = 'reply' extends keyof T ? T['reply'] : void;

/** Someone else on the other end of a room. `kind` is set for external channels. */
export interface ChannelPeer {
  from: string;
  kind?: string;
}

/** Who sent a message, and when. */
export interface ChannelMessageMeta {
  /** The sender's connection id, stamped by the platform. */
  from: string;
  at: number;
  /** Present when the sender expects an answer. */
  requestId?: string;
  /** For an external sender that declared one: `'mcp'`, `'cli'`, `'revit'`… */
  kind?: string;
}

/** How the client talks to the shell. Replaceable, so it can be tested. */
export interface ChannelTransport {
  post(message: Record<string, unknown>): void;
  listen(handler: (data: unknown) => void): () => void;
}

/**
 * Talks to the platform shell through `window.parent`. Only messages whose
 * `source` is the parent window are accepted — the same check the shell makes
 * in the other direction — so another frame on the page cannot inject messages
 * into the app.
 */
export function windowTransport(): ChannelTransport {
  if (typeof window === 'undefined' || window.parent === window) {
    throw new Error(
      'client.channel only works inside a That Open app, which runs in an iframe of the platform.',
    );
  }
  return {
    post: (message) => window.parent.postMessage(message, '*'),
    listen: (handler) => {
      const listener = (event: MessageEvent) => {
        if (event.source === window.parent) handler(event.data);
      };
      window.addEventListener('message', listener);
      return () => window.removeEventListener('message', listener);
    },
  };
}

/** Reserved for messages the platform itself sends. */
const SYSTEM_PREFIX = 'channel:';
const JOIN_TIMEOUT_MS = 10_000;

/** A message as the platform delivers it to the app. */
export interface ChannelIncomingMessage {
  type: string;
  requestId?: string;
  payload?: unknown;
  at: number;
  from: string;
  scope?: 'collab' | 'external';
  kind?: string;
}

/** What a room did with a message. */
export type ChannelOutcome =
  | { handled: false }
  | { handled: true; value?: unknown; error?: string };

function guard(fn: () => void) {
  try {
    fn();
  } catch (error) {
    console.error('[channel] a listener threw:', error);
  }
}

interface Pending {
  want: 'joined' | 'left';
  resolve: () => void;
  reject: (error: Error) => void;
  timer: ReturnType<typeof setTimeout>;
}

/** What every room shares: membership, peers and presence. */
export abstract class ChannelRoom {
  #joined = false;
  #peers: ChannelPeer[] = [];
  #pending: Pending[] = [];
  readonly #onChange = new Set<() => void>();
  readonly #onPeerJoined = new Set<(peer: ChannelPeer) => void>();
  readonly #onPeerLeft = new Set<(peer: ChannelPeer) => void>();

  constructor(
    private readonly transport: ChannelTransport,
    private readonly controls: {
      join: Record<string, unknown>;
      leave: Record<string, unknown>;
    },
  ) {}

  /** Whether the platform has confirmed this tab is in the room. */
  get joined(): boolean {
    return this.#joined;
  }

  /** Who else is in the room right now, as the platform last reported. */
  get peers(): readonly ChannelPeer[] {
    return this.#peers;
  }

  /**
   * Enters the room. Resolves when the platform confirms; rejects if it
   * refuses or does not answer in time. Joining twice is harmless.
   */
  join(): Promise<void> {
    if (this.#joined) return Promise.resolve();
    return this.#request('joined', this.controls.join);
  }

  /** Leaves the room. Handlers stay registered, so `join()` resumes them. */
  leave(): Promise<void> {
    if (!this.#joined && !this.#pending.some((p) => p.want === 'joined')) {
      return Promise.resolve();
    }
    return this.#request('left', this.controls.leave);
  }

  /** Fires when `joined` or `peers` changes. Returns a function that stops it. */
  onChange(listener: () => void): () => void {
    this.#onChange.add(listener);
    return () => void this.#onChange.delete(listener);
  }

  onPeerJoined(listener: (peer: ChannelPeer) => void): () => void {
    this.#onPeerJoined.add(listener);
    return () => void this.#onPeerJoined.delete(listener);
  }

  onPeerLeft(listener: (peer: ChannelPeer) => void): () => void {
    this.#onPeerLeft.add(listener);
    return () => void this.#onPeerLeft.delete(listener);
  }

  /** @internal Does a message arriving with this scope/kind belong to this room? */
  abstract accepts(scope: string | undefined, kind: string | undefined): boolean;

  /** @internal */
  abstract handle(message: ChannelIncomingMessage): Promise<ChannelOutcome>;

  /** @internal */
  applyJoined() {
    this.#joined = true;
    this.#settle('joined');
    this.#changed();
  }

  /** @internal */
  applyLeft() {
    this.#joined = false;
    this.#peers = [];
    this.#settle('left');
    this.#changed();
  }

  /** @internal */
  applyPeers(peers: ChannelPeer[]) {
    this.#peers = peers;
    this.#changed();
  }

  /** @internal */
  applyPeerJoined(peer: ChannelPeer) {
    if (!this.#joined || this.#peers.some((p) => p.from === peer.from)) return;
    this.#peers = [...this.#peers, peer];
    this.#onPeerJoined.forEach((l) => guard(() => l(peer)));
    this.#changed();
  }

  /** @internal */
  applyPeerLeft(from: string) {
    const peer = this.#peers.find((p) => p.from === from);
    if (!peer) return;
    this.#peers = this.#peers.filter((p) => p.from !== from);
    this.#onPeerLeft.forEach((l) => guard(() => l(peer)));
    this.#changed();
  }

  /** @internal */
  failPending(error: Error): boolean {
    const pending = this.#pending;
    this.#pending = [];
    pending.forEach((p) => {
      clearTimeout(p.timer);
      p.reject(error);
    });
    return pending.length > 0;
  }

  protected post(message: Record<string, unknown>) {
    this.transport.post(message);
  }

  #request(want: 'joined' | 'left', control: Record<string, unknown>) {
    return new Promise<void>((resolve, reject) => {
      const entry: Pending = {
        want,
        resolve,
        reject,
        timer: setTimeout(() => {
          this.#pending = this.#pending.filter((p) => p !== entry);
          reject(
            new Error(
              `The platform did not confirm ${want === 'joined' ? 'joining' : 'leaving'} in time.`,
            ),
          );
        }, JOIN_TIMEOUT_MS),
      };
      this.#pending.push(entry);
      this.transport.post({ type: 'APP_CHANNEL_CONTROL', ...control });
    });
  }

  #settle(want: 'joined' | 'left') {
    const done = this.#pending.filter((p) => p.want === want);
    this.#pending = this.#pending.filter((p) => p.want !== want);
    done.forEach((p) => {
      clearTimeout(p.timer);
      p.resolve();
    });
  }

  #changed() {
    this.#onChange.forEach((l) => guard(l));
  }
}

/**
 * The collaboration room: every user's tab of this app that joined it, across
 * accounts. Messages here are events — nobody replies.
 *
 * `E` maps each event name to its payload, so `send` and `on` are checked.
 */
export class CollabRoom<E extends object = AnyChannelEvents> extends ChannelRoom {
  readonly #listeners = new Map<
    string,
    Set<(payload: never, meta: ChannelMessageMeta) => void>
  >();

  /** @internal Use `client.channel.collab()`. */
  constructor(transport: ChannelTransport) {
    super(transport, {
      join: { action: 'joinCollab' },
      leave: { action: 'leaveCollab' },
    });
  }

  /**
   * Listens for an event other tabs send. Any number of listeners per event.
   * @returns a function that removes the listener.
   */
  on<K extends keyof E & string>(
    type: K,
    listener: (payload: E[K], meta: ChannelMessageMeta) => void,
  ): () => void {
    const set = this.#listeners.get(type) ?? new Set();
    set.add(listener as never);
    this.#listeners.set(type, set);
    return () => void set.delete(listener as never);
  }

  /**
   * Sends an event to the other tabs in the room. Does nothing while this tab
   * is not in it, matching what the platform does with a message from outside.
   */
  send<K extends keyof E & string>(type: K, payload: E[K]): void {
    if (type.startsWith(SYSTEM_PREFIX)) {
      throw new Error(`Message types starting with '${SYSTEM_PREFIX}' are reserved.`);
    }
    if (!this.joined) return;
    this.post({ type: 'APP_CHANNEL_PUBLISH', message: { type, payload } });
  }

  accepts(scope: string | undefined): boolean {
    return scope === undefined || scope === 'collab';
  }

  async handle(message: ChannelIncomingMessage): Promise<ChannelOutcome> {
    const listeners = this.#listeners.get(message.type);
    if (!listeners?.size) return { handled: false };
    const meta = metaOf(message);
    listeners.forEach((l) => guard(() => l(message.payload as never, meta)));
    return { handled: true };
  }
}

/**
 * Commands from this account's external tools — a CLI, an MCP server, a Revit
 * plugin — of one `kind`, or of every kind when none is given.
 *
 * `C` maps each command name to `{ payload, reply }`, so a handler's argument
 * and return value are checked. A command without `reply` is a notification.
 */
export class ExternalRoom<
  C extends { [K in keyof C]: ChannelCommandShape } = AnyChannelCommands,
> extends ChannelRoom {
  readonly #handlers = new Map<
    string,
    (payload: never, meta: ChannelMessageMeta) => unknown
  >();

  /** @internal Use `client.channel.external(kind)`. */
  constructor(
    transport: ChannelTransport,
    readonly kind?: string,
  ) {
    super(transport, {
      join: { action: 'joinExternal', kind },
      leave: { action: 'leaveExternal', kind },
    });
  }

  /**
   * Handles a command. When the sender asked for an answer, what you return
   * is sent back to it; if you throw, it gets an error instead of waiting for
   * a timeout. When it did not ask (a notification), the return value is
   * ignored.
   *
   * One handler per command: a second one for the same name throws, since two
   * would both try to answer.
   * @returns a function that removes the handler.
   */
  on<K extends keyof C & string>(
    type: K,
    handler: (
      payload: PayloadOf<C[K]>,
      meta: ChannelMessageMeta,
    ) => ReplyOf<C[K]> | Promise<ReplyOf<C[K]>>,
  ): () => void {
    if (this.#handlers.has(type)) {
      throw new Error(
        `"${type}" already has a handler in this room. Remove it first.`,
      );
    }
    this.#handlers.set(type, handler as never);
    return () => void this.#handlers.delete(type);
  }

  accepts(scope: string | undefined, kind: string | undefined): boolean {
    if (scope !== undefined && scope !== 'external') return false;
    return this.kind === undefined || scope === undefined || this.kind === kind;
  }

  /** @internal Whether this room has any handler at all. */
  get hasHandlers(): boolean {
    return this.#handlers.size > 0;
  }

  async handle(message: ChannelIncomingMessage): Promise<ChannelOutcome> {
    const handler = this.#handlers.get(message.type);
    if (!handler) return { handled: false };
    try {
      const value = await handler(message.payload as never, metaOf(message));
      return { handled: true, value };
    } catch (error) {
      return {
        handled: true,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }
}

function metaOf(message: ChannelIncomingMessage): ChannelMessageMeta {
  return {
    from: message.from,
    at: message.at,
    requestId: message.requestId,
    kind: message.kind,
  };
}

function readMessage(data: unknown): ChannelIncomingMessage | null {
  const envelope = data as { type?: unknown; message?: unknown } | null;
  if (envelope?.type !== 'THATOPEN_CHANNEL_MESSAGE') return null;
  const message = envelope.message as Partial<ChannelIncomingMessage> | undefined;
  if (!message || typeof message.type !== 'string') return null;
  return {
    type: message.type,
    requestId:
      typeof message.requestId === 'string' ? message.requestId : undefined,
    payload: message.payload,
    at: typeof message.at === 'number' ? message.at : Date.now(),
    from: typeof message.from === 'string' ? message.from : '',
    scope:
      message.scope === 'collab' || message.scope === 'external'
        ? message.scope
        : undefined,
    kind: typeof message.kind === 'string' ? message.kind : undefined,
  };
}

/**
 * Typed access to the platform channel from inside an app: a collaboration
 * room shared with other users, and rooms for commands from external tools.
 * Reach it as `client.channel`.
 *
 * @example
 * ```ts
 * type McpCommands = {
 *   'select-by-category': { payload: { category: string }; reply: { count: number } };
 * };
 *
 * const mcp = client.channel.external<McpCommands>('mcp');
 * mcp.on('select-by-category', async ({ category }) => ({
 *   count: await selectByCategory(category),
 * }));
 * await mcp.join();
 * ```
 */
export class ChannelClient {
  readonly #transport: ChannelTransport;
  readonly #stop: () => void;
  #collab?: CollabRoom<never>;
  readonly #externals = new Map<string, ExternalRoom<never>>();
  readonly #answered = new Set<string>();

  constructor(transport: ChannelTransport) {
    this.#transport = transport;
    this.#stop = transport.listen((data) => void this.#receive(data));
  }

  /** The collaboration room for this app. Always the same instance. */
  collab<E extends object = AnyChannelEvents>(): CollabRoom<E> {
    this.#collab ??= new CollabRoom<never>(this.#transport);
    return this.#collab as unknown as CollabRoom<E>;
  }

  /**
   * The room for commands from this account's external tools of one `kind`
   * (`'mcp'`, `'cli'`, `'revit'`…), or from any of them when `kind` is omitted.
   * Always the same instance for the same kind.
   */
  external<C extends { [K in keyof C]: ChannelCommandShape } = AnyChannelCommands>(
    kind?: string,
  ): ExternalRoom<C> {
    const key = kind ?? '';
    let room = this.#externals.get(key);
    if (!room) {
      room = new ExternalRoom<never>(this.#transport, kind);
      this.#externals.set(key, room);
    }
    return room as unknown as ExternalRoom<C>;
  }

  /** Stops listening. For tests and teardown; an app normally never calls it. */
  dispose() {
    this.#stop();
  }

  #rooms(): ChannelRoom[] {
    return [...(this.#collab ? [this.#collab] : []), ...this.#externals.values()];
  }

  #exact(scope: unknown, kind: unknown): ChannelRoom | undefined {
    if (scope === 'collab') return this.#collab;
    if (scope === 'external') {
      return this.#externals.get(typeof kind === 'string' ? kind : '');
    }
    return undefined;
  }

  async #receive(data: unknown) {
    const message = readMessage(data);
    if (!message) return;
    if (message.type.startsWith(SYSTEM_PREFIX)) {
      this.#system(message);
      return;
    }
    await this.#deliver(message);
  }

  #system(message: ChannelIncomingMessage) {
    const info = (message.payload ?? {}) as {
      scope?: string;
      kind?: string;
      from?: string;
      peers?: ChannelPeer[];
    };

    switch (message.type) {
      case 'channel:joined':
        this.#exact(info.scope, info.kind)?.applyJoined();
        break;
      case 'channel:left':
        this.#exact(info.scope, info.kind)?.applyLeft();
        break;
      case 'channel:peers':
        this.#exact(info.scope, info.kind)?.applyPeers(info.peers ?? []);
        break;
      case 'channel:peer-joined':
      case 'channel:peer-left': {
        if (!info.from) break;
        // An external peer of one kind is seen by the catch-all room and by
        // the room for that kind alike.
        const rooms: (ChannelRoom | undefined)[] =
          info.scope === 'collab'
            ? [this.#collab]
            : [...this.#externals.values()].filter((r) =>
                r.accepts('external', info.kind),
              );
        for (const room of rooms) {
          if (message.type === 'channel:peer-joined') {
            room?.applyPeerJoined({ from: info.from, kind: info.kind });
          } else {
            room?.applyPeerLeft(info.from);
          }
        }
        break;
      }
      case 'channel:error': {
        const error = new Error(String(message.payload));
        // Errors are not tied to a request, so anything waiting to join or
        // leave is told; with nothing waiting, the error would vanish.
        const told = this.#rooms().map((r) => r.failPending(error));
        if (!told.some(Boolean)) console.error('[channel] error:', message.payload);
        break;
      }
    }
  }

  async #deliver(message: ChannelIncomingMessage) {
    // Without `scope` (a gateway that predates it) there is no telling which
    // room a message came through, so it goes to every room that can take it.
    const rooms = this.#rooms().filter((r) => r.accepts(message.scope, message.kind));
    let answered = false;

    for (const room of rooms) {
      const outcome = await room.handle(message);
      if (!outcome.handled) continue;
      answered = true;
      if (message.requestId) this.#reply(message.requestId, outcome);
    }

    // Someone asked, this app listens for that kind of sender, and nothing
    // handles the command: say so, rather than let the asker time out.
    const asked =
      message.requestId && message.scope === 'external' && rooms.length > 0;
    if (asked && !answered) {
      this.#reply(message.requestId!, {
        handled: true,
        error: `No handler for "${message.type}".`,
      });
    }
  }

  #reply(requestId: string, outcome: Extract<ChannelOutcome, { handled: true }>) {
    // Two rooms can both handle one command (the catch-all and its kind).
    // Only the first answer counts: a second reply with the same id would no
    // longer match a pending request and would leak into the collab room.
    if (this.#answered.has(requestId)) return;
    this.#answered.add(requestId);
    if (this.#answered.size > 500) {
      this.#answered.delete(this.#answered.values().next().value as string);
    }
    this.#transport.post({
      type: 'APP_CHANNEL_PUBLISH',
      message: {
        type: outcome.error === undefined ? 'reply' : 'reply-error',
        requestId,
        payload:
          outcome.error === undefined ? outcome.value : { error: outcome.error },
      },
    });
  }
}
