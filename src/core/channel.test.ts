import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  ChannelClient,
  windowTransport,
  type ChannelTransport,
} from './channel';
import { PlatformClient } from './platform-client';

type Posted = Record<string, unknown>;

/**
 * An in-memory shell: `posted` is what the app sent it, `receive` is what the
 * shell relays into the app. Nothing here knows how rooms are named — that is
 * the gateway's business.
 */
function makeShell() {
  const posted: Posted[] = [];
  let deliver: (data: unknown) => void = () => undefined;
  const transport: ChannelTransport = {
    post: (message) => void posted.push(message),
    listen: (handler) => {
      deliver = handler;
      return () => undefined;
    },
  };
  const receive = async (message: Record<string, unknown>) => {
    deliver({ type: 'THATOPEN_CHANNEL_MESSAGE', message });
    await new Promise((resolve) => setTimeout(resolve, 0));
  };
  const published = () =>
    posted
      .filter((m) => m.type === 'APP_CHANNEL_PUBLISH')
      .map((m) => m.message as Record<string, unknown>);
  const controls = () => posted.filter((m) => m.type === 'APP_CHANNEL_CONTROL');
  return { transport, posted, receive, published, controls };
}

const system = (type: string, payload: unknown) => ({
  type: `channel:${type}`,
  payload,
  at: 1,
});

const fromExternal = (
  type: string,
  extra: Record<string, unknown> = {},
) => ({
  type,
  at: 1,
  from: 'ext-1',
  scope: 'external',
  kind: 'mcp',
  ...extra,
});

