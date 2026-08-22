# thatopen-services

## 0.10.0

### Minor Changes

- 3d53d8e: Add batch read methods so a page of files, or a model's tiles, can be hydrated in one request instead of one per id.

  - `getHiddenFileSignedUrlsBatch(hiddenIds, expiresIn?)` — signs many hidden files at once. This is the call tile-based viewers (splats, point clouds) should use; minting one URL per tile as the camera moves is what pushes a single session past the rate limit.
  - `listVersionsBatch(itemIds, { archived? })` — versions for many items. The records carry their metadata, so a list that only needs metadata does not need a second call.
  - `getFileVersionMetadataBatch(entries, { withDraft? })` — metadata for many `{ itemId, versionTag }` pairs.
  - `getFoldersBatch(folderIds)` — resolves a known set of folder ids.

  All four split inputs longer than `STORAGE_BATCH_MAX` (100) into several requests automatically, return entries in request order, and mark an id the caller cannot read with an `error` instead of failing the whole batch.

  Requires the matching backend endpoints (`POST /item/hidden/signed-url/batch`, `POST /item/batch/versions`, `POST /item/batch/version-metadata`, `POST /item/batch/folders`).

## 0.9.1

### Patch Changes

- 94e91d4: Add `outcome`, `groupKey` and `groupLabel` to `NotificationDto`, matching what
  the API already returns.

  Read `outcome` to tell how an automation run ended rather than matching on the
  copy: `title` is built from the user's own automation name, so an automation
  called "Failover sync" makes every successful run look failed to anything
  parsing the text. `groupKey` and `groupLabel` are what a client needs to
  collapse a busy automation's runs into one row.

## 0.9.0

### Minor Changes

- 9660e7d: Add notification methods to `PlatformClient`: `getNotifications`,
  `getUnreadNotificationCount`, `markNotificationsRead`,
  `markAllNotificationsRead`, `getNotificationSubscriptions` and
  `unsubscribeFromAutomation`. All scoped to the signed-in user via the
  bearer token an app already has.

  The notification types mirror the backend's wire DTOs in `src/types`, the
  same as every other type here.

- 9660e7d: Add `subscribeToAutomation` and `updateAutomationSubscription`, so an app can
  create a subscription rather than only listing and cancelling one.

  Add `onNotification`, a live socket subscription for the signed-in user.
  Unlike `onExecutionProgress` it stays connected for the session rather than
  closing on a terminal event, and it returns a function that disconnects.

## 0.8.0

### Minor Changes

- Two commands that collapse the work of about a dozen.

  `thatopen revit share --file <path> --project <id> [--doc <name>]` takes a `.rvt` on disk to your
  own local open in Revit. It installs the add-in when nothing is listening, starts Revit and waits
  for it, checks whether the file is already a central, publishes it, and joins. Five named steps, so
  a long silence is always something you can point at. It accepts the dashboard URL as well as the
  project id, derives `--doc` from the file name, and always works on a copy. The pieces it drives
  are unchanged and still available on their own.

  `thatopen create <name> --beta --history` scaffolds an app with the revit-flow commit history panel
  already wired, opening on the History layout. It swaps in a whole `main.ts` rather than patching
  one: the wiring is four additions in three places and the order between them is load-bearing.

## 0.7.0

### Minor Changes

- History commits are named by guid, and a commit's parents are a list.

  The built-in history types described a schema the shipped component no longer speaks. A commit's
  `id: number` is now `guid: string`: the integer was the platform's storage version, a number the CDE
  hands out, and an application that does not push through a Revit central has none. It survives as
  `version`, data rather than identity, with `ordinal` derived from the graph for ordering questions.

  `parent: number | null` is now `parents?: string[]`. A fork was already expressible with one parent;
  a merge needs both lines named. Revit never writes more than one.

  Also declared here rather than reimplemented per app: `deltaId` (the hidden-file id of a commit's
  delta geometry, absent on the baseline), the proposal types, and the panel's own state.

  The Rhino guide gains the converter step: what Rhino publishes, the units contract, one `localId`
  per `CREATE_ITEM`, and the two upload fields that fail at runtime rather than at compile time.

## 0.6.0

### Minor Changes

- 01bcb5b: Export the `GitHistoryManager` built-in, so an app can use the revit-flow history.

  The component and its panel (`top-git-history`) are published and the platform serves them by
  UUID, but nothing in this package named them: `import { GitHistoryManager } from
"@thatopen/services"` did not compile, which is the first line of any app that wants to show a
  model's history. Verified against the published tarball — `UIManager` was in it and
  `GitHistoryManager` appeared in no file at all.

  It reads the history the Revit add-in publishes per sync and colours a commit's changed elements
  in the shared viewer: green created, blue modified, red deleted.

