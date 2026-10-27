import { Base, ObjectId } from './base';

export type PermissionSubject =
  | 'PROJECT'
  | 'MEMBERS'
  | 'ROLES'
  | 'APP'
  | 'STORAGE'
  | 'EVENTS'
  /**
   * Not a resource, a channel: whether a member may act on the project with an
   * API token at all. Checked on top of the subject the request is about.
   */
  | 'API'
  | 'ALL';

export type PermissionAction =
  | 'CREATE'
  | 'READ'
  | 'UPDATE'
  | 'DELETE'
  | 'MANAGE';

/**
 * An exception to a role's permission on ONE resource (a file or a folder): the
 * permission granted there only, or taken away there (`removePermission`). On a
 * folder, `appliesToDescendants` extends it to everything under it — how a role
 * sees one branch of the project and nothing else.
 */
export interface ResourcePermission {
  resourceId: string;
  removePermission?: boolean;
  appliesToDescendants?: boolean;
}

export interface Permission {
  action: PermissionAction;
  subject?: PermissionSubject;
  /** Per-resource grants or removals (see {@link ResourcePermission}). */
  resourcePermissions?: ResourcePermission[];
}

export interface Project extends Base {
  title: string;
  description?: string;
}

export interface ProjectRole extends Base {
  projectId: ObjectId;
  name: string;
  description?: string;
  permissions: Permission[];
  fixed?: boolean;
}

export interface ProjectWithRole {
  project: Project;
  role: ProjectRole | null;
}

// ─── Project Data DTO ─────────────────────────────────────────────

/** Stripped-down user info safe for app consumption. */
export interface ProjectDataUser {
  _id: string;
  fullName: string;
  email: string;
}

/** Where a project invitation stands. */
export type ProjectInvitationStatus = 'PENDING' | 'ACCEPTED' | 'REVOKED';

/** A pending (or past) invitation to a project, as the API lists it. */
export interface ProjectInvitation {
  _id: string;
  email: string;
  projectRoleId: string | null;
  status: ProjectInvitationStatus;
  createdAt: string;
  expiresAt: string;
}

/** A role's row of a project's permission matrix: what it may do, and who has it. */
export interface ProjectPermissionMatrixRow {
  role: ProjectRole;
  permissions: Permission[];
  members: ProjectDataUser[];
}

/** A project member with their role info. */
export interface ProjectDataMember {
  projectUserId: string;
  user: ProjectDataUser;
  role: ProjectRole;
}

/** Minimal file info for the project data. */
export interface ProjectDataFile {
  _id: string;
  name: string;
  fileExtension?: string;
  folderId?: string;
  itemType: string;
  createdAt: string;
}

/** Minimal folder info for the project data. */
export interface ProjectDataFolder {
  _id: string;
  name: string;
  parentId?: string;
}

/** Aggregated project data returned by `getProjectData()`. */
export interface ProjectData {
  project: Project;
  currentUser: ProjectDataMember | null;
  users: ProjectDataMember[];
  roles: ProjectRole[];
  files: ProjectDataFile[];
  folders: ProjectDataFolder[];
}