describe('ChannelClient', () => {
  let shell: ReturnType<typeof makeShell>;
  let channel: ChannelClient;

  beforeEach(() => {
    shell = makeShell();
    channel = new ChannelClient(shell.transport);
  });

  describe('joining', () => {
    it('asks the shell to join the collab room and resolves when confirmed', async () => {
      const collab = channel.collab();
      const joined = collab.join();

      expect(shell.controls()).toEqual([
        { type: 'APP_CHANNEL_CONTROL', action: 'joinCollab' },
      ]);
      expect(collab.joined).toBe(false);

      await shell.receive(system('joined', { scope: 'collab' }));

      await expect(joined).resolves.toBeUndefined();
      expect(collab.joined).toBe(true);
    });

    it('carries the kind when joining an external room', () => {
      void channel.external('mcp').join();
      void channel.external().join();

      expect(shell.controls()).toEqual([
        { type: 'APP_CHANNEL_CONTROL', action: 'joinExternal', kind: 'mcp' },
        { type: 'APP_CHANNEL_CONTROL', action: 'joinExternal', kind: undefined },
      ]);
    });

    it('confirms each external room on its own', async () => {
      const mcp = channel.external('mcp');
      const cli = channel.external('cli');
      void mcp.join();
      void cli.join();

      await shell.receive(system('joined', { scope: 'external', kind: 'mcp' }));

      expect(mcp.joined).toBe(true);
      expect(cli.joined).toBe(false);
    });

    it('does not ask again when already in the room', async () => {
      const collab = channel.collab();
      void collab.join();
      await shell.receive(system('joined', { scope: 'collab' }));
      shell.posted.length = 0;

      await collab.join();

      expect(shell.posted).toEqual([]);
    });

    it('returns the same room instance every time', () => {
      expect(channel.collab()).toBe(channel.collab());
      expect(channel.external('mcp')).toBe(channel.external('mcp'));
      expect(channel.external('mcp')).not.toBe(channel.external('cli'));
      expect(channel.external('mcp')).not.toBe(channel.external());
    });

    it('rejects when the platform reports an error while joining', async () => {
      const collab = channel.collab();
      const rejected = expect(collab.join()).rejects.toThrow(
        'Only a subscribed app can join',
      );

      await shell.receive(system('error', 'Only a subscribed app can join'));

      await rejected;
      expect(collab.joined).toBe(false);
    });

    describe('with no answer', () => {
      beforeEach(() => vi.useFakeTimers());
      afterEach(() => vi.useRealTimers());

      it('rejects after a timeout instead of hanging', async () => {
        const joined = channel.collab().join();
        const assertion = expect(joined).rejects.toThrow(/did not confirm/);

        await vi.advanceTimersByTimeAsync(10_001);

        await assertion;
      });
    });

    it('leaves, clears the peers and keeps the handlers for a later join', async () => {
      const collab = channel.collab<{ ping: number }>();
      const seen: number[] = [];
      collab.on('ping', (n) => seen.push(n));
      void collab.join();
      await shell.receive(system('joined', { scope: 'collab' }));
      await shell.receive(
        system('peers', { scope: 'collab', peers: [{ from: 'a' }] }),
      );

      const left = collab.leave();
      await shell.receive(system('left', { scope: 'collab' }));
      await left;

      expect(collab.joined).toBe(false);
      expect(collab.peers).toEqual([]);
      expect(shell.controls().at(-1)).toMatchObject({ action: 'leaveCollab' });

      await shell.receive(system('joined', { scope: 'collab' }));
      await shell.receive({ type: 'ping', payload: 1, from: 'x', at: 1, scope: 'collab' });
      expect(seen).toEqual([1]);
    });

    it('leaving a room it never joined does nothing', async () => {
      await channel.collab().leave();

      expect(shell.posted).toEqual([]);
    });
  });

  describe('collab room', () => {
    it('passes payload and meta to the listener for its type', async () => {
      const collab = channel.collab<{ cursor: { x: number } }>();
      const got: unknown[] = [];
      collab.on('cursor', (payload, meta) => got.push([payload, meta]));

      await shell.receive({
        type: 'cursor',
        payload: { x: 1 },
        from: 'peer-1',
        at: 42,
        scope: 'collab',
      });

      expect(got).toEqual([
        [{ x: 1 }, { from: 'peer-1', at: 42, requestId: undefined, kind: undefined }],
      ]);
    });

    it('allows several listeners for one event, each removable', async () => {
      const collab = channel.collab<{ ping: undefined }>();
      const a = vi.fn();
      const b = vi.fn();
      collab.on('ping', a);
      const offB = collab.on('ping', b);
      offB();

      await shell.receive({ type: 'ping', from: 'x', at: 1, scope: 'collab' });

      expect(a).toHaveBeenCalledTimes(1);
      expect(b).not.toHaveBeenCalled();
    });

    it('ignores a message that arrived through the external rooms', async () => {
      const collab = channel.collab<{ ping: undefined }>();
      const listener = vi.fn();
      collab.on('ping', listener);

      await shell.receive(fromExternal('ping'));

      expect(listener).not.toHaveBeenCalled();
    });

    it('keeps delivering when one listener throws', async () => {
      const spy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
      const collab = channel.collab<{ ping: undefined }>();
      const second = vi.fn();
      collab.on('ping', () => {
        throw new Error('boom');
      });
      collab.on('ping', second);

      await shell.receive({ type: 'ping', from: 'x', at: 1, scope: 'collab' });

      expect(second).toHaveBeenCalled();
      spy.mockRestore();
    });

    it('sends an event once joined', async () => {
      const collab = channel.collab<{ cursor: { x: number } }>();
      void collab.join();
      await shell.receive(system('joined', { scope: 'collab' }));

      collab.send('cursor', { x: 3 });

      expect(shell.published()).toEqual([{ type: 'cursor', payload: { x: 3 } }]);
    });

    it('sends nothing while not joined', () => {
      channel.collab<{ cursor: { x: number } }>().send('cursor', { x: 3 });

      expect(shell.published()).toEqual([]);
    });

    it('refuses to send a type in the platform namespace', async () => {
      const collab = channel.collab();
      void collab.join();
      await shell.receive(system('joined', { scope: 'collab' }));

      expect(() => collab.send('channel:peer-left', {})).toThrow(/reserved/);
      expect(shell.published()).toEqual([]);
    });
  });

  describe('external room', () => {
    type Commands = {
      'select-by-category': {
        payload: { category: string };
        reply: { count: number };
      };
      'get-models': { payload: undefined; reply: string[] };
      notify: { payload: { text: string } };
    };

    it('answers a request with what the handler returns, keeping the requestId', async () => {
      const mcp = channel.external<Commands>('mcp');
      mcp.on('select-by-category', ({ category }) => ({ count: category.length }));

      await shell.receive(
        fromExternal('select-by-category', {
          requestId: 'r1',
          payload: { category: 'wall' },
        }),
      );

      expect(shell.published()).toEqual([
        { type: 'reply', requestId: 'r1', payload: { count: 4 } },
      ]);
    });

    it('awaits an async handler', async () => {
      const mcp = channel.external<Commands>('mcp');
      mcp.on('get-models', async () => ['a', 'b']);

      await shell.receive(fromExternal('get-models', { requestId: 'r1' }));

      expect(shell.published()[0]).toMatchObject({ payload: ['a', 'b'] });
    });

    it('answers with an error when the handler throws, so the asker does not time out', async () => {
      const mcp = channel.external<Commands>('mcp');
      mcp.on('get-models', () => {
        throw new Error('no models loaded');
      });

      await shell.receive(fromExternal('get-models', { requestId: 'r1' }));

      expect(shell.published()).toEqual([
        { type: 'reply-error', requestId: 'r1', payload: { error: 'no models loaded' } },
      ]);
    });

    it('does not reply to a notification', async () => {
      const mcp = channel.external<Commands>('mcp');
      const handler = vi.fn();
      mcp.on('notify', handler);

      await shell.receive(fromExternal('notify', { payload: { text: 'hi' } }));

      expect(handler).toHaveBeenCalledWith(
        { text: 'hi' },
        expect.objectContaining({ from: 'ext-1', kind: 'mcp' }),
      );
      expect(shell.published()).toEqual([]);
    });

    it('answers a request nobody handles with an error, when this app listens for that sender', async () => {
      channel.external<Commands>('mcp').on('notify', () => undefined);

      await shell.receive(fromExternal('unknown-command', { requestId: 'r1' }));

      expect(shell.published()).toEqual([
        {
          type: 'reply-error',
          requestId: 'r1',
          payload: { error: 'No handler for "unknown-command".' },
        },
      ]);
    });

    it('stays silent about a request when this app has no room for that sender', async () => {
      channel.external<Commands>('cli').on('notify', () => undefined);

      await shell.receive(fromExternal('anything', { requestId: 'r1' }));

      // Something else in the app may still be answering it the old way.
      expect(shell.published()).toEqual([]);
    });

    it('routes by kind: a kind room only hears its own kind', async () => {
      const mcp = channel.external<Commands>('mcp');
      const cli = channel.external<Commands>('cli');
      const onMcp = vi.fn();
      const onCli = vi.fn();
      mcp.on('notify', onMcp);
      cli.on('notify', onCli);

      await shell.receive(fromExternal('notify', { kind: 'cli' }));

      expect(onCli).toHaveBeenCalledTimes(1);
      expect(onMcp).not.toHaveBeenCalled();
    });

    it('the catch-all room hears every kind', async () => {
      const any = channel.external<Commands>();
      const handler = vi.fn();
      any.on('notify', handler);

      await shell.receive(fromExternal('notify', { kind: 'cli' }));
      await shell.receive(fromExternal('notify', { kind: 'revit' }));

      expect(handler).toHaveBeenCalledTimes(2);
    });

    it('answers a request once even when a kind room and the catch-all both handle it', async () => {
      const first = vi.fn(() => ({ count: 1 }));
      const second = vi.fn(() => ({ count: 2 }));
      channel.external<Commands>('mcp').on('select-by-category', first);
      channel.external<Commands>().on('select-by-category', second);

      await shell.receive(
        fromExternal('select-by-category', {
          requestId: 'r1',
          payload: { category: 'x' },
        }),
      );

      /* A second reply with the same id would no longer match a pending
         request at the gateway and would leak into the collab room. */
      expect(shell.published()).toHaveLength(1);
    });

    it('a message without a scope (older gateway) reaches every room with a handler', async () => {
      const mcp = channel.external<Commands>('mcp');
      const handler = vi.fn();
      mcp.on('notify', handler);

      await shell.receive({ type: 'notify', from: 'x', at: 1, payload: { text: 'a' } });

      expect(handler).toHaveBeenCalledTimes(1);
    });

    it('allows one handler per command and removes it on request', () => {
      const mcp = channel.external<Commands>('mcp');
      const off = mcp.on('notify', () => undefined);

      expect(() => mcp.on('notify', () => undefined)).toThrow(/already has a handler/);

      off();
      expect(() => mcp.on('notify', () => undefined)).not.toThrow();
    });

    it('never hands a platform message to a command handler', async () => {
      const mcp = channel.external('mcp');
      const handler = vi.fn();
      mcp.on('channel:peer-left', handler);

      await shell.receive(system('peer-left', { from: 'x', scope: 'external', kind: 'mcp' }));

      expect(handler).not.toHaveBeenCalled();
    });
  });

  describe('presence', () => {
    it('takes the list of peers the platform sends on joining', async () => {
      const collab = channel.collab();
      void collab.join();
      await shell.receive(system('joined', { scope: 'collab' }));

      await shell.receive(
        system('peers', { scope: 'collab', peers: [{ from: 'a' }, { from: 'b' }] }),
      );

      expect(collab.peers).toEqual([{ from: 'a' }, { from: 'b' }]);
    });

    it('adds and removes peers, telling the listeners', async () => {
      const collab = channel.collab();
      void collab.join();
      await shell.receive(system('joined', { scope: 'collab' }));
      const joined = vi.fn();
      const left = vi.fn();
      const changed = vi.fn();
      collab.onPeerJoined(joined);
      collab.onPeerLeft(left);
      collab.onChange(changed);

      await shell.receive(system('peer-joined', { from: 'a', scope: 'collab' }));
      await shell.receive(system('peer-left', { from: 'a', scope: 'collab' }));

      expect(joined).toHaveBeenCalledWith({ from: 'a', kind: undefined });
      expect(left).toHaveBeenCalledWith({ from: 'a', kind: undefined });
      expect(changed).toHaveBeenCalledTimes(2);
      expect(collab.peers).toEqual([]);
    });

    it('does not list the same peer twice', async () => {
      const collab = channel.collab();
      void collab.join();
      await shell.receive(system('joined', { scope: 'collab' }));

      await shell.receive(system('peer-joined', { from: 'a', scope: 'collab' }));
      await shell.receive(system('peer-joined', { from: 'a', scope: 'collab' }));

      expect(collab.peers).toHaveLength(1);
    });

    it('tells the catch-all and the matching kind room about an external peer, and no other', async () => {
      const any = channel.external();
      const mcp = channel.external('mcp');
      const cli = channel.external('cli');
      for (const room of [any, mcp, cli]) void room.join();
      await shell.receive(system('joined', { scope: 'external', kind: undefined }));
      await shell.receive(system('joined', { scope: 'external', kind: 'mcp' }));
      await shell.receive(system('joined', { scope: 'external', kind: 'cli' }));

      await shell.receive(
        system('peer-joined', { from: 'e1', scope: 'external', kind: 'mcp' }),
      );

      expect(any.peers).toEqual([{ from: 'e1', kind: 'mcp' }]);
      expect(mcp.peers).toEqual([{ from: 'e1', kind: 'mcp' }]);
      expect(cli.peers).toEqual([]);
    });

    it('drops a departed external peer from every room that listed it', async () => {
      const any = channel.external();
      const mcp = channel.external('mcp');
      void any.join();
      void mcp.join();
      await shell.receive(system('joined', { scope: 'external', kind: undefined }));
      await shell.receive(system('joined', { scope: 'external', kind: 'mcp' }));
      await shell.receive(system('peer-joined', { from: 'e1', scope: 'external', kind: 'mcp' }));

      await shell.receive(system('peer-left', { from: 'e1', scope: 'external', kind: 'mcp' }));

      expect(any.peers).toEqual([]);
      expect(mcp.peers).toEqual([]);
    });

    it('a listener that throws does not stop the others', async () => {
      const spy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
      const collab = channel.collab();
      void collab.join();
      await shell.receive(system('joined', { scope: 'collab' }));
      const after = vi.fn();
      collab.onChange(() => {
        throw new Error('boom');
      });
      collab.onChange(after);

      await shell.receive(system('peer-joined', { from: 'a', scope: 'collab' }));

      expect(after).toHaveBeenCalled();
      spy.mockRestore();
    });
  });

  describe('malformed traffic', () => {
    it.each([
      ['a string', 'THATOPEN_CHANNEL_MESSAGE'],
      ['null', null],
      ['another type', { type: 'SOMETHING_ELSE', message: { type: 'x' } }],
      ['no message', { type: 'THATOPEN_CHANNEL_MESSAGE' }],
      ['a message with no type', { type: 'THATOPEN_CHANNEL_MESSAGE', message: {} }],
    ])('ignores %s', async (_case, data) => {
      const collab = channel.collab();
      const listener = vi.fn();
      collab.onChange(listener);
      let deliver: (d: unknown) => void = () => undefined;
      const client = new ChannelClient({
        post: () => undefined,
        listen: (h) => {
          deliver = h;
          return () => undefined;
        },
      });
      client.collab().onChange(listener);

      expect(() => deliver(data)).not.toThrow();
      expect(listener).not.toHaveBeenCalled();
    });
  });
});