## 0.5.0

### Minor Changes

- 31576b1: CLI: `thatopen revit install` and `thatopen rhino install` (both aliased as `update`) install the
  That Open Revit add-in and Rhino plug-in from their private npm packages.

  Access comes from the platform token, the same way `--beta` gets the private engine libraries: the
  CLI trades it for read-only registry credentials, so nobody needs an npm account or an npm token.

  npm does the downloading, the version resolution and the integrity check, rather than this
  hand-rolling HTTP and getting one of the three subtly wrong. The Revit package ships its own
  `install.ps1`, so the CLI never has to know where Revit keeps its add-ins; the Rhino package is
  installed through Yak, which records the Rhino versions the plug-in targets and refuses to install
  into one it was not built for.

  Both refuse while the host application is running. That is the difference between a failed install
  and a broken one: Revit and Rhino hold their plug-in assemblies open for the whole session, so a
  copy over a running host fails on the first locked file _after_ copying the ones it reached, leaving
  a folder with some new DLLs and some old that loads and misbehaves.

  This is also why installing is the CLI's job at all. A Revit add-in cannot replace itself while
  Revit runs, so it can only notice it is out of date and say so; the CLI is what runs with Revit
  closed.

## 0.4.0

### Minor Changes

- e4452e7: Add `PlatformClient.getAvatar(accountId)` to fetch a user's profile picture as an image `Blob`, so apps can render member avatars.

## 0.3.15

### Patch Changes

- Rename the Revit add-in auth header to `X-RevitFlow-Token` (revit-flow rebrand of the former "BT3" collaboration add-in). Requires the matching revit-flow add-in build. Also updates the `revit` command/lib comments and the collaboration quickstart guide.

## 0.3.6

### Patch Changes

