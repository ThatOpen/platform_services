import {
  describe,
  it,
  expect,
  beforeEach,
  afterEach,
  vi,
  type Mock,
} from 'vitest';
import { PlatformClient } from './platform-client';

const API = 'https://api.example.com';
const JWT = 'test-jwt';

function okResponse(data: unknown): Response {
  return {
    ok: true,
    status: 200,
    statusText: 'OK',
    text: async () => JSON.stringify(data),
    json: async () => data,
  } as unknown as Response;
}

function callUrl(fetchMock: Mock, index = 0): URL {
  return new URL(fetchMock.mock.calls[index][0] as string);
}

function callInit(fetchMock: Mock, index = 0): RequestInit {
  return fetchMock.mock.calls[index][1] as RequestInit;
}

const emptyPage = { items: [], nextCursor: null };

describe('PlatformClient — notifications', () => {
  let fetchMock: Mock;
  let client: PlatformClient;

  beforeEach(() => {
    fetchMock = vi.fn();
    globalThis.fetch = fetchMock as unknown as typeof fetch;
    client = new PlatformClient(JWT, API);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('getNotifications', () => {
    it('reads the account notifications with no query when unpaged', async () => {
      fetchMock.mockResolvedValue(okResponse(emptyPage));

      await client.getNotifications();

      const url = callUrl(fetchMock);
      expect(url.pathname).toContain('/notifications');
      expect(url.searchParams.get('cursor')).toBeNull();
      expect(url.searchParams.get('limit')).toBeNull();
    });

    it('passes cursor and limit through', async () => {
      fetchMock.mockResolvedValue(okResponse(emptyPage));

      await client.getNotifications({ cursor: 'abc_123', limit: 50 });

      const url = callUrl(fetchMock);
      expect(url.searchParams.get('cursor')).toBe('abc_123');
      expect(url.searchParams.get('limit')).toBe('50');
    });

    // The cursor is opaque and round-trips verbatim; anything that mangles it
    // silently breaks pagination rather than erroring.
    it('does not mangle a cursor containing an ISO timestamp', async () => {
      fetchMock.mockResolvedValue(okResponse(emptyPage));
      const cursor = '2026-08-12T09:30:00.000Z_6a7c95b780c5fd7e84758c32';

      await client.getNotifications({ cursor });

      expect(callUrl(fetchMock).searchParams.get('cursor')).toBe(cursor);
    });

    it('returns the page as sent, ids and timestamps as strings', async () => {
      const page = {
        items: [
          {
            _id: '6a7c95b780c5fd7e84758c32',
            accountId: '6a3bb8b0f32c03c0f86897f2',
            type: 'automation.run.finished',
            category: 'automation',
            title: 'Nightly report failed',
            body: 'IFC Converter ended with ERROR.',
            link: '/dashboard/projects/p1/automation-runs',
            muted: false,
            readAt: null,
            createdAt: '2026-08-12T09:30:00.000Z',
          },
        ],
        nextCursor: null,
      };
      fetchMock.mockResolvedValue(okResponse(page));

      const result = await client.getNotifications();

      expect(result).toEqual(page);
      expect(typeof result.items[0]._id).toBe('string');
      expect(typeof result.items[0].createdAt).toBe('string');
    });
  });

  it('unwraps the unread count to a number', async () => {
    fetchMock.mockResolvedValue(okResponse({ count: 7 }));

    await expect(client.getUnreadNotificationCount()).resolves.toBe(7);
    expect(callUrl(fetchMock).pathname).toContain('/notifications/unread-count');
  });

  it('marks specific notifications read as a JSON body', async () => {
    fetchMock.mockResolvedValue(okResponse({ updated: 2 }));

    const result = await client.markNotificationsRead(['id-1', 'id-2']);

    const init = callInit(fetchMock);
    expect(init.method).toBe('POST');
    expect(JSON.parse(init.body as string)).toEqual({ ids: ['id-1', 'id-2'] });
    expect(result.updated).toBe(2);
  });

  it('marks all read without a body', async () => {
    fetchMock.mockResolvedValue(okResponse({ updated: 9 }));

    await client.markAllNotificationsRead();

    expect(callUrl(fetchMock).pathname).toContain(
      '/notifications/mark-all-read',
    );
    expect(callInit(fetchMock).method).toBe('POST');
  });

  it('lists subscriptions', async () => {
    fetchMock.mockResolvedValue(okResponse([]));

    await expect(client.getNotificationSubscriptions()).resolves.toEqual([]);
    expect(callUrl(fetchMock).pathname).toContain('/notifications/subscriptions');
  });

  it('unsubscribes by hook id', async () => {
    fetchMock.mockResolvedValue(okResponse({ unsubscribed: true }));

    const result = await client.unsubscribeFromAutomation('hook-1');

    expect(callInit(fetchMock).method).toBe('DELETE');
    expect(callUrl(fetchMock).pathname).toContain(
      '/notifications/subscriptions/hook-1',
    );
    expect(result.unsubscribed).toBe(true);
  });

  it('sends the bearer token on notification routes', async () => {
    fetchMock.mockResolvedValue(okResponse(emptyPage));

    await client.getNotifications();

    const headers = callInit(fetchMock).headers as Record<string, string>;
    expect(headers.Authorization).toBe(`Bearer ${JWT}`);
  });

  describe('subscribing to an automation', () => {
    const PROJECT = 'proj-1';
    const HOOK = 'hook-1';

    it('subscribes through the project route', async () => {
      fetchMock.mockResolvedValue(okResponse({ subscribed: true }));

      await client.subscribeToAutomation(PROJECT, HOOK, {
        filter: 'failures',
        channels: { email: true },
      });

      const init = callInit(fetchMock);
      expect(init.method).toBe('POST');
      expect(callUrl(fetchMock).pathname).toContain(
        `/project/${PROJECT}/events/hooks/${HOOK}/subscription`,
      );
      expect(JSON.parse(init.body as string)).toEqual({
        filter: 'failures',
        channels: { email: true },
      });
    });

    it('sends an empty body when no options are given', async () => {
      fetchMock.mockResolvedValue(okResponse({ subscribed: true }));

      await client.subscribeToAutomation(PROJECT, HOOK);

      expect(JSON.parse(callInit(fetchMock).body as string)).toEqual({});
    });

    // PATCH is a merge server-side, so sending channels alone must not carry
    // a filter along with it and reset one that was already set.
    it('patches only what it is given', async () => {
      fetchMock.mockResolvedValue(okResponse({ updated: true }));

      await client.updateAutomationSubscription(PROJECT, HOOK, {
        channels: { email: false },
      });

      const init = callInit(fetchMock);
      expect(init.method).toBe('PATCH');
      expect(JSON.parse(init.body as string)).toEqual({
        channels: { email: false },
      });
    });
  });
});