describe('windowTransport', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('refuses to work outside an iframe', () => {
    expect(() => windowTransport()).toThrow(/only works inside a That Open app/);
  });

  it('refuses when the window is its own parent', () => {
    const self: Record<string, unknown> = {};
    self.parent = self;
    vi.stubGlobal('window', self);

    expect(() => windowTransport()).toThrow(/only works inside/);
  });

  describe('inside an iframe', () => {
    const parent = { postMessage: vi.fn() };
    const listeners = new Set<(event: unknown) => void>();

    beforeEach(() => {
      listeners.clear();
      parent.postMessage.mockClear();
      vi.stubGlobal('window', {
        parent,
        addEventListener: (_: string, l: (e: unknown) => void) => listeners.add(l),
        removeEventListener: (_: string, l: (e: unknown) => void) =>
          listeners.delete(l),
      });
    });

    it('posts to the parent window', () => {
      windowTransport().post({ type: 'x' });

      expect(parent.postMessage).toHaveBeenCalledWith({ type: 'x' }, '*');
    });

    it('accepts messages from the parent only', () => {
      const handler = vi.fn();
      windowTransport().listen(handler);

      listeners.forEach((l) => l({ source: {}, data: 'from another frame' }));
      listeners.forEach((l) => l({ source: parent, data: 'from the shell' }));

      expect(handler).toHaveBeenCalledTimes(1);
      expect(handler).toHaveBeenCalledWith('from the shell');
    });

    it('stops listening when told to', () => {
      const stop = windowTransport().listen(vi.fn());
      expect(listeners.size).toBe(1);

      stop();

      expect(listeners.size).toBe(0);
    });
  });
});

