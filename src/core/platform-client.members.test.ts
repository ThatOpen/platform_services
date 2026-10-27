import { describe, it, expect, beforeEach, afterEach, vi, type Mock } from 'vitest';
import { PlatformClient } from './platform-client';

// Members, invitations and roles: the administration half (APOGEA 23-10).
const API = 'https://api.example.com';

function okResponse(data: unknown): Response {
  return {
    ok: true,
    status: 200,
    statusText: 'OK',
    text: async () => JSON.stringify(data),
    json: async () => data,
  } as unknown as Response;
}

describe('PlatformClient — members, invitations and roles', () => {
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

  it('invites a person with a role', async () => {
    fetchMock.mockResolvedValue(okResponse({ _id: 'i1' }));
    await new PlatformClient('jwt', API).inviteMember('p1', 'a@b.com', 'r1');
    expect(call()).toEqual({
      method: 'POST',
      path: '/api/project/p1/invite',
      body: { email: 'a@b.com', projectRoleId: 'r1' },
    });
  });

  it('lists and cancels invitations', async () => {
    fetchMock.mockResolvedValue(okResponse([]));
    const client = new PlatformClient('jwt', API);
    await client.listInvitations('p1');
    await client.cancelInvitation('p1', 'i1');
    expect(call(0)).toMatchObject({ method: 'GET', path: '/api/project/p1/invites' });
    expect(call(1)).toMatchObject({ method: 'DELETE', path: '/api/project/p1/invite/i1' });
  });

  it("sets a member's role, null going back to the default", async () => {
    fetchMock.mockResolvedValue(okResponse({}));
    await new PlatformClient('jwt', API).setMemberRole('p1', 'u1', null);
    expect(call()).toEqual({
      method: 'PUT',
      path: '/api/project/p1/user/u1',
      body: { projectRoleId: null },
    });
  });

  it('creates a role with a folder grant', async () => {
    fetchMock.mockResolvedValue(okResponse({ _id: 'r2' }));
    const permissions = [
      {
        subject: 'STORAGE' as const,
        action: 'READ' as const,
        resourcePermissions: [{ resourceId: 'f1', appliesToDescendants: true }],
      },
    ];
    await new PlatformClient('jwt', API).createRole('p1', { name: 'Observer', permissions });
    expect(call()).toEqual({
      method: 'POST',
      path: '/api/project/p1/role',
      body: { name: 'Observer', permissions },
    });
  });

  it('puts roles, their permissions and their members in one matrix', async () => {
    const roles = [
      { _id: 'r1', name: 'Admin', permissions: [{ subject: 'ALL', action: 'MANAGE' }] },
      { _id: 'r2', name: 'Observer', permissions: [] },
    ];
    const members = [
      { projectUserId: 'pu1', user: { _id: 'a', fullName: 'Ana', email: 'a@x' }, role: { _id: 'r1' } },
      { projectUserId: 'pu2', user: { _id: 'b', fullName: 'Luis', email: 'b@x' }, role: { _id: 'r2' } },
    ];
    fetchMock.mockImplementation(async (url: string) =>
      okResponse(new URL(url).pathname.endsWith('/roles') ? roles : members),
    );
    const matrix = await new PlatformClient('jwt', API).getPermissionMatrix('p1');
    expect(matrix.map((row) => [row.role.name, row.members.map((m) => m.fullName)])).toEqual([
      ['Admin', ['Ana']],
      ['Observer', ['Luis']],
    ]);
  });
});
