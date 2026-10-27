/** What an API token may do: `ALL`, or one action on one kind of resource. */
export type AccessTokenPermission =
  | 'ALL'
  | 'COMPONENT:EXECUTE'
  | `${'APP' | 'COMPONENT' | 'STORAGE'}:${'READ' | 'WRITE' | 'DOWNLOAD' | 'DELETE'}`;

/** An API token as the platform lists it (its secret is fetched apart). */
export interface AccessToken {
  _id: string;
  name: string;
  permissions: AccessTokenPermission[];
  /** Where it may be used from; empty: anywhere. */
  urlRestrictions: string[];
  /** The projects it may act on; absent or empty: every project its owner can reach. */
  projectIds?: string[];
  requestCount: number;
  lastUsedAt?: string;
}

/** What is given to create a token. */
export interface NewAccessToken {
  name: string;
  permissions: AccessTokenPermission[];
  urlRestrictions?: string[];
  /** Limits the token to these projects. */
  projectIds?: string[];
}
