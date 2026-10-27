import { io } from 'socket.io-client';
import { EngineServicesClient, EngineServicesClientProps } from './client';
import {
  Permission,
  Project,
  ProjectData,
  ProjectDataMember,
  ProjectInvitation,
  ProjectPermissionMatrixRow,
  ProjectRole,
  ProjectWithRole,
} from '../types/projects';
import { AccessToken, NewAccessToken } from '../types/tokens';
import { ThatOpenContext } from '../types/context';
import { ChannelClient, windowTransport } from './channel';
import {
  MarkNotificationsReadResultDto,
  NotificationPageDto,
  NotificationSubscriptionView,
  UnreadCountDto,
} from '../types/notifications';

const PROJECT_PATH = 'project';
const NOTIFICATION_PATH = 'notifications';
const TOKENS_PATH = 'tokens';

/**
 * What arrived on the socket. One callback for all three because a bell
 * reacts the same way to each: refresh the badge, and the list if open.
 *
 * `allRead` is one event for the whole sweep rather than one per
 * notification, so do not expect an id on it.
 */
export type LiveNotificationEvent =
  | { type: 'created'; id: string }
  | { type: 'read'; id: string }
  | { type: 'allRead'; batch: number };

/** Per-automation opt-in. `failures` skips started events entirely. */
export type NotificationSubscriptionFilterInput = 'all' | 'failures';

export interface NotificationSubscriptionInput {
  filter?: NotificationSubscriptionFilterInput;
  /** Overrides the account-level channel setting for this automation only. */
  channels?: { email?: boolean };
}

/** Scope by which a permission was granted (or `'none'` if denied). */
export type PermissionScope = 'global' | 'project' | 'entity' | 'none';

/** Result of a single permission check. */
export interface PermissionCheckResult {
  hasPermission: boolean;
  scope: PermissionScope;
}

/** One entry in a batch permission check. */
export interface PermissionCheckEntry {
  resourceType: string;
  action: string;
  resourceId?: string;
  projectId?: string;
}

/**
 * Accepts either a static JWT string or a provider function that returns the
 * current JWT. Use a provider to keep refresh in the caller's hands — the
 * client calls it on every request so expired tokens never stick.
 *
 * @example Static token (simplest):
 * ```ts
 * new PlatformClient(jwt, apiUrl)
 * ```
 *
 * @example Auth0 React:
 * ```ts
 * const { getAccessTokenSilently } = useAuth0();
 * new PlatformClient(() => getAccessTokenSilently(), apiUrl)
 * ```
 */
export type BearerTokenSource = string | (() => string | Promise<string>);

/**
 * Client for apps, frontends, and any caller authenticating with a user JWT.
 * Extends `EngineServicesClient` — the full API-token-compatible surface is
 * inherited. On top, it exposes the JWT-only routes `getProject`,
 * `getProjectData`, `checkPermission`, and `checkPermissionBatch`. Those hit
 * `ProjectController` which is guarded by `AccountActiveGuard +
 * ProjectAccessGuard` and is not reachable via an access token.
 *
 * **Token refresh.** The constructor accepts a function that returns a JWT
 * (sync or async); the client calls it before every request, so an Auth0
 * SDK's `getAccessTokenSilently()` or similar refreshing source Just Works.
 *
 * Use `EngineServicesClient` for components (API-token auth, local server,
 * WebSocket progress). Use `PlatformClient` when you have a user JWT and
 * need project-level reads or permission introspection.
 *
 * @example
 * ```ts
 * const client = new PlatformClient(
 *   () => auth0.getAccessTokenSilently(),
 *   'https://api.thatopen.com',
 * );
 * const project = await client.getProject(projectId);
 * ```
 */
export class PlatformClient extends EngineServicesClient {
  readonly #tokenProvider?: () => string | Promise<string>;
  #channel?: ChannelClient;

  /**
   * @param token - A bearer JWT, OR a function returning the current JWT
   *   (sync or async). When a function is passed, it's invoked before every
   *   request — ideal for token-refreshing sources like Auth0.
   * @param apiUrl - Base URL of the API (e.g. `https://api.thatopen.com`).
   * @param props - Optional client configuration. `useBearer` is forced to
   *   `true` and cannot be overridden.
   */
  constructor(
    token: BearerTokenSource,
    apiUrl: string,
    props?: Omit<EngineServicesClientProps, 'useBearer'>,
  ) {
    // Seed the parent with a string (possibly empty when a provider is
    // supplied); the override below routes each request through the
    // provider when present.
    const initialToken = typeof token === 'string' ? token : '';
    super(initialToken, apiUrl, { ...props, useBearer: true });
    if (typeof token === 'function') {
      this.#tokenProvider = token;
    }
  }

