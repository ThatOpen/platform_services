import {
  CreateAppProps,
  CreateComponentProps,
  CreateItemProps,
  DownloadItemFileParams,
  EngineServicesClient,
  EngineServicesClientProps,
  GetItemProps,
  GetItemsParams,
  PermissionCheckEntry,
  UpdateComponentProps,
  UpdateItemProps,
} from './client';

/**
 * A JWT-focused client for apps and frontends interacting with the That Open
 * platform. Wraps {@link EngineServicesClient} with `useBearer: true` and
 * exposes only the methods that make sense under Bearer JWT auth.
 *
 * **Why this exists**:
 * `EngineServicesClient` mixes component-runtime concerns (executeComponent,
 * WebSocket progress, built-in globals, local execution server) with CRUD
 * and permission checks that apps/FE also need. Exposing the combined
 * surface to app developers invites misuse and drift. `PlatformClient`
 * narrows the surface to what an app running with a user JWT actually uses.
 *
 * Not exposed here (stays on `EngineServicesClient` for components):
 * - `executeComponent`, `abortExecution`, `listExecutions`, `getExecution`,
 *   `onExecutionProgress`.
 * - `getBuiltInComponent`, `initBuiltInComponent(s)`, `setup`,
 *   `setBuiltInGlobals`, `localServerUrl`, `fromPlatformContext`.
 * - Hidden files (internal metadata) and low-level retry tuning.
 *
 * @example
 * ```ts
 * const client = new PlatformClient(jwt, 'https://api.thatopen.com');
 * const files = await client.listFiles({ projectId });
 * const { hasPermission } = await client.checkPermission({
 *   projectId, resourceType: 'STORAGE', action: 'READ',
 * });
 * ```
 */
export class PlatformClient {
  private readonly client: EngineServicesClient;

  constructor(
    accessToken: string,
    apiUrl: string,
    props?: Omit<EngineServicesClientProps, 'useBearer' | 'localServerUrl'>,
  ) {
    this.client = new EngineServicesClient(accessToken, apiUrl, {
      ...props,
      useBearer: true,
    });
  }

  // ─── Files ──────────────────────────────────────────────────────

  listFiles(filters?: {
    folderId?: string;
    archived?: boolean;
    projectId?: string;
  }) {
    return this.client.listFiles(filters);
  }

  getFile(fileId: string, props?: GetItemProps) {
    return this.client.getFile(fileId, props);
  }

  createFile(fileData: CreateItemProps) {
    return this.client.createFile(fileData);
  }

  updateFile(fileId: string, fileData: UpdateItemProps) {
    return this.client.updateFile(fileId, fileData);
  }

  archiveFile(fileId: string) {
    return this.client.archiveFile(fileId);
  }

  recoverFile(fileId: string) {
    return this.client.recoverFile(fileId);
  }

  downloadFile(fileId: string, params?: DownloadItemFileParams) {
    return this.client.downloadFile(fileId, params);
  }

  getFileMetadata(itemId: string, params?: DownloadItemFileParams) {
    return this.client.getFileMetadata(itemId, params);
  }

  // ─── Folders ────────────────────────────────────────────────────

  listFolders(params?: {
    parentFolderId?: string;
    archived?: boolean;
    projectId?: string;
  }) {
    return this.client.listFolders(params);
  }

  getFolder(folderId: string) {
    return this.client.getFolder(folderId);
  }

  createFolder(name: string, parentId?: string, projectId?: string) {
    return this.client.createFolder(name, parentId, projectId);
  }

  updateFolder(folderId: string, updateFolderParams: { name?: string }) {
    return this.client.updateFolder(folderId, updateFolderParams);
  }

  archiveFolder(folderId: string) {
    return this.client.archiveFolder(folderId);
  }

  recoverFolder(folderId: string) {
    return this.client.recoverFolder(folderId);
  }

  downloadFolder(folderId: string) {
    return this.client.downloadFolder(folderId);
  }

  // ─── Apps ───────────────────────────────────────────────────────

  listApps(params?: GetItemsParams & { projectId?: string }) {
    return this.client.listApps(params);
  }

  createApp(appData: CreateAppProps) {
    return this.client.createApp(appData);
  }

  downloadApp(appId: string, params?: DownloadItemFileParams) {
    return this.client.downloadApp(appId, params);
  }

  downloadAppBundle(appId: string, params?: DownloadItemFileParams) {
    return this.client.downloadAppBundle(appId, params);
  }

  archiveApp(appId: string) {
    return this.client.archiveApp(appId);
  }

  // ─── Components ─────────────────────────────────────────────────

  listComponents(params?: GetItemsParams & { projectId?: string }) {
    return this.client.listComponents(params);
  }

  getComponent(componentId: string, props?: GetItemProps) {
    return this.client.getComponent(componentId, props);
  }

  createComponent(componentData: CreateComponentProps) {
    return this.client.createComponent(componentData);
  }

  updateComponent(componentId: string, data: UpdateComponentProps) {
    return this.client.updateComponent(componentId, data);
  }

  downloadComponent(componentId: string, params?: DownloadItemFileParams) {
    return this.client.downloadComponent(componentId, params);
  }

  downloadComponentBundle(
    componentId: string,
    params?: DownloadItemFileParams,
  ) {
    return this.client.downloadComponentBundle(componentId, params);
  }

  archiveComponent(componentId: string) {
    return this.client.archiveComponent(componentId);
  }

  recoverComponent(componentId: string) {
    return this.client.recoverComponent(componentId);
  }

  // ─── Projects ───────────────────────────────────────────────────

  getProject(projectId: string) {
    return this.client.getProject(projectId);
  }

  getProjectData(projectId: string) {
    return this.client.getProjectData(projectId);
  }

  // ─── Permissions ────────────────────────────────────────────────

  checkPermission(params: {
    resourceId?: string;
    resourceType: string;
    action: string;
    projectId?: string;
  }) {
    return this.client.checkPermission(params);
  }

  checkPermissionBatch(checks: PermissionCheckEntry[]) {
    return this.client.checkPermissionBatch(checks);
  }

  // ─── Icons ──────────────────────────────────────────────────────

  uploadItemIcon(itemId: string, icon: File | Blob) {
    return this.client.uploadItemIcon(itemId, icon);
  }

  getItemIcon(itemId: string) {
    return this.client.getItemIcon(itemId);
  }

  removeItemIcon(itemId: string) {
    return this.client.removeItemIcon(itemId);
  }
}
