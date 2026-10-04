import { describe, it, expect, beforeEach, vi } from 'vitest';

const handlers = new Map<string, (payload: unknown) => void>();
const disconnect = vi.fn();
const ioMock = vi.fn(() => ({
  on: (event: string, handler: (payload: unknown) => void) => {
    handlers.set(event, handler);
  },
  disconnect,
}));

vi.mock('socket.io-client', () => ({ io: (...args: unknown[]) => ioMock(...(args as [])) }));

const { PlatformClient } = await import('./platform-client');

const API = 'https://api.example.com';

describe('PlatformClient — live notifications', () => {
  let client: InstanceType<typeof PlatformClient>;

  beforeEach(() => {
    handlers.clear();
    ioMock.mockClear();
    disconnect.mockClear();
    client = new PlatformClient('jwt-1', API);
  });

  it('connects to the notifications namespace with the token in the auth payload', async () => {
    await client.onNotification(() => {});

    const [url, opts] = ioMock.mock.calls[0] as unknown as [
      string,
      { auth?: { accessToken?: string } },
    ];
    expect(url).toContain('/notifications');
    // The URL must NOT carry the credential: a failing handshake prints it
    // whole in the browser console. The auth payload travels in the body.
    expect(url).not.toContain('accessToken');
    expect(opts.auth?.accessToken).toBe('jwt-1');
    // No /api on a socket URL; that prefix is for REST only.
    expect(url).not.toContain('/api/');
  });

  // A provider-backed client must open the socket with a current token, not
  // the one it happened to be constructed with.
  it('resolves the token per connection when a provider is used', async () => {
    const provider = vi.fn().mockResolvedValue('fresh-token');
    const providerClient = new PlatformClient(provider, API);

    await providerClient.onNotification(() => {});

    expect(provider).toHaveBeenCalled();
    const opts = (
      ioMock.mock.calls[0] as unknown as [string, { auth?: { accessToken?: string } }]
    )[1];
    expect(opts.auth?.accessToken).toBe('fresh-token');
  });

  it('maps each server event onto one callback shape', async () => {
    const seen: unknown[] = [];
    await client.onNotification((event) => seen.push(event));

    handlers.get('notification.created')?.({ id: 'n1' });
    handlers.get('notification.read')?.({ id: 'n2' });
    handlers.get('notifications.allRead')?.({ batch: 42 });

    expect(seen).toEqual([
      { type: 'created', id: 'n1' },
      { type: 'read', id: 'n2' },
      { type: 'allRead', batch: 42 },
    ]);
  });

  it('returns a disconnect function', async () => {
    const stop = await client.onNotification(() => {});

    expect(disconnect).not.toHaveBeenCalled();
    stop();
    expect(disconnect).toHaveBeenCalledTimes(1);
  });
});
