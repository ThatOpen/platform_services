import { io } from 'socket.io-client';
import {
  ExecutionEntity,
  ExecutionSuscriptionReturnType,
} from '../types/execution';
import { UpdateItemDto, UpdateItemFolderDto } from '../types/item.dto';
import {
  AppItem,
  AppVersionProps,
  ComponentItem,
  ComponentVersionProps,
  Item,
  ItemFolder,
  ItemType,
  ItemVersion,
  ItemWithVersions,
} from '../types/items';
import { CreateItemResponse, UpdateItemResponse } from '../types/response';
import { CreateHiddenItemResult, HiddenFileEntity } from '../types/files';
import {
  Project,
  ProjectApp,
  ProjectRole,
  ProjectUser,
  ProjectWithRole,
  ProjectUserWithRole,
  CreateProjectParams,
  UpdateProjectParams,
  CreateProjectRoleParams,
  UpdateProjectRoleParams,
  AddProjectUserParams,
  ChangeProjectUserRoleParams,
} from '../types/projects';
import {
  EventHook,
  EnrichedEventLog,
  CreateEventHookParams,
  UpdateEventHookParams,
} from '../types/events';
import {
  AccessTokenInfo,
  CreateTokenParams,
  UpdateTokenParams,
} from '../types/tokens';
import { Account, UpdateAccountParams } from '../types/accounts';

const FOLDER_PATH = 'item/folder';
const ITEM_PATH = 'item';
const PROCESS_PATH = 'processor';
const PROJECT_PATH = 'project';
const EVENTS_PATH = 'events';
const TOKENS_PATH = 'tokens';
const ACCOUNT_PATH = 'account';
const ITEM_TYPE_FILE = 'FILE';
const ITEM_TYPE_COMPONENT = 'TOOL';
const ITEM_TYPE_APP = 'APP';
const HIDDEN_PATH = 'hidden';

export type CreateItemProps = {
  file: File;
  name: string;
  versionTag: string;
  parentFolderId?: string;
  metadata?: Record<string, string>;
};

export type UpdateItemProps = {
  name?: string;
  parentFolderId?: string;
  file?: File;
  versionTag?: string;
  metadata?: Record<string, string>;
};

export type GetItemProps = {
  showVersions?: boolean;
};

export type CreateComponentProps = CreateItemProps & {
  componentProps: ComponentVersionProps;
};

export type UpdateComponentProps = UpdateItemProps & {
  componentProps: ComponentVersionProps;
};

export type CreateAppProps = CreateItemProps & {
  appProps?: AppVersionProps;
};

export type UpdateAppProps = UpdateItemProps & {
  appProps?: AppVersionProps;
};

export type DownloadItemFileParams = {
  versionTag?: string;
  withDraft?: boolean;
};

export type EngineServicesClientProps = {
  retries?: number;
};

export type GetItemsParams = { folderId?: string; ShowVersions?: boolean };

export class EngineServicesClient {
  private apiUrl: string;
  private accessToken: string;
  private wsUrl: string;
  private retries: number;

  constructor(
    accessToken: string,
    apiUrl: string,
    props?: EngineServicesClientProps,
  ) {
    const { retries = 0 } = props || {};
    let url = apiUrl;
    if (url.charAt(url.length - 1) === '/') {
      url = url.slice(0, -1);
    }
    this.apiUrl = `${url}/api`;
    this.accessToken = accessToken;
    this.wsUrl = `${url}?accessToken=${accessToken}`;
    this.retries = retries;
  }

  setRetries(retries: number) {
    this.retries = retries;
  }

