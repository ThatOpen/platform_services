import { ItemType } from './items';

export type CreateItemDto = {
  name?: string;
  fileExtension?: string;
  versionTag?: string;
  folderId?: string;
  file: File;
  itemType?: ItemType;
};

export type UpdateItemDto = {
  name?: string;
  folderId?: string;
};

export type CreateItemVersionDto = {
  versionTag: string;
  file: File;
};

export type CreateItemFolderDto = {
  name: string;
};

export type UpdateItemFolderDto = {
  name: string;
};
