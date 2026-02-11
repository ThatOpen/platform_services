import { Base } from './base';

export type TokenPermissionScope = 'STORAGE' | 'COMPONENT';

export type BasicTokenPermissionAccess =
  | 'READ'
  | 'WRITE'
  | 'DOWNLOAD'
  | 'DELETE';

export type SpecialTokenPermission = 'COMPONENT:EXECUTE' | 'ALL';

export type TokenPermission =
  | `${TokenPermissionScope}:${BasicTokenPermissionAccess}`
  | SpecialTokenPermission;

export interface AccessTokenInfo extends Base {
  name: string;
  permissions: TokenPermission[];
  urlRestrictions: string[];
  requestCount: number;
  lastUsedAt?: string;
  tokenValue?: string;
  expiresAt?: Date;
  isHidden?: boolean;
}

export type CreateTokenParams = {
  name: string;
  permissions: TokenPermission[];
  urlRestrictions: string[];
};

export type UpdateTokenParams = {
  name?: string;
  permissions?: TokenPermission[];
  urlRestrictions?: string[];
};