  #buildUrl(path: string) {
    return `${this.apiUrl}/${path}`;
  }

  async #requestApi<T = object>(
    method: string,
    path: string,
    requestData?: {
      body?: BodyInit;
      query?: object;
      contentType?:
        | 'application/json'
        | 'multipart/form-data'
        | 'application/x-www-form-urlencoded';
      retries?: number;
    },
  ): Promise<T> {
    const { body, query, contentType, retries } = requestData || {};
    const url = this.#buildUrl(path);

    const cleanQuery = this.#cleanData(query);

    const params = {
      ...cleanQuery,
      accessToken: this.accessToken,
    };

    try {
      const response = await fetch(
        url + '?' + new URLSearchParams(params).toString(),
        {
          method,
          headers: {
            Accept: 'application/json',
            ...(contentType && { 'Content-Type': contentType }),
          },
          ...(body && { body }),
        },
      );
      if (!response.ok) {
        const textResponse = await response
          .text()
          .then((text) => text)
          .catch(() => undefined);
        throw new Error(
          `Request failed with status ${response.status}: ${response.statusText} - ${textResponse}`,
        );
      }

      return response
        .json()
        .then((data) => data as T)
        .catch(() => undefined as T);
    } catch (e) {
      let retriesAmmount = retries != null ? retries : this.retries;
      if (retriesAmmount) {
        retriesAmmount = retriesAmmount - 1;
        return await this.#requestApi(method, path, {
          ...requestData,
          retries,
        });
      } else {
        throw e;
      }
    }
  }

  async #requestFile(path: string, requestData?: { query?: object }) {
    const { query } = requestData || {};
    const url = this.#buildUrl(path);
    const params = {
      ...query,
      accessToken: this.accessToken,
    };
    const response = await fetch(
      url + '?' + new URLSearchParams(params).toString(),
      { method: 'GET' },
    );

    return response;
  }

  async listFolders(params: { parentFolderId?: string; archived?: boolean }) {
    const { archived, parentFolderId } = params;
    return await this.#requestApi<ItemFolder[]>('GET', FOLDER_PATH, {
      query: { parentFolderId, archived },
    });
  }

  async getFolder(folderId: string) {
    return await this.#requestApi<ItemFolder>(
      'GET',
      `${FOLDER_PATH}/${folderId}`,
    );
  }

  // TODO allow nested folders
  async createFolder(name: string, parentId?: string) {
    return await this.#requestApi<ItemFolder>('POST', FOLDER_PATH, {
      body: JSON.stringify({ name, ...(parentId && { parentId }) }),
      contentType: 'application/json',
    });
  }

  async updateFolder(folderId: string, updateFolderParams: { name?: string }) {
    const { name } = updateFolderParams;
    return await this.#requestApi<ItemFolder>(
      'PUT',
      `${FOLDER_PATH}/${folderId}`,
      {
        body: JSON.stringify({ name } as UpdateItemFolderDto),
        contentType: 'application/json',
      },
    );
  }

  async archiveFolder(folderId: string) {
    return await this.#requestApi<ItemFolder>(
      'DELETE',
      `${FOLDER_PATH}/${folderId}`,
    );
  }

  async recoverFolder(folderId: string) {
    return await this.#requestApi<ItemFolder>(
      'PUT',
      `${FOLDER_PATH}/${folderId}/recover`,
    );
  }

  async recoverFile(fileId: string) {
    return await this.#requestApi<ItemFolder>(
      'PUT',
      `${ITEM_PATH}/${fileId}/recover`,
    );
  }

  async listFiles(filters?: { folderId?: string; archived?: boolean }) {
    const { folderId, archived } = filters || {};
    if (folderId) {
      return await this.#requestApi<ItemFolder[]>(
        'GET',
        `${FOLDER_PATH}/${folderId}/items`,
        { query: { itemType: ITEM_TYPE_FILE, archived } },
      );
    }
    return await this.#requestApi<Item[]>('GET', `${ITEM_PATH}`, {
      query: { itemType: ITEM_TYPE_FILE, archived },
    });
  }

  async getFile(fileId: string, props?: GetItemProps) {
    return await this.#getItem<ItemWithVersions<Item>>(fileId, props);
  }

  async downloadFile(
    fileId: string,

    params?: DownloadItemFileParams,
  ) {
    const { versionTag, withDraft } = params || {};
    return await this.#requestFile(
      `${ITEM_PATH}/${fileId}/download`,

      {
        query: {
          ...(versionTag && { versionTag }),
          ...(withDraft && { withDraft }),
        },
      },
    );
  }

  async downloadComponent(
    componentId: string,

    params?: DownloadItemFileParams,
  ) {
    const { versionTag, withDraft } = params || {};
    return await this.#requestFile(
      `${ITEM_PATH}/${componentId}/download`,

      {
        query: {
          ...(versionTag && { versionTag }),
          ...(withDraft && { withDraft }),
        },
      },
    );
  }

  async downloadComponentBundle(
    componentId: string,
    params?: DownloadItemFileParams,
  ) {
    const { versionTag, withDraft } = params || {};
    return await this.#requestFile(
      `${ITEM_PATH}/${componentId}/download/bundle`,
      {
        query: {
          ...(versionTag && { versionTag }),
          ...(withDraft && { withDraft }),
        },
      },
    );
  }

  async getFileMetadata(itemId: string, params?: DownloadItemFileParams) {
    const { versionTag, withDraft } = params || {};
    return await this.#requestApi<Record<string, string>>(
      'GET',
      `${ITEM_PATH}/${itemId}/metadata`,
      {
        query: {
          ...(versionTag && { versionTag }),
          ...(withDraft && { withDraft }),
        },
      },
    );
  }

  async downloadApp(
    appId: string,

    params?: DownloadItemFileParams,
  ) {
    const { versionTag, withDraft } = params || {};

    return await this.#requestFile(
      `${ITEM_PATH}/${appId}/download`,

      {
        query: {
          ...(versionTag && { versionTag }),
          ...(withDraft && { withDraft }),
        },
      },
    );
  }

  async downloadFolder(folderId: string) {
    return await this.#requestFile(`${FOLDER_PATH}/${folderId}/download`);
  }

  async #createItem<T = Item, P extends object = object>(
    fileData: CreateItemProps,
    itemType: ItemType,
    extraProps?: P,
  ) {
    const { name, versionTag, parentFolderId, file, metadata } = fileData;
    const formData = new FormData();
    formData.append('file', file);
    formData.append('name', name);
    formData.append('versionTag', versionTag);
    formData.append('itemType', itemType);
    parentFolderId && formData.append('folderId', parentFolderId);

    extraProps && formData.append('extraProps', JSON.stringify(extraProps));
    metadata &&
      formData.append('metadata', JSON.stringify(this.#cleanData(metadata)));
    return await this.#requestApi<CreateItemResponse<T>>('POST', ITEM_PATH, {
      body: formData,
    });
  }

  async #updateItem<T = Item, P extends object = object>(
    itemId: string,
    fileData: UpdateItemProps,
    extraProps?: P,
  ): Promise<UpdateItemResponse<T>> {
    const { name, versionTag, parentFolderId, file, metadata } = fileData;

    let item: T | undefined;
    let version: ItemVersion | undefined;
    if (file) {
      const formData = new FormData();
      formData.append('file', file);
      versionTag && formData.append('versionTag', versionTag);
      extraProps && formData.append('extraProps', JSON.stringify(extraProps));
      metadata &&
        formData.append('metadata', JSON.stringify(this.#cleanData(metadata)));
      version = await this.#requestApi<ItemVersion>(
        'POST',
        `${ITEM_PATH}/${itemId}/version`,
        {
          body: formData,
        },
      );
    }
    if (name || parentFolderId) {
      const body: UpdateItemDto = {
        ...(name && { name }),
        ...(parentFolderId && { folderId: parentFolderId }),
      };

      const parsedBody = JSON.stringify(body);

      item = await this.#requestApi<T>('PUT', `${ITEM_PATH}/${itemId}`, {
        body: parsedBody,
        contentType: 'application/json',
      });
    }

    return { item, version };
  }

  async createFile(fileData: CreateItemProps) {
    return await this.#createItem(fileData, ITEM_TYPE_FILE);
  }

  async updateFile(
    fileId: string,
    fileData: UpdateItemProps,
  ): Promise<UpdateItemResponse> {
    return await this.#updateItem(fileId, fileData);
  }

  async archiveFile(fileId: string) {
    return await this.#requestApi<Item>('DELETE', `${ITEM_PATH}/${fileId}`);
  }

  async listComponents(params: GetItemsParams) {
    const { folderId, ShowVersions } = params;
    if (folderId) {
      return await this.#requestApi<ComponentItem[]>(
        'GET',
        `${ITEM_PATH}/${folderId}/items`,
        {
          query: {
            itemType: ITEM_TYPE_COMPONENT,
            ...(ShowVersions && { ShowVersions }),
          },
        },
      );
    }
    return await this.#requestApi<ComponentItem[]>('GET', `${ITEM_PATH}`, {
      query: {
        itemType: ITEM_TYPE_COMPONENT,
        ...(ShowVersions && { ShowVersions }),
      },
    });
  }

  async getComponent(componentId: string, props: GetItemProps) {
    return await this.#getItem<ItemWithVersions<ComponentItem>>(
      componentId,
      props,
    );
  }

  /**
   * Create a new component.
   * @functionß
   */

  async createComponent(componentData: CreateComponentProps) {
    const { componentProps } = componentData;
    return await this.#createItem<ComponentItem, ComponentVersionProps>(
      componentData,
      ITEM_TYPE_COMPONENT,
      componentProps,
    );
  }

  /**
   * Update a component.
   * @function
   */

  async updateComponent(
    fileId: string,
    componentData: UpdateComponentProps,
  ): Promise<UpdateItemResponse> {
    const { componentProps } = componentData;
    return await this.#updateItem<ComponentItem, ComponentVersionProps>(
      fileId,
      componentData,
      componentProps,
    );
  }

  async archiveComponent(componentId: string) {
    return await this.#requestApi<ComponentItem>(
      'DELETE',
      `${ITEM_PATH}/${componentId}`,
    );
  }

  async recoverComponent(componentId: string) {
    return await this.#requestApi<ComponentItem>(
      'PUT',
      `${ITEM_PATH}/${componentId}/recover`,
    );
  }

  async executeComponent(
    componentId: string,
    executionParams: object,
    versionTag?: string,
  ) {
    return await this.#requestApi<{ executionId: string }>(
      'POST',
      `${PROCESS_PATH}/${componentId}/execute`,
      {
        body: JSON.stringify(executionParams),
        query: { ...(versionTag && { versionTag }) },
        contentType: 'application/json',
      },
    );
  }

  async listExecutions(componentId: string) {
    return await this.#requestApi<ExecutionEntity[]>(
      'GET',
      `${PROCESS_PATH}/${componentId}/progress`,
    );
  }

  async getExecution(executionId: string) {
    return await this.#requestApi<ExecutionEntity>(
      'GET',
      `${PROCESS_PATH}/progress/${executionId}`,
    );
  }

  async abortExecution(executionId: string) {
    return await this.#requestApi<ExecutionEntity>(
      'POST',
      `${PROCESS_PATH}/progress/${executionId}/abort`,
    );
  }

  /** @function
   * @name myFunction
   * @param {string} executionId - Identifier of the execution.
   * @param {string} onUpdateCallback - Callback function to be called when the execution is updated.
   * @returns {void} - Nothing is returned. Connection is closed on its own
   * */

  async onExecutionProgress(
    executionId: string,
    onUpdateCallback: (data: ExecutionSuscriptionReturnType) => void,
  ) {
    const socket = await io(this.wsUrl);

    socket.on('connect', function () {
      socket.emit('executionSubscription', JSON.stringify({ executionId }));
      socket.on('execution', (data: ExecutionSuscriptionReturnType) => {
        onUpdateCallback(data);
      });
    });

    socket.on('connect_error', function (e: unknown) {
      console.log(e);
    });
  }

  /** @function
   * @name createHiddenFile
   * @returns {string} - Returns id of the created hidden file.
   * */

  async createHiddenFile(file: File, parentFileId: string) {
    const formData = new FormData();

    formData.append('file', file);
    formData.append('parentItemId', parentFileId);

    return await this.#requestApi<CreateHiddenItemResult>(
      'POST',
      `${ITEM_PATH}/${HIDDEN_PATH}`,
      {
        body: formData,
      },
    );
  }

  async deleteHiddenFile(hiddenId: string) {
    return await this.#requestApi<Item>(
      'DELETE',
      `${ITEM_PATH}/${HIDDEN_PATH}/${hiddenId}`,
    );
  }

  async getHiddenFile(hiddenId: string) {
    return await this.#requestApi<HiddenFileEntity>(
      'GET',
      `${ITEM_PATH}/${HIDDEN_PATH}/${hiddenId}`,
    );
  }

  async downloadHiddenFile(hiddenId: string) {
    return await this.#requestFile(
      `${ITEM_PATH}/${HIDDEN_PATH}/${hiddenId}/download`,
    );
  }

  async getHiddenFilesByParent(parentFileId: string) {
    return await this.#requestApi<HiddenFileEntity[]>(
      'GET',
      `${ITEM_PATH}/${parentFileId}/${HIDDEN_PATH}`,
    );
  }

  async deleteHiddenFileByParent(parentFileId: string) {
    return await this.#requestApi<Item[]>(
      'DELETE',
      `${ITEM_PATH}/${parentFileId}/${HIDDEN_PATH}`,
    );
  }

  // ─── App Methods ───

  async createApp(appData: CreateAppProps) {
    const { appProps } = appData;
    return await this.#createItem<AppItem, AppVersionProps>(
      appData,
      ITEM_TYPE_APP,
      appProps,
    );
  }

  async updateApp(
    appId: string,
    appData: UpdateAppProps,
  ): Promise<UpdateItemResponse<AppItem>> {
    const { appProps } = appData;
    return await this.#updateItem<AppItem, AppVersionProps>(
      appId,
      appData,
      appProps,
    );
  }

  async listApps(params?: GetItemsParams) {
    const { folderId, ShowVersions } = params || {};
    if (folderId) {
      return await this.#requestApi<AppItem[]>(
        'GET',
        `${FOLDER_PATH}/${folderId}/items`,
        {
          query: {
            itemType: ITEM_TYPE_APP,
            ...(ShowVersions && { ShowVersions }),
          },
        },
      );
    }
    return await this.#requestApi<AppItem[]>('GET', `${ITEM_PATH}`, {
      query: {
        itemType: ITEM_TYPE_APP,
        ...(ShowVersions && { ShowVersions }),
      },
    });
  }

  async getApp(appId: string, props?: GetItemProps) {
    return await this.#getItem<ItemWithVersions<AppItem>>(appId, props);
  }

  async archiveApp(appId: string) {
    return await this.#requestApi<AppItem>('DELETE', `${ITEM_PATH}/${appId}`);
  }

  async recoverApp(appId: string) {
    return await this.#requestApi<AppItem>(
      'PUT',
      `${ITEM_PATH}/${appId}/recover`,
    );
  }

  async duplicateApp(appId: string, name?: string) {
    return await this.#requestApi<Item>(
      'POST',
      `${ITEM_PATH}/${appId}/duplicate`,
      {
        body: JSON.stringify({ ...(name && { name }) }),
        contentType: 'application/json',
      },
    );
  }

  // ─── Version Methods ───

  async createVersion(
    itemId: string,
    file: File,
    versionTag: string,
    extraProps?: object,
  ) {
    const formData = new FormData();
    formData.append('file', file);
    formData.append('versionTag', versionTag);
    extraProps && formData.append('extraProps', JSON.stringify(extraProps));
    return await this.#requestApi<ItemVersion>(
      'POST',
      `${ITEM_PATH}/${itemId}/version`,
      { body: formData },
    );
  }

  async createDraftVersion(
    itemId: string,
    file: File,
    versionTag: string,
    extraProps?: object,
  ) {
    const formData = new FormData();
    formData.append('file', file);
    formData.append('versionTag', versionTag);
    extraProps && formData.append('extraProps', JSON.stringify(extraProps));
    return await this.#requestApi<ItemVersion>(
      'POST',
      `${ITEM_PATH}/${itemId}/version/draft`,
      { body: formData },
    );
  }

  async getVersion(itemId: string, versionTag: string) {
    return await this.#requestApi<ItemVersion>(
      'GET',
      `${ITEM_PATH}/${itemId}/version/${versionTag}`,
    );
  }

  // ─── Project Methods ───

  async createProject(params: CreateProjectParams) {
    return await this.#requestApi<Project>('POST', PROJECT_PATH, {
      body: JSON.stringify(params),
      contentType: 'application/json',
    });
  }

  async listProjects() {
    return await this.#requestApi<ProjectWithRole[]>('GET', PROJECT_PATH);
  }

  async getProject(projectId: string) {
    return await this.#requestApi<Project>(
      'GET',
      `${PROJECT_PATH}/${projectId}`,
    );
  }

  async updateProject(projectId: string, params: UpdateProjectParams) {
    return await this.#requestApi<Project>(
      'PUT',
      `${PROJECT_PATH}/${projectId}`,
      {
        body: JSON.stringify(params),
        contentType: 'application/json',
      },
    );
  }

  async deleteProject(projectId: string) {
    return await this.#requestApi<void>(
      'DELETE',
      `${PROJECT_PATH}/${projectId}`,
    );
  }

  // ─── Project Roles ───

  async createProjectRole(
    projectId: string,
    params: CreateProjectRoleParams,
  ) {
    return await this.#requestApi<ProjectRole>(
      'POST',
      `${PROJECT_PATH}/${projectId}/role`,
      {
        body: JSON.stringify(params),
        contentType: 'application/json',
      },
    );
  }

  async listProjectRoles(projectId: string) {
    return await this.#requestApi<ProjectRole[]>(
      'GET',
      `${PROJECT_PATH}/${projectId}/roles`,
    );
  }

  async updateProjectRole(roleId: string, params: UpdateProjectRoleParams) {
    return await this.#requestApi<ProjectRole>(
      'PUT',
      `${PROJECT_PATH}/role/${roleId}`,
      {
        body: JSON.stringify(params),
        contentType: 'application/json',
      },
    );
  }

  async deleteProjectRole(roleId: string) {
    return await this.#requestApi<void>(
      'DELETE',
      `${PROJECT_PATH}/role/${roleId}`,
    );
  }

  async listUsersForRole(roleId: string) {
    return await this.#requestApi<ProjectUser[]>(
      'GET',
      `${PROJECT_PATH}/role/${roleId}/users`,
    );
  }

  // ─── Project Users ───

  async addProjectUser(projectId: string, params: AddProjectUserParams) {
    return await this.#requestApi<ProjectUser>(
      'POST',
      `${PROJECT_PATH}/${projectId}/user`,
      {
        body: JSON.stringify(params),
        contentType: 'application/json',
      },
    );
  }

  async listProjectUsers(projectId: string) {
    return await this.#requestApi<ProjectUserWithRole[]>(
      'GET',
      `${PROJECT_PATH}/${projectId}/users`,
    );
  }

  async changeProjectUserRole(
    projectId: string,
    projectUserId: string,
    params: ChangeProjectUserRoleParams,
  ) {
    return await this.#requestApi<ProjectUser>(
      'PUT',
      `${PROJECT_PATH}/${projectId}/user/${projectUserId}`,
      {
        body: JSON.stringify(params),
        contentType: 'application/json',
      },
    );
  }

  async removeProjectUser(projectId: string, projectUserId: string) {
    return await this.#requestApi<void>(
      'DELETE',
      `${PROJECT_PATH}/${projectId}/user/${projectUserId}`,
    );
  }

  // ─── Project Apps ───

  async addAppToProject(projectId: string, appId: string) {
    return await this.#requestApi<ProjectApp>(
      'POST',
      `${PROJECT_PATH}/${projectId}/app`,
      {
        body: JSON.stringify({ appId }),
        contentType: 'application/json',
      },
    );
  }

  async listProjectApps(projectId: string) {
    return await this.#requestApi<ProjectApp[]>(
      'GET',
      `${PROJECT_PATH}/${projectId}/apps`,
    );
  }

  async removeAppFromProject(projectId: string, appId: string) {
    return await this.#requestApi<void>(
      'DELETE',
      `${PROJECT_PATH}/${projectId}/app/${appId}`,
    );
  }

  // ─── Project Storage ───

  async listProjectFiles(projectId: string) {
    return await this.#requestApi<Item[]>(
      'GET',
      `${PROJECT_PATH}/${projectId}/files`,
    );
  }

  async listProjectFolders(projectId: string) {
    return await this.#requestApi<ItemFolder[]>(
      'GET',
      `${PROJECT_PATH}/${projectId}/folders`,
    );
  }

  // ─── Project Events ───

  async createProjectEventHook(
    projectId: string,
    params: CreateEventHookParams,
  ) {
    return await this.#requestApi<EventHook>(
      'POST',
      `${PROJECT_PATH}/${projectId}/events/hooks`,
      {
        body: JSON.stringify(params),
        contentType: 'application/json',
      },
    );
  }

  async listProjectEventHooks(projectId: string) {
    return await this.#requestApi<EventHook[]>(
      'GET',
      `${PROJECT_PATH}/${projectId}/events/hooks`,
    );
  }

  async updateProjectEventHook(
    projectId: string,
    hookId: string,
    params: UpdateEventHookParams,
  ) {
    return await this.#requestApi<EventHook>(
      'PATCH',
      `${PROJECT_PATH}/${projectId}/events/hooks/${hookId}`,
      {
        body: JSON.stringify(params),
        contentType: 'application/json',
      },
    );
  }

  async deleteProjectEventHook(projectId: string, hookId: string) {
    return await this.#requestApi<void>(
      'DELETE',
      `${PROJECT_PATH}/${projectId}/events/hooks/${hookId}`,
    );
  }

  async listProjectEventLogs(projectId: string) {
    return await this.#requestApi<EnrichedEventLog[]>(
      'GET',
      `${PROJECT_PATH}/${projectId}/events/logs/enriched`,
    );
  }

  // ─── Events (Personal) ───

  async createEventHook(params: CreateEventHookParams) {
    return await this.#requestApi<EventHook>(
      'POST',
      `${EVENTS_PATH}/hooks`,
      {
        body: JSON.stringify(params),
        contentType: 'application/json',
      },
    );
  }

  async listEventHooks() {
    return await this.#requestApi<EventHook[]>(
      'GET',
      `${EVENTS_PATH}/hooks`,
    );
  }

  async updateEventHook(hookId: string, params: UpdateEventHookParams) {
    return await this.#requestApi<EventHook>(
      'PATCH',
      `${EVENTS_PATH}/hooks/${hookId}`,
      {
        body: JSON.stringify(params),
        contentType: 'application/json',
      },
    );
  }

  async deleteEventHook(hookId: string) {
    return await this.#requestApi<void>(
      'DELETE',
      `${EVENTS_PATH}/hooks/${hookId}`,
    );
  }

  async listEventLogs() {
    return await this.#requestApi<EnrichedEventLog[]>(
      'GET',
      `${EVENTS_PATH}/logs`,
    );
  }

  async listEventLogExecutions(logId: string) {
    return await this.#requestApi<ExecutionEntity[]>(
      'GET',
      `${EVENTS_PATH}/logs/${logId}/executions`,
    );
  }

  async retryEventLog(logId: string) {
    return await this.#requestApi<{ message: string }>(
      'POST',
      `${EVENTS_PATH}/logs/${logId}/retry`,
    );
  }

  // ─── Tokens ───

  async createToken(params: CreateTokenParams) {
    return await this.#requestApi<AccessTokenInfo>(
      'POST',
      TOKENS_PATH,
      {
        body: JSON.stringify(params),
        contentType: 'application/json',
      },
    );
  }

  async listTokens() {
    return await this.#requestApi<AccessTokenInfo[]>('GET', TOKENS_PATH);
  }

  async getToken(tokenId: string) {
    return await this.#requestApi<AccessTokenInfo>(
      'GET',
      `${TOKENS_PATH}/${tokenId}`,
    );
  }

  async getTokenValue(tokenId: string) {
    return await this.#requestApi<string>(
      'GET',
      `${TOKENS_PATH}/${tokenId}/token`,
    );
  }

  async updateToken(tokenId: string, params: UpdateTokenParams) {
    return await this.#requestApi<AccessTokenInfo>(
      'PUT',
      `${TOKENS_PATH}/${tokenId}`,
      {
        body: JSON.stringify(params),
        contentType: 'application/json',
      },
    );
  }

  async deleteToken(tokenId: string) {
    return await this.#requestApi<void>(
      'DELETE',
      `${TOKENS_PATH}/${tokenId}`,
    );
  }

  // ─── Account ───

  async getCurrentAccount() {
    return await this.#requestApi<Account>('GET', `${ACCOUNT_PATH}/me`);
  }

  async updateAccount(accountId: string, params: UpdateAccountParams) {
    return await this.#requestApi<Account>(
      'PUT',
      `${ACCOUNT_PATH}/${accountId}`,
      {
        body: JSON.stringify(params),
        contentType: 'application/json',
      },
    );
  }

  // ─── Permissions ───

  async checkPermission(params: {
    resourceId: string;
    resourceType: string;
    action: string;
    projectId: string;
  }) {
    return await this.#requestApi<{ hasPermission: boolean }>(
      'GET',
      `${PROJECT_PATH}/permissions/check`,
      { query: params },
    );
  }

  async #getItem<T = Item>(itemId: string, props?: GetItemProps) {
    const { showVersions = false } = props || {};
    return await this.#requestApi<ItemWithVersions<T>>(
      'GET',
      `${ITEM_PATH}/${itemId}`,
      {
        query: { showVersions },
      },
    );
  }

  #cleanData(data?: object) {
    return (
      data &&
      Object.entries(data)
        .filter(([, value]) => value !== undefined)
        .reduce(
          (obj, [key, value]) => {
            obj[key as string] = value;
            return obj;
          },
          {} as { [key: string]: unknown },
        )
    );
  }
}
