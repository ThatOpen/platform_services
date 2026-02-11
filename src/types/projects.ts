import { Base, ObjectId } from './base';

export type PermissionSubject =
  | 'PROJECT'
  | 'MEMBERS'
  | 'ROLES'
  | 'APP'
  | 'STORAGE'
  | 'EVENTS'
  | 'ALL';

export type PermissionAction =
  | 'CREATE'
  | 'READ'
  | 'UPDATE'
  | 'DELETE'
  | 'MANAGE';

export interface ResourcePermission {
  resourceId: ObjectId;
  removePermission?: boolean;
}

export interface Permission {
  action: PermissionAction;
  subject?: PermissionSubject;
  resourcePermissions?: ResourcePermission[];
}

export interface Project extends Base {
  title: string;
  description?: string;
}

export interface ProjectApp extends Base {
  projectId: ObjectId;
  appId: ObjectId;
}

export interface ProjectRole extends Base {
  projectId: ObjectId;
  name: string;
  description?: string;
  permissions: Permission[];
  fixed?: boolean;
}

export interface ProjectUser extends Base {
  projectId: ObjectId;
  projectRoleId?: ObjectId;
  accountId: ObjectId;
}

export interface ProjectWithRole {
  project: Project;
  role: ProjectRole | null;
}

export interface ProjectUserWithRole {
  projectUserId: string;
  user: Account;
  role: ProjectRole;
}

export type CreateProjectParams = {
  title: string;
  description?: string;
};

export type UpdateProjectParams = {
  title?: string;
  description?: string;
};

export type CreateProjectRoleParams = {
  name: string;
  description?: string;
  permissions: Permission[];
};

export type UpdateProjectRoleParams = {
  name?: string;
  description?: string;
  permissions?: Permission[];
};

export type AddProjectUserParams = {
  accountId: string;
  projectRoleId?: string;
};

export type ChangeProjectUserRoleParams = {
  projectRoleId?: string | null;
};

// Inline import to avoid circular deps
import { Account } from './accounts';
