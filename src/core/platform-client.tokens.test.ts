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

// API tokens limited to projects, revocable one by one (APOGEA 23-10, §2.5).
const API = 'https://api.example.com';

function okResponse(data: unknown, text = JSON.stringify(data)): Response {
  return {
    ok: true,
    status: 200,
    statusText: 'OK',
    text: async () => text,
    json: async () => data,
    blob: async () => new Blob([text]),
  } as unknown as Response;
}

describe('PlatformClient — API tokens', () => {
  let fetchMock: Mock;

  beforeEach(() => {
    fetchMock = vi.fn();
    globalThis.fetch = fetchMock as unknown as typeof fetch;
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  const call = (k = 0) => {
    const [url, init] = fetchMock.mock.calls[k] as [string, RequestInit];
    return {
      method: init.method,
      path: new URL(url).pathname,
      body: init.body ? JSON.parse(String(init.body)) : undefined,
    };
  };

  it('creates a token limited to some projects', async () => {
    fetchMock.mockResolvedValue(okResponse({ _id: 't1' }));
    await new PlatformClient('jwt', API).createToken({
      name: 'BI',
      permissions: ['STORAGE:READ'],
      projectIds: ['p1', 'p2'],
    });
    expect(call()).toEqual({
      method: 'POST',
      path: '/api/tokens',
      body: {
        name: 'BI',
        permissions: ['STORAGE:READ'],
        urlRestrictions: [],
        projectIds: ['p1', 'p2'],
      },
    });
  });

  it('changes, lists and revokes tokens', async () => {
    fetchMock.mockResolvedValue(okResponse([]));
    const client = new PlatformClient('jwt', API);
    await client.updateToken('t1', { projectIds: [] });
    await client.listTokens();
    await client.revokeToken('t1');
    expect(call(0)).toEqual({
      method: 'PUT',
      path: '/api/tokens/t1',
      body: { projectIds: [] },
    });
    expect(call(1)).toMatchObject({ method: 'GET', path: '/api/tokens' });
    expect(call(2)).toMatchObject({ method: 'DELETE', path: '/api/tokens/t1' });
  });

  it('reads a token secret, which the route answers as bare text', async () => {
    fetchMock.mockResolvedValue(okResponse(undefined, 'secret-abc'));
    const secret = await new PlatformClient('jwt', API).getTokenSecret('t1');
    expect(secret).toBe('secret-abc');
    expect(call()).toMatchObject({
      method: 'GET',
      path: '/api/tokens/t1/token',
    });
  });
});
