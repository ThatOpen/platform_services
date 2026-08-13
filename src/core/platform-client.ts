import { io } from 'socket.io-client';
import {
  EngineServicesClient,
  EngineServicesClientProps,
} from './client';
import { Project, ProjectData } from '../types/projects';
import { ThatOpenContext } from '../types/context';
import {
  MarkNotificationsReadResultDto,
  NotificationPageDto,
  NotificationSubscriptionView,
  UnreadCountDto,
} from '../types/notifications';

const PROJECT_PATH = 'project';
const NOTIFICATION_PATH = 'notifications';

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
export type BearerTokenSource =
  | string
  | (() => string | Promise<string>);

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
    const ctx: ThatOpenContext =
      (typeof window !== 'undefined'
        ? window.__THATOPEN_CONTEXT__
        : null) || { appId: '', projectId: '', accessToken: '', apiUrl: '' };
    const client = new PlatformClient(ctx.accessToken, ctx.apiUrl, props);
    (client as { context: ThatOpenContext }).context = ctx;
    return client;
  }

  // ─── Projects (JWT-only backend routes) ──────────────────────────

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
    // provider-backed client opens the socket with a current token.
    const token = await this.resolveAccessToken();
    const socket = io(
      `${this.socketOrigin}/notifications?accessToken=${encodeURIComponent(token)}`,
      { transports: ['websocket'] },
    );

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
