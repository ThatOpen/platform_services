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

function parseUrl(url: string): { pathname: string; params: URLSearchParams } {
  const u = new URL(url);
  return { pathname: u.pathname, params: u.searchParams };
}

describe('PlatformClient — JWT-focused client', () => {
  let fetchMock: Mock;

  beforeEach(() => {
    fetchMock = vi.fn();
    globalThis.fetch = fetchMock as unknown as typeof fetch;
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('auth mode — always bearer', () => {
    it('sends Authorization: Bearer and omits accessToken query param', async () => {
      fetchMock.mockResolvedValue(okResponse([]));
      const client = new PlatformClient(JWT, API);
      await client.listFiles();
      const call = fetchMock.mock.calls[0];
      const url = call[0] as string;
      const init = call[1] as RequestInit;
      const { params } = parseUrl(url);
      expect(params.get('accessToken')).toBeNull();
      expect((init.headers as Record<string, string>).Authorization).toBe(
        `Bearer ${JWT}`,
      );
    });
  });

  describe('project-scoped listings', () => {
    it('listFiles({ projectId }) hits /item with projectId query', async () => {
      fetchMock.mockResolvedValue(okResponse([]));
      const client = new PlatformClient(JWT, API);
      await client.listFiles({ projectId: 'proj-1', archived: true });
      const { pathname, params } = parseUrl(
        fetchMock.mock.calls[0][0] as string,
      );
      expect(pathname).toBe('/api/item');
      expect(params.get('itemType')).toBe('FILE');
      expect(params.get('projectId')).toBe('proj-1');
      expect(params.get('archived')).toBe('true');
    });

    it('listFolders({ projectId }) hits /item/folder with projectId query', async () => {
      fetchMock.mockResolvedValue(okResponse([]));
      const client = new PlatformClient(JWT, API);
      await client.listFolders({ projectId: 'proj-1' });
      const { pathname, params } = parseUrl(
        fetchMock.mock.calls[0][0] as string,
      );
      expect(pathname).toBe('/api/item/folder');
      expect(params.get('projectId')).toBe('proj-1');
    });

    it('listApps({ projectId }) hits /item?itemType=APP with projectId', async () => {
      fetchMock.mockResolvedValue(okResponse([]));
      const client = new PlatformClient(JWT, API);
      await client.listApps({ projectId: 'proj-1' });
      const { pathname, params } = parseUrl(
        fetchMock.mock.calls[0][0] as string,
      );
      expect(pathname).toBe('/api/item');
      expect(params.get('itemType')).toBe('APP');
      expect(params.get('projectId')).toBe('proj-1');
    });

    it('listComponents({ projectId }) hits /item?itemType=TOOL with projectId', async () => {
      fetchMock.mockResolvedValue(okResponse([]));
      const client = new PlatformClient(JWT, API);
      await client.listComponents({ projectId: 'proj-1' });
      const { pathname, params } = parseUrl(
        fetchMock.mock.calls[0][0] as string,
      );
      expect(pathname).toBe('/api/item');
      expect(params.get('itemType')).toBe('TOOL');
      expect(params.get('projectId')).toBe('proj-1');
    });
  });

  describe('permissions', () => {
    it('checkPermission returns { hasPermission, scope }', async () => {
      fetchMock.mockResolvedValue(
        okResponse({ hasPermission: true, scope: 'project' }),
      );
      const client = new PlatformClient(JWT, API);
      const result = await client.checkPermission({
        resourceType: 'APP',
        action: 'READ',
        projectId: 'proj-1',
      });
      expect(result).toEqual({ hasPermission: true, scope: 'project' });
    });

    it('checkPermissionBatch returns an array of results', async () => {
      fetchMock.mockResolvedValue(
        okResponse({
          results: [
            { hasPermission: true, scope: 'project' },
            { hasPermission: false, scope: 'none' },
          ],
        }),
      );
      const client = new PlatformClient(JWT, API);
      const results = await client.checkPermissionBatch([
        { resourceType: 'APP', action: 'READ', projectId: 'proj-1' },
        { resourceType: 'APP', action: 'DELETE', projectId: 'proj-1' },
      ]);
      expect(results).toHaveLength(2);
    });
  });

  describe('surface — does NOT expose component-runtime methods', () => {
    it('has no executeComponent, onExecutionProgress, localServerUrl, setBuiltInGlobals', () => {
      const client = new PlatformClient(JWT, API) as unknown as Record<
        string,
        unknown
      >;
      // Any of these on the PlatformClient surface would be a regression.
      expect(client.executeComponent).toBeUndefined();
      expect(client.onExecutionProgress).toBeUndefined();
      expect(client.localServerUrl).toBeUndefined();
      expect(client.setBuiltInGlobals).toBeUndefined();
      expect(client.getBuiltInComponent).toBeUndefined();
      expect(client.initBuiltInComponent).toBeUndefined();
      expect(client.abortExecution).toBeUndefined();
      expect(client.listExecutions).toBeUndefined();
      expect(client.getExecution).toBeUndefined();
    });
  });
});