  protected async resolveAccessToken(): Promise<string> {
    if (this.#tokenProvider) return await this.#tokenProvider();
    return super.resolveAccessToken();
  }

  /**
   * Creates a client from the platform context injected into
   * `window.__THATOPEN_CONTEXT__` by the That Open Platform. Recommended
   * entry point for apps running inside the platform's iframe — the context
   * carries a fresh JWT on every navigation.
   */
  static fromPlatformContext(
    props?: Omit<EngineServicesClientProps, 'useBearer'>,
  ): PlatformClient {
    const ctx: ThatOpenContext = (typeof window !== 'undefined'
      ? window.__THATOPEN_CONTEXT__
      : null) || { appId: '', projectId: '', accessToken: '', apiUrl: '' };
    const client = new PlatformClient(ctx.accessToken, ctx.apiUrl, props);
    (client as { context: ThatOpenContext }).context = ctx;
    return client;
  }

  /**
   * The platform channel, from inside an app: a collaboration room shared with
   * other users of the app, and rooms for commands from external tools (a CLI,
   * an MCP server, a Revit plugin). Typed, and built on the `postMessage`
   * contract with the platform shell — the app never opens a socket.
   *
   * Only available in an app running in the platform's iframe; reading it
   * anywhere else throws. Created on first use.
   *
   * @example
   * ```ts
   * type McpCommands = {
   *   'select-by-category': { payload: { category: string }; reply: { count: number } };
   * };
   *
   * const mcp = client.channel.external<McpCommands>('mcp');
   * mcp.on('select-by-category', async ({ category }) => ({ count: 3 }));
   * await mcp.join();
   *
   * const collab = client.channel.collab();
   * collab.onPeerLeft(({ from }) => removeAvatar(from));
   * await collab.join();
   * ```
   */
  get channel(): ChannelClient {
    this.#channel ??= new ChannelClient(windowTransport());
    return this.#channel;
  }

  // ─── Projects (JWT-only backend routes) ──────────────────────────

  /**
   * Lists the caller's projects, each with their role in it. The discovery
   * call: everything else on this surface takes a projectId, and until this
   * method there was no way to find out which ids exist — a portfolio
   * dashboard had to be configured by hand. `ProjectWithRole` existed as a
   * type with no producer; this is the producer.
   *
   * @example
   * ```ts
   * const projects = await client.listProjects();
   * for (const { project, role } of projects) {
   *   console.log(project.title, role?.name ?? 'no role');
   * }
   * ```
   */
  async listProjects() {
    return await this.request<ProjectWithRole[]>('GET', PROJECT_PATH);
  }

  /**
   * Gets a project by ID. JWT-only — lives here because
   * `GET /project/:id` is guarded by `AccountActiveGuard + ProjectAccessGuard`.
   */
  async getProject(projectId: string) {
    return await this.request<Project>('GET', `${PROJECT_PATH}/${projectId}`);
  }

  /**
   * Gets the full project data (users, roles, files, folders) for a project.
   * User data is stripped of sensitive fields server-side.
   */
  async getProjectData(projectId: string) {
    return await this.request<ProjectData>(
      'GET',
      `${PROJECT_PATH}/${projectId}/data`,
    );
  }

  // ─── Members, invitations and roles (JWT-only backend routes) ─────
  //
  // The administration half of a project, as the dashboard has it: who is in
  // it, who is invited, which roles there are and what each may do — down to
  // one folder (`Permission.resourcePermissions`). Each call is checked on the
  // server against the caller's own role (MEMBERS / ROLES), exactly as the
  // dashboard's are (APOGEA 23-10, «users and permissions»).

  /** The project's members, each with their role. */
  async listMembers(projectId: string) {
    return await this.request<ProjectDataMember[]>(
      'GET',
      `${PROJECT_PATH}/${projectId}/users`,
    );
  }

  /** Adds an existing account to the project, with a role (the project's default when not given). */
  async addMember(projectId: string, accountId: string, roleId?: string) {
    return await this.request<unknown>(
      'POST',
      `${PROJECT_PATH}/${projectId}/user`,
      {
        body: JSON.stringify({
          accountId,
          ...(roleId && { projectRoleId: roleId }),
        }),
        contentType: 'application/json',
      },
    );
  }

  /** Gives a member another role (`null`: the project's default). `projectUserId` is the member's, from {@link listMembers}. */
  async setMemberRole(
    projectId: string,
    projectUserId: string,
    roleId: string | null,
  ) {
    return await this.request<unknown>(
      'PUT',
      `${PROJECT_PATH}/${projectId}/user/${projectUserId}`,
      {
        body: JSON.stringify({ projectRoleId: roleId }),
        contentType: 'application/json',
      },
    );
  }

  /** Takes a member out of the project. */
  async removeMember(projectId: string, projectUserId: string) {
    return await this.request<unknown>(
      'DELETE',
      `${PROJECT_PATH}/${projectId}/user/${projectUserId}`,
    );
  }

  /**
   * Invites a person to the project by email, with a role. They get the
   * platform's invitation; on accepting it they join with that role, whether
   * or not they had an account.
   */
  async inviteMember(projectId: string, email: string, roleId?: string) {
    return await this.request<ProjectInvitation>(
      'POST',
      `${PROJECT_PATH}/${projectId}/invite`,
      {
        body: JSON.stringify({
          email,
          ...(roleId && { projectRoleId: roleId }),
        }),
        contentType: 'application/json',
      },
    );
  }

  /** The project's invitations. */
  async listInvitations(projectId: string) {
    return await this.request<ProjectInvitation[]>(
      'GET',
      `${PROJECT_PATH}/${projectId}/invites`,
    );
  }

  /** Withdraws an invitation that has not been accepted. */
  async cancelInvitation(projectId: string, invitationId: string) {
    return await this.request<unknown>(
      'DELETE',
      `${PROJECT_PATH}/${projectId}/invite/${invitationId}`,
    );
  }

  /** The project's roles, each with its permissions. */
  async listRoles(projectId: string) {
    return await this.request<ProjectRole[]>(
      'GET',
      `${PROJECT_PATH}/${projectId}/roles`,
    );
  }

  /**
   * Makes a role. Its `permissions` are subject × action, each optionally
   * narrowed or widened on given files and folders (`resourcePermissions`):
   * the grant a role has on one folder and what is under it.
   *
   * @example A role that only reads one folder and everything in it
   * ```ts
   * await client.createRole(projectId, {
   *   name: 'Observer — structure',
   *   permissions: [
   *     { subject: 'STORAGE', action: 'READ',
   *       resourcePermissions: [{ resourceId: structureFolderId, appliesToDescendants: true }] },
   *   ],
   * });
   * ```
   */
  async createRole(
    projectId: string,
    role: { name: string; description?: string; permissions: Permission[] },
  ) {
    return await this.request<ProjectRole>(
      'POST',
      `${PROJECT_PATH}/${projectId}/role`,
      { body: JSON.stringify(role), contentType: 'application/json' },
    );
  }

  /** Changes a role: its name, description or permissions (grants and revocations alike). */
  async updateRole(
    roleId: string,
    changes: {
      name?: string;
      description?: string;
      permissions?: Permission[];
    },
  ) {
    return await this.request<ProjectRole>(
      'PUT',
      `${PROJECT_PATH}/role/${roleId}`,
      { body: JSON.stringify(changes), contentType: 'application/json' },
    );
  }

  /** Deletes a role. */
  async deleteRole(roleId: string) {
    return await this.request<unknown>(
      'DELETE',
      `${PROJECT_PATH}/role/${roleId}`,
    );
  }

  /**
   * The project's permission matrix in one call: every role, what it may do
   * (folder grants included) and who has it — for an admin screen that shows
   * and changes it, instead of probing permission by permission.
   */
  async getPermissionMatrix(
    projectId: string,
  ): Promise<ProjectPermissionMatrixRow[]> {
    const [roles, members] = await Promise.all([
      this.listRoles(projectId),
      this.listMembers(projectId),
    ]);
    return roles.map((role) => ({
      role,
      permissions: role.permissions ?? [],
      members: members
        .filter((member) => String(member.role?._id) === String(role._id))
        .map((member) => member.user),
    }));
  }

  // ─── API tokens (JWT-only backend routes) ─────────────────────────
  //
  // The caller's own API tokens, as the dashboard's API Tokens card has them,
  // so an integration can be given a credential of its own without leaving
  // the product — limited to some projects (`projectIds`), split by
  // permission, and revoked one by one (APOGEA 23-10, §2.5).

  /** The caller's API tokens (without their secret). */
  async listTokens() {
    return await this.request<AccessToken[]>('GET', TOKENS_PATH);
  }

  /** A token's secret, to hand to the integration that will use it. */
  async getTokenSecret(tokenId: string) {
    // (The route answers the bare secret, not JSON.)
    const secret = await this.request<Blob>(
      'GET',
      `${TOKENS_PATH}/${tokenId}/token`,
      { responseType: 'blob' },
    );
    return await secret.text();
  }

  /**
   * Creates an API token. `projectIds` limits it to those projects; without
   * them it may act on every project its owner can reach.
   */
  async createToken(token: NewAccessToken) {
    return await this.request<AccessToken>('POST', TOKENS_PATH, {
      body: JSON.stringify({
        urlRestrictions: [],
        ...token,
      }),
      contentType: 'application/json',
    });
  }

  /** Changes a token. `projectIds: []` lifts its project limit; leaving it out keeps it. */
  async updateToken(tokenId: string, changes: Partial<NewAccessToken>) {
    return await this.request<AccessToken>('PUT', `${TOKENS_PATH}/${tokenId}`, {
      body: JSON.stringify(changes),
      contentType: 'application/json',
    });
  }

  /** Revokes a token: it stops working at once. */
  async revokeToken(tokenId: string) {
    return await this.request<unknown>('DELETE', `${TOKENS_PATH}/${tokenId}`);
  }

  // ─── Account ──────────────────────────────────────────────────────

  /**
   * Fetches a user's profile picture as raw image bytes, for showing member
   * avatars inside an app. The route is bearer-authed, so it can't be used as
   * an `<img src>` — turn the blob into an object URL with
   * `URL.createObjectURL(blob)`. Rejects when the account has no avatar.
   */
  async getAvatar(accountId: string): Promise<Blob> {
    return await this.request<Blob>('GET', `account/${accountId}/avatar`, {
      responseType: 'blob',
    });
  }

  // ─── Permissions (JWT-only backend routes) ───────────────────────

  /**
   * Checks whether the caller has a specific permission within a project.
   * Returns `{ hasPermission, scope }` where `scope` is `'global'` for
   * admin/owner, `'project'` for a role broad grant, `'entity'` for a
   * per-entity override, `'none'` for denied.
   */
  async checkPermission(params: {
    resourceId?: string;
    resourceType: string;
    action: string;
    projectId?: string;
  }) {
    return await this.request<PermissionCheckResult>(
      'GET',
      `${PROJECT_PATH}/permissions/check`,
      { query: params as Record<string, string | undefined> },
    );
  }

  /**
   * Batch variant of {@link checkPermission}. Evaluates multiple checks in a
   * single round-trip; results come back in the same order as `checks`.
   */
  async checkPermissionBatch(checks: PermissionCheckEntry[]) {
    const response = await this.request<{
      results: PermissionCheckResult[];
    }>('POST', `${PROJECT_PATH}/permissions/check/batch`, {
      body: JSON.stringify({ checks }),
      contentType: 'application/json',
    });
    return response.results;
  }

  // ─── Notifications ────────────────────────────────────────────────

  /**
   * Lists the signed-in user's notifications, newest first.
   *
   * Scoped to whoever the bearer token belongs to — an app cannot read
   * anyone else's. Muted notifications are included: muting silences the
   * badge and the delivery channels, it does not hide the record.
   *
   * Paginate by passing the previous response's `nextCursor` back in; it is
   * opaque, so do not build one by hand. A null `nextCursor` means the last
   * page.
   *
   * @example Walk every page:
   * ```ts
   * let cursor: string | undefined;
   * do {
   *   const page = await client.getNotifications({ cursor });
   *   render(page.items);
   *   cursor = page.nextCursor ?? undefined;
   * } while (cursor);
   * ```
   */
  async getNotifications(params?: { cursor?: string; limit?: number }) {
    return await this.request<NotificationPageDto>('GET', NOTIFICATION_PATH, {
      query: {
        ...(params?.cursor !== undefined && { cursor: params.cursor }),
        ...(params?.limit !== undefined && { limit: String(params.limit) }),
      },
    });
  }

  /**
   * Number of unread notifications, excluding muted ones. This is the bell
   * badge count, so it is cheap to poll.
   */
  async getUnreadNotificationCount() {
    const response = await this.request<UnreadCountDto>(
      'GET',
      `${NOTIFICATION_PATH}/unread-count`,
    );
    return response.count;
  }

  /**
   * Marks specific notifications as read. Ids the caller does not own are
   * ignored rather than rejected, so `updated` can be lower than the number
   * passed in.
   */
  async markNotificationsRead(notificationIds: string[]) {
    return await this.request<MarkNotificationsReadResultDto>(
      'POST',
      `${NOTIFICATION_PATH}/mark-read`,
      {
        body: JSON.stringify({ ids: notificationIds }),
        contentType: 'application/json',
      },
    );
  }

  /** Marks every unread notification as read in one call. */
  async markAllNotificationsRead() {
    return await this.request<MarkNotificationsReadResultDto>(
      'POST',
      `${NOTIFICATION_PATH}/mark-all-read`,
    );
  }

  /**
   * The automations this user has subscribed to. Nobody is subscribed by
   * default, so an empty list is the normal state.
   */
  async getNotificationSubscriptions() {
    return await this.request<NotificationSubscriptionView[]>(
      'GET',
      `${NOTIFICATION_PATH}/subscriptions`,
    );
  }

  /**
   * Removes this user's subscription to one automation.
   *
   * Unlike subscribing, which happens through the project routes, this works
   * for any automation the user is subscribed to and keeps working after the
   * automation itself is gone — opting out must never be the thing that
   * fails.
   */
  async unsubscribeFromAutomation(hookId: string) {
    return await this.request<{ unsubscribed: boolean }>(
      'DELETE',
      `${NOTIFICATION_PATH}/subscriptions/${hookId}`,
    );
  }

  /**
   * Subscribes the signed-in user to one project automation's runs.
   *
   * Nobody is subscribed by default, so this is what makes an automation
   * produce notifications for this user at all. Subscribing again is
   * harmless: it updates the existing subscription rather than duplicating.
   *
   * Read-level access to the project is enough. Someone who can see an
   * automation can follow it without being able to change it.
   *
   * @example Follow only the failures, and email me about them:
   * ```ts
   * await client.subscribeToAutomation(projectId, hookId, {
   *   filter: 'failures',
   *   channels: { email: true },
   * });
   * ```
   */
  async subscribeToAutomation(
    projectId: string,
    hookId: string,
    input?: NotificationSubscriptionInput,
  ) {
    return await this.request<{ subscribed: true }>(
      'POST',
      `${PROJECT_PATH}/${projectId}/events/hooks/${hookId}/subscription`,
      {
        body: JSON.stringify(input ?? {}),
        contentType: 'application/json',
      },
    );
  }

  /**
   * Changes an existing subscription. Only the fields passed are touched, so
   * sending `channels` alone leaves the filter as it was.
   *
   * Throws if the user is not subscribed; use {@link subscribeToAutomation}
   * to create one.
   */
  async updateAutomationSubscription(
    projectId: string,
    hookId: string,
    changes: NotificationSubscriptionInput,
  ) {
    return await this.request<{ updated: true }>(
      'PATCH',
      `${PROJECT_PATH}/${projectId}/events/hooks/${hookId}/subscription`,
      {
        body: JSON.stringify(changes),
        contentType: 'application/json',
      },
    );
  }

  /**
   * Listens for this user's notifications in real time.
   *
   * Unlike {@link EngineServicesClient.onExecutionProgress}, which follows one
   * execution and closes when it ends, this stays connected for the session:
   * the server puts the socket in a room for the signed-in account and pushes
   * anything addressed to them.
   *
   * The events carry ids rather than the notifications themselves, so treat
   * them as a signal to refresh. That keeps a burst cheap and means the
   * server is never the source of a stale render.
   *
   * Requires a user JWT. An API access token is rejected by the gateway,
   * because it identifies a token rather than a person.
   *
   * @returns a function that disconnects. Call it on unmount.
   *
   * @example
   * ```ts
   * const stop = await client.onNotification((event) => {
   *   if (event.type === 'created') refreshBell();
   * });
   * // later
   * stop();
   * ```
   */
  async onNotification(
    onEvent: (event: LiveNotificationEvent) => void,
  ): Promise<() => void> {
    // Resolved per connection rather than reused from construction, so a
    // provider-backed client opens the socket with a current token. It rides
    // the auth payload, never the URL: a failing handshake prints its URL in
    // the browser console, token included.
    const token = await this.resolveAccessToken();
    const socket = io(`${this.socketOrigin}/notifications`, {
      auth: { accessToken: token },
      transports: ['websocket'],
    });

    socket.on('notification.created', (data: { id: string }) =>
      onEvent({ type: 'created', id: data?.id }),
    );
    socket.on('notification.read', (data: { id: string }) =>
      onEvent({ type: 'read', id: data?.id }),
    );
    socket.on('notifications.allRead', (data: { batch: number }) =>
      onEvent({ type: 'allRead', batch: data?.batch }),
    );

    return () => socket.disconnect();
  }
}
