---
'@thatopen/services': minor
---

PlatformClient administers a project's people and permissions: `listMembers`, `addMember`, `setMemberRole`, `removeMember`, `inviteMember`, `listInvitations`, `cancelInvitation`, `listRoles`, `createRole`, `updateRole`, `deleteRole` and `getPermissionMatrix` (every role, what it may do — folder grants included — and who has it). `Permission` gains `resourcePermissions` (a grant or removal on one file or folder, optionally for everything under it) and `PermissionSubject` gains `'API'`.
