import axios, { Method } from 'axios';
import {
  ComponentItem,
  ComponentProps,
  Item,
  ItemFolder,
} from '../types/items';
import { UpdateItemDto, UpdateItemFolderDto } from '../types/item.dto';

const FOLDER_PATH = 'item/folder';
const ITEM_PATH = 'item';
const ITEM_TYPE_FILE = 'FILE';
const ITEM_TYPE_COMPONENT = 'TOOL';

export class EngineServicesClient {
  apiUrl: string;
  accessToken: string;

  constructor(accessToken: string, apiUrl: string) {
    let url = apiUrl;
    if (url.charAt(url.length - 1) === '/') {
      url = url.slice(0, -1);
    }
    this.apiUrl = url;
    this.accessToken = accessToken;
  }

  #buildUrl(path: string) {
    return `${this.apiUrl}/${path}`;
  }

  async #requestApi<T = any>(
    method: Method,
    path: string,
    requestData?: { body?: any; query?: any },
  ) {
    const { body, query } = requestData || {};
    const url = this.#buildUrl(path);

    const params = {
      ...query,
      accessToken: this.accessToken,
    };

    const response = await axios.request({ method, url, data: body, params });

    return response.data as T;
  }

  async listFolders(parentFolderId?: string) {
    return await this.#requestApi<ItemFolder[]>('GET', FOLDER_PATH, {
      query: parentFolderId,
    });
  }

  async getFolder(folderId: string) {
    return await this.#requestApi<ItemFolder>(
      'GET',
      `${FOLDER_PATH}/${folderId}`,
    );
  }

  // TODO allow nested folders
  async createFolder(name: string, parentFolderId?: string) {
    return await this.#requestApi<ItemFolder>('POST', FOLDER_PATH, {
      body: { name, parentFolderId },
    });
  }

  async updateFolder(
    folderId: string,
    updateFolderParams: { name?: string; parentFolderId?: string },
  ) {
    const { name, parentFolderId } = updateFolderParams;
    return await this.#requestApi<ItemFolder>(
      'PUT',
      `${FOLDER_PATH}/${folderId}`,
      {
        body: { name, parentFolderId } as UpdateItemFolderDto,
      },
    );
  }

  async archiveFolder(folderId: string) {
    return await this.#requestApi<ItemFolder>(
      'DELETE',
      `${FOLDER_PATH}/${folderId}`,
    );
  }

  async listFiles(folderId?: string) {
    if (folderId) {
      return await this.#requestApi<ItemFolder[]>(
        'GET',
        `${ITEM_PATH}/${folderId}/items`,
        { query: { itemType: ITEM_TYPE_FILE } },
      );
    }
    return await this.#requestApi<Item[]>('GET', `${ITEM_PATH}`, {
      query: { itemType: ITEM_TYPE_FILE },
    });
  }

  async getFile(fileId: string) {
    return await this.#requestApi<Item>('GET', `${ITEM_PATH}/${fileId}`);
  }

  async createFile(fileData: {
    file: File;
    name: string;
    versionTag: string;
    parentFolderId?: string;
  }) {
    const { name, versionTag, parentFolderId, file } = fileData;
    const formData = new FormData();
    formData.append('file', file);
    formData.append('name', name);
    formData.append('versionTag', versionTag);
    parentFolderId && formData.append('folderId', parentFolderId);

    return await this.#requestApi<Item>('POST', ITEM_PATH, {
      body: formData,
    });
  }

  async updateFile(
    fileId: string,
    fileData: {
      name?: string;
      parentFolderId?: string;
      file?: File;
      versionTag?: string;
    },
  ) {
    const { name, versionTag, parentFolderId, file } = fileData;
    if (file) {
      const formData = new FormData();
      formData.append('file', file);
      versionTag && formData.append('versionTag', versionTag);
      await this.#requestApi<Item>('POST', `${ITEM_PATH}/${fileId}/version`, {
        body: formData,
      });
    }
    const body: UpdateItemDto = { name, folderId: parentFolderId };
    return await this.#requestApi<Item>('PUT', `${ITEM_PATH}/${fileId}`, {
      body,
    });
  }

  async archiveFile(fileId: string) {
    return await this.#requestApi<Item>('DELETE', `${ITEM_PATH}/${fileId}`);
  }

  async listComponents(folderId?: string) {
    if (folderId) {
      return await this.#requestApi<ItemFolder[]>(
        'GET',
        `${ITEM_PATH}/${folderId}/items`,
        { query: { itemType: ITEM_TYPE_COMPONENT } },
      );
    }
    return await this.#requestApi<ComponentItem[]>('GET', `${ITEM_PATH}`, {
      query: { itemType: ITEM_TYPE_COMPONENT },
    });
  }

  async getComponent(componentId: string) {
    return await this.#requestApi<ComponentItem>(
      'GET',
      `${ITEM_PATH}/${componentId}`,
    );
  }

  async createComponent(componentData: {
    name: string;
    versionTag: string;
    parentFolderId?: string;
    componentInfo: ComponentProps;
  }) {
    const { name, versionTag, parentFolderId, componentInfo } = componentData;
    return await this.#requestApi<ComponentItem>('POST', ITEM_PATH, {
      body: {
        name,
        versionTag,
        parentFolderId,
        extraProps: componentInfo,
      },
    });
  }

  async updateComponent(
    componentId: string,
    componentData: {
      file?: File;
      name?: string;
      parentFolderId?: string;
      versionTag?: string;
      componentInfo?: ComponentProps;
    },
  ) {
    const { name, versionTag, parentFolderId, componentInfo, file } =
      componentData;
    if (file) {
      const formData = new FormData();
      formData.append('file', file);
      versionTag && formData.append('versionTag', versionTag);
      await this.#requestApi<Item>(
        'POST',
        `${ITEM_PATH}/${componentId}/version`,
        {
          body: formData,
        },
      );
    }
    return await this.#requestApi<ComponentItem>(
      'PUT',
      `${ITEM_PATH}/${componentId}`,
      {
        body: { name, versionTag, parentFolderId, componentInfo },
      },
    );
  }

  async archiveComponent(componentId: string) {
    return await this.#requestApi<ComponentItem>(
      'DELETE',
      `${ITEM_PATH}/${componentId}`,
    );
  }
}