- Add `getHiddenFileSignedUrl(hiddenId, expiresIn?)` to the client — returns a short-lived signed URL so large hidden files (e.g. a point cloud's `octree.bin`) can be fetched directly with native HTTP `Range` requests instead of downloading the whole object.

- Fix scaffolded apps failing to build with `Dynamic require of "https://cdn.jsdelivr.net/npm/…/+esm" is not supported`. Some three.js example loaders (e.g. `TTFLoader`, pulled in by `components-front-beta`) import their deps from a jsdelivr `/+esm` CDN URL, which a bundler can't place in an IIFE. `thatopen serve` and the app template's `vite build` now rewrite such URLs to the local package; the template also depends on `opentype.js` and pins `three` to `0.185.0` so a future three release can't reintroduce a different CDN import.

## 0.2.0

### Minor Changes

- 30a9034: CLI: auto-configure `.npmrc` for private beta packages.

  `thatopen create --beta` (and `thatopen login` inside a beta project) now fetch
  read-only npm credentials from the platform and write a project `.npmrc`, so
  `npm install` of the private `@thatopen-platform/*-beta` packages just works for
  Founding members — no manual token setup. Adds
  `EngineServicesClient.getNpmCredentials()` and exports the `NpmCredentials` type.

## 0.1.3

### Patch Changes

- 6f845c1: Republish attempt — ship `createHiddenFilesBatch` to npm.

## 0.1.2

### Patch Changes

- 067b1af: Republish attempt — ship `createHiddenFilesBatch` to npm now that publish
  credentials are configured.

## 0.1.1

### Patch Changes

- 15d6c25: Republish — the 0.1.0 release (which added `createHiddenFilesBatch`) failed to
  publish to npm on an expired token. This ships that change.

## 0.1.0

### Minor Changes

- 4568b81: Add `EngineServicesClient.createHiddenFilesBatch()` to upload many hidden files
  in a single request, for large 3D-tile sets (point clouds / gaussian splats)
  without hitting the per-file upload throttle. Exports the
  `CreateHiddenItemsBatchResult` type.

## 0.18.0

### Minor Changes

- b598e3c: Surface structured API errors via a new RequestError class

## 0.17.0

### Minor Changes

- e4fbb63: Per-version free-JSON metadata for files. Replaces the old single-endpoint `getFileMetadata` with three explicit version-scoped methods aligned with the new backend CRUD on `/item/:id/version/:tag/metadata`.

  **New methods.**
  - `getFileVersionMetadata(fileId, versionTag, params?)` — `GET /item/:id/version/:tag/metadata`. Returns `{}` when the version exists but has no metadata.
  - `updateFileVersionMetadata(fileId, versionTag, metadata)` — `PUT …/metadata`. Replaces the version's metadata with the provided object.
  - `deleteFileVersionMetadata(fileId, versionTag)` — `DELETE …/metadata`. Clears the version's metadata.

  **New types and constants.** `Metadata = Record<string, MetadataValue>`, `MetadataValue = string | number | boolean | null`, and `METADATA_LIMITS` (200 fields, 50-char keys, 50-char values) are exported from the package root. `metadata` is now typed as `Metadata` everywhere it appears: `CreateItemProps`, `UpdateItemProps`, `createVersion`'s optional last argument.

  **Breaking.** `getFileMetadata(itemId, params?)` is removed. It hit `GET /item/:id/metadata`, which has been deleted on the backend in favour of the version-scoped routes. Replace with `getFileVersionMetadata(fileId, versionTag, params?)` — the version tag is now required because metadata is per-version. To target the live version, pass the tag of the latest non-draft version (the equivalent of the old default behaviour).

  **Migration.**

  ```ts
  // before
  const metadata = await client.getFileMetadata(fileId);

  // after
  const metadata = await client.getFileVersionMetadata(fileId, 'v1');
  ```

  `createFile`, `updateFile`, and `createVersion` continue to accept an optional `metadata` argument; the only change is the type — values can now be `string | number | boolean | null` instead of just `string`.

## 0.16.0

### Minor Changes

- 9f124f1: Add per-version lifecycle methods so callers can list, archive, recover, and permanently delete a single version of an item.
  - `listVersions(itemId, { archived })` — `GET /item/:itemId/versions`. Pass `archived: true` to receive only archived versions, `false` for active only, or omit the option to receive both. Sorted by creation date descending.
  - `archiveVersion(itemId, versionTag)` — `PUT /item/:itemId/version/:versionTag/archive`. Archived versions are hidden from the active list and queued for cleanup after the platform's retention window.
  - `recoverVersion(itemId, versionTag)` — `PUT /item/:itemId/version/:versionTag/recover`. Returns an archived version to the active list.
  - `deleteVersion(itemId, versionTag)` — `DELETE /item/:itemId/version/:versionTag`. The version must be archived first; the backend rejects the call otherwise. Removes the underlying object from S3 in addition to the database row.

  All four go through the existing request layer, so they work with both auth modes (`accessToken` query string for API tokens, `Authorization: Bearer …` for `PlatformClient` JWTs).

## 0.15.0

### Minor Changes

- 3a0b129: Send named File (with filename and mimetype) for bundle and icon uploads in the publish command.

## 0.14.0

### Minor Changes

- b108648: Align the client with the platform's new project-scoped permissions model and split the client surface for apps vs components.

  **New: `PlatformClient`.** Extends `EngineServicesClient` with a bearer-only constructor. Use it from apps, frontends, and any caller authenticating with a user JWT. On top of the inherited API-token-compatible surface, `PlatformClient` owns the JWT-only routes `getProject`, `getProjectData`, `checkPermission`, and `checkPermissionBatch` — those hit `ProjectController` on the backend which is guarded by JWT, so they're not reachable from an access token. `EngineServicesClient` remains the right choice for components (API-token auth, local server, WebSocket progress).

  The `PlatformClient` constructor accepts either a static JWT string **or a provider function** (`() => string | Promise<string>`) that's called on every request — so Auth0's `getAccessTokenSilently()` and similar refreshing sources can be passed directly and expired tokens never stick. `PlatformClient.fromPlatformContext()` is available as a static factory for apps running inside the platform iframe.

  **Project-scoped listings on the main list methods.** `listFiles`, `listFolders`, `listApps`, and `listComponents` now accept an optional `projectId` and forward it to the new public `GET /item?projectId=X` / `GET /item/folder?projectId=X` routes. Per-entity role overrides are applied server-side; callers without project role permission get 403 (not an empty list). Pass `itemType: 'APP' | 'TOOL' | 'FILE'` to switch what comes back.

  **Updated permission checks.** `checkPermission` now returns `{ hasPermission, scope }` where `scope` is `'global' | 'project' | 'entity' | 'none'`. New `checkPermissionBatch(checks)` evaluates multiple checks in one round-trip.

  **Execution scoping.** `executeComponent` accepts `projectId` as a reserved key on `executionParams`; foreign project ids are rejected by the backend. `listExecutions(componentId, projectId?)` forwards the query param.

  **Breaking.** The v1 convenience helpers `listProjectFiles`, `listProjectFolders`, `listProjectApps`, `listProjectComponents` are removed. They pointed at JWT-only `/project/:id/*` routes, which was the wrong target for an API-token client. Replace with `listFiles({ projectId })` / `listFolders({ projectId })` / `listApps({ projectId })` / `listComponents({ projectId })`.

### Patch Changes

- d92f4e9: update @thatopen dependencies to version 3.4.0 across templates

## 0.13.1

### Patch Changes

- 09341b5: fix: update default login API URL

## 0.13.0

### Minor Changes

- 7ce2d0f: templates refactor to align them with SKILL patterns

## 0.12.0

### Patch Changes

- 28cd180: Updates templates to use new app setup logic

## 0.11.1

### Patch Changes

- 626d202: better type handling for built-in components

## 0.11.0

### Minor Changes

- rebuild built-in types

## 0.10.0

### Minor Changes

- c6516d0: Deploy new version

## 0.9.0

### Minor Changes

- Rename `client.initApp()` to `client.setup()` for a cleaner API surface

## 0.8.0

### Minor Changes

- b7949c0: Add icon support for items (apps, components, files).

  **Library:** New `uploadItemIcon`, `getItemIcon`, and `removeItemIcon` methods on `EngineServicesClient` for managing item icons via the `PUT/GET/DELETE /api/item/:id/icon` endpoints. Accepts PNG, WebP, and ICO images up to 512 KB.

  **CLI:** `thatopen publish --icon <path>` uploads an icon after publishing. The icon path is saved to `.thatopen` config so subsequent publishes reuse it automatically.

## 0.7.0

### Minor Changes

- 5e75861: Adds dev improvements

## 0.6.1

### Patch Changes

- Improve naming

## 0.6.0

### Minor Changes

- Adding parameters related to metadata in items

## 0.5.7

### Patch Changes

- Allow for parentId when creating folders

## 0.5.6

### Patch Changes

- Allow for fetching with versions for components

## 0.5.5

### Patch Changes

- Improve hidden items

## 0.5.4

### Patch Changes

- Add hidden files

## 0.5.3

### Patch Changes

- fix error result

## 0.5.2

### Patch Changes

- Remove axios | add retries

## 0.5.1

### Patch Changes

- Fix execution callback

## 0.5.0

### Minor Changes

- File download improvements

## 0.4.11

### Patch Changes

- Fix socket connect

## 0.4.10

### Patch Changes

- fix execute not sending params

## 0.4.9

### Patch Changes

- Add abortExecution

## 0.4.8

### Patch Changes

- Add standard downloadComponent function

## 0.4.7

### Patch Changes

- Return bundle from downloadComponentBundle

## 0.4.6

### Patch Changes

- Fix get file

## 0.4.5

### Patch Changes

- improve types

## 0.4.4

### Patch Changes

- Add show versions parameter to item fetch

## 0.4.3

### Patch Changes

- Remove socket return from progress

## 0.4.2

### Patch Changes

- Improve returning types

## 0.4.1

### Patch Changes

- fix typings

## 0.4.0

### Minor Changes

- Adding execution function and listeners

## 0.3.2

### Patch Changes

- Change types in component creation

## 0.3.1

### Patch Changes

- Allow creation of drafts

## 0.3.0

### Minor Changes

- Add execution params

## 0.2.9

### Patch Changes

- Move extraProps to version data

## 0.2.8

### Patch Changes

- Fix folders not being sent

## 0.2.7

### Patch Changes

- Fix accept method in result

## 0.2.6

### Patch Changes

- Fix fetch content type

## 0.2.5

### Patch Changes

- Cleanup query object in main function

## 0.2.4

### Patch Changes

- Fix optional fields in list functions

## 0.2.3

### Patch Changes

- return proper error message

## 0.2.2

### Patch Changes

- Add more verbosity to error

## 0.2.1

### Patch Changes

- Fix issue with empty json responses

## 0.2.0

### Minor Changes

- Replace axios with fetch for a better dev experience

## 0.1.10

### Patch Changes

- Add generics and responseType to file downloads

## 0.1.9

### Patch Changes

- Change return type of downloads to ReadableStream

## 0.1.8

### Patch Changes

- remove type module

## 0.1.7

### Patch Changes

- remove gaxios due to a bug in the browser

## 0.1.6

### Patch Changes

- Added Stream return type to downloads

## 0.1.5

### Patch Changes

- - Improved build
  - Fixed minor bugs
  - Improved lint for dev experience

## 0.1.4

### Patch Changes

- - File and folder download functions

## 0.1.3

### Patch Changes

- add build
- fix build not working

## 0.1.1

### Patch Changes

- Allow for creation and update of components

## 0.1.0

### Minor Changes

- Fix issues with folders and files | add recovering