describe('PlatformClient.channel', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('throws a clear error outside the platform iframe', () => {
    const client = new PlatformClient('jwt', 'https://api.example.com');

    expect(() => client.channel).toThrow(/only works inside a That Open app/);
  });

  it('is created once and reused', () => {
    const parent = { postMessage: vi.fn() };
    vi.stubGlobal('window', {
      parent,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    });
    const client = new PlatformClient('jwt', 'https://api.example.com');

    expect(client.channel).toBe(client.channel);
  });
});

/**
 * Compile-time checks. Nothing here runs: it exists so `tsc` fails if the
 * types stop rejecting what they are meant to reject.
 */
export function typeChecks(channel: ChannelClient) {
  type Commands = {
    ask: { payload: { n: number }; reply: { doubled: number } };
    ping: { payload: { at: number } };
  };
  type Events = { cursor: { x: number } };

  const external = channel.external<Commands>('mcp');
  external.on('ask', ({ n }) => ({ doubled: n * 2 }));
  external.on('ping', ({ at }) => void at);
  // @ts-expect-error unknown command name
  external.on('nope', () => undefined);
  // @ts-expect-error the reply must have the declared shape
  external.on('ask', () => ({ doubled: 'two' }));
  // @ts-expect-error the payload is typed
  external.on('ask', ({ missing }) => ({ doubled: missing }));

  const collab = channel.collab<Events>();
  collab.on('cursor', (p) => p.x.toFixed());
  collab.send('cursor', { x: 1 });
  // @ts-expect-error the payload is typed
  collab.send('cursor', { y: 1 });
  // @ts-expect-error unknown event name
  collab.send('nope', {});

  // Untyped use stays open.
  channel.external('cli').on('anything', (p) => p);
  channel.collab().send('anything', 1);
}
