import { Metadata } from './files';
import { ItemFolder, ItemVersion } from './items';

/**
 * Maximum number of ids the API accepts in one batch request. The client
 * methods split larger inputs into chunks of this size automatically.
 */
export const STORAGE_BATCH_MAX = 100;

export type BatchError = {
  status: number;
  message: string;
};

export type HiddenFileSignedUrlBatchEntry = {
  hiddenFileId: string;
  url?: string;
  expiresAt?: string;
  error?: BatchError;
};

export type ItemVersionsBatchEntry = {
  itemId: string;
  versions?: ItemVersion[];
  error?: BatchError;
};

export type VersionMetadataBatchRequest = {
  itemId: string;
  versionTag: string;
};

export type VersionMetadataBatchEntry = VersionMetadataBatchRequest & {
  metadata?: Metadata;
  error?: BatchError;
};

export type ItemFoldersBatchEntry = {
  folderId: string;
  folder?: ItemFolder;
  error?: BatchError;
};
