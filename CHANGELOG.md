# thatopen-services

## 0.32.0

### Minor Changes

- ff9c491: Fewer platform calls, for every app at once (Antonio, 23-10: DEV allows 100 a minute per person and opening a project went over it).
  - A GET identical to one in flight, or answered less than 2 s ago, gets that response instead of going out again. Any write clears the cache.
  - `documents` reads each `document.json` once per version, found through the project's listing rather than one listing per folder. `history` uses the same listing.
  - `downloadFile` throws on a 429 or a 5xx instead of returning the error's body as if it were the file. Code that reads, edits and writes back must not write after a failed read.

## 0.31.2

### Patch Changes

- a130d57: Publishes what 0.31.0 and 0.31.1 carry (the `coordination` document type, the IFC→Revit recipe): both were versioned but stopped before npm by an unused function in the recipe, now exported.

## 0.31.1

### Patch Changes

- 5e80dd1: Publishes what 0.31.0 carries (the `coordination` document type, the IFC→Revit recipe): 0.31.0 was versioned but never reached npm, stopped by lint on an unused function in the recipe.

## 0.31.0

### Minor Changes

- db8312c: Documents: a fifth `DocumentType`, `'coordination'` ("Coordination set": a project's topics, kept as a BCF). `.bcf` and `.bcfzip` files read as coordination, and `list({ types: ['coordination'] })` lists the Coordinator's sets. The IFC→Revit recipe also improves: one prism family per profile however it is turned, structural columns where the file says so, shapes placed on their side share a family by their turn about Z, and a sloped footprint roof stands on its bottom at the eaves.
- de439fe: Streamed models are read from hidden files: `DocumentView` gains `hiddenId` (the view is a hidden file of `fileId`'s item, read by pieces with `getHiddenFileSignedUrl` / `getHiddenFileSignedUrlsBatch`) and `versionTag` (the version of `fileId` it was made from; a different current version means the view is stale). A streamed model's bundle is the view `{ fileId: <.frag item>, format: 'tostrm', hiddenId, versionTag }`, and `tostrm` reads as a `'bim'` document. `client.getFileSignedUrl`, published in 0.30.0 for a backend route that was never deployed, is removed: stream from hidden files.

## 0.30.0

### Minor Changes

- b9edad9: Document types: every document says what it is — `'bim' | 'drawings' | 'reality' | 'generic'` (`DocumentType`) — so each app's documents menu lists only what it works with. `DocumentDescriptor.type` is written by whoever makes the document (`fromFile(id, { type })`, `documents.setType(folderId, type)`); `documentTypeOf(descriptor)` answers it, reading a document made before types from its formats (rvt/ifc/frag/3dm → bim, dwg/dxf → drawings, las/laz/e57/potree/splat → reality, anything else → generic). `documents.list({ types })` filters by it, and `DOCUMENT_TYPES[type]` gives the label and icon every app shows.

  `client.getFileSignedUrl(fileId, { versionTag?, expiresIn? })`: a short-lived presigned URL for a regular file's content, fetched by HTTP Range straight from storage. It needs the backend route `GET /item/:itemId/signed-url`, not deployed yet: until then, stream from hidden files with `getHiddenFileSignedUrl`.

- a639311: Recipes are applied from the native application, in one go, with no proposals. Breaking:

  - `RecipeContext.targetDoc` → `target: { source, docId?, version? }`, plus `made`, `progress` and `kit`.
  - `RecipeRunOutcome` and `RecipePlan` are gone with the proposal flow.
  - The manifest's `rules` say `{ reads, writes }` (was `proposes`), and `ruleTallies` say `{ read, written }`.

  New:

  - `recipes.catalog()` lists the built-in recipes and the project's own.
  - `provideImporter(ext, importer)`: IFC to Revit converts a raw IFC with it, as its first step.
  - `provideShapes(ext, reader)`: doors, windows, furniture and the rest become families made from the file's own shapes.
  - `UpToDate` is thrown when a run has nothing to write.
  - `client.nextVersionTag` gives `v1`, `v2`… instead of timestamp tags.
  - History: a 'restore' version, the upload as its first step, and `streamId` (a version's delta as a streamed bundle).
  - IFC to Revit:
    - walls with their IFC layers, square ends and unfilled openings;
    - curtain walls, stairs, roofs, ceilings and rooms;
    - prism families with a length parameter;
    - columns at their own height;
    - shapes taken to the records' height.

## 0.29.1

### Patch Changes

- 6284916: `thatopen mcp`: using an app, not only building one. `send-app-command` reads the `app_id` from a dashboard URL that carries `/apps/<id>`, so the URL of the user's app tab is all a call needs, and its description tells the LLM to send `help` first and follow the app's own answer. The AI quickstart opens with a box for "use the app I have open" (MCP server, the tab's URL, `help` first) and `docs/cli/mcp.md` says the same.

## 0.29.0

### Minor Changes

- c85764c: Document drafts: `client.documents(projectId).drafts(folderId)` keeps each user's working copy of a document so that closing the browser never loses work — without ever creating a version or showing in the CDE. A draft is a hidden file under the document's `document.json`, tagged `draft:<userId>`. `put(blob, { userId, meta })` stores it and replaces that user's previous one (only the latest is kept); `list()` answers `{ userId, savedAt }` per user without downloading anything, `savedAt` being the server's time read from the hidden file's own id; `get({ userId? })` downloads `{ blob, meta, userId, savedAt }` (the newest of anyone without a userId); `delete({ userId })` removes them, typically on an explicit save. `meta` is free JSON the app chooses (base version, app, app version) and travels in a small envelope before the bytes.

## 0.28.2

### Patch Changes

- a9922c5: `ifc-to-revit` / `frag-to-revit`: walls and floors land at the right height. A wall run's `base` and a slab's `base` are RELATIVE to their level, and the recipe treated them as absolute, so every wall on a level above zero came out a full level lower and floors lost their offset. Walls now ask for `BaseOffset = base` with the line at `level + base`; floors carry `HeightOffset` (their top face above the level, base + thickness), which the Revit applier sets after creating them.

## 0.28.1

### Patch Changes

- 3cabaf2: `suggest()` and `sync()` now store the real hidden-file id of a payload or a delta. They read `_id`/`id` from the upload's answer, but `createHiddenFile` answers `{ hiddenFileId }`, so every suggestion with a payload was saved with `fragId: "undefined"` and every synced delta with `deltaId: "undefined"` — the Revit add-in then failed downloading `item/hidden/undefined`. A missing id now throws instead of being written. Entries written by 0.20–0.28 keep the broken pointer and have to be re-queued or repaired by hand.

## 0.28.0

### Minor Changes

- 8bd44b5: Whole buildings, not demos: `ifc-to-revit` and `frag-to-revit` now emit the building their records describe in ONE operation — levels first (ensured by name on the target, with their elevations), then every wall run as native wall adds (location line per straight segment, type by exact name with its `Type.Width` so a missing type is created by duplication, level, base offset, height), floors from slab profiles (boundary loops, holes included), columns, and opt-in free-standing instances. The grown Revit applier (flow `5dcf3f1`) materialises all of it natively — Wall.Create, Floor.Create, Level ensured, hosted instances via the new `flow:host` — and old appliers keep refusing wholesale through the existing all-or-nothing rollback; the protocol itself stays `revitflow/op@2`. What still waits (hosted doors/windows until the converter records their family, stairs, roofs, footings, curtain pieces) is read, tallied and said in the rules table. Verified offline against the real racbasic conversion: 225 changes — 6 levels, 47 walls, 13 floors, 2 columns, 157 instances — with the payload decoded back and every unit landing in feet.

## 0.27.0

### Minor Changes

- 8aa93c8: The model at a version, and explicit descriptor migration. `doc.model()` now SAYS what it is: the last full export (first commit or last publish), not the head — ordinary syncs only add hidden deltas. The new `doc.modelParts({ at? })` answers the ordered recipe for the model at any version: the baseline full export at-or-before it (with `current: false` plus the stored `storageVersion` when a later publish rewrote the visible file) and one step per later version — its delta's hidden id and the uniqueIds it removed. The consumer composes with its geometry engine (load baseline, replace by uniqueId per step, drop removed); composing a merged .frag is deliberately not done here. UniqueIds are the native app's stable element ids and survive syncs, machines and full exports. And `doc.ensureDescriptor()` migrates a pre-descriptor folder on purpose (model .frag becomes the 'frag' view) — reads never write.

## 0.26.1

### Patch Changes

- 4df6ad2: The built-in recipes' manifests and docs read correctly everywhere: 0.26.0 shipped them with mojibake (dashes, ellipses and apostrophes double-encoded by a PowerShell 5.1 round trip that reads BOM-less UTF-8 as ANSI). All recipe text is plain ASCII now.

## 0.26.0

### Minor Changes

- f3915e7: Built-in recipes and the frag reader. `readFrag(bytes)` reads a .frag's metadata and items (guids, categories, attributes) straight off the flatbuffer, no engine, no workers — on the same optional peers as `OperationBuilder`. `registerBuiltinRecipes(client)` ships the platform's own recipes: `rhino-to-revit` (the placed objects of a Rhino layer become Revit instances of a chosen type, reconciling new/moved/gone across runs, units and axes read from the source and refused when undeclared), plus `ifc-to-revit` and `frag-to-revit` (one engine reading the platform's semantic records — `Element`/`Carried` — out of a converted frag: columns on their levels and, opting in, free-standing family instances; walls, slabs and stairs are read and tallied but propose nothing until the Revit applier grows native creation, and the rules table says so). A plain IFC import without records is refused by name, never guessed at. Verified against a real converted model: levels resolve, styles split into Family:Type, positions land in feet.

## 0.25.0

### Minor Changes

- 95e08d0: Documents gain `list()` and `fromFile()`. `list()` answers every document of the project (folderId + validated descriptor) in one call for the app, parallelized inside. `fromFile(fileId, { name?, selfView? })` converts a loose file into a document: creates the folder next to the file, moves it in (moving preserves the id), and writes the descriptor — the file as `native`, and as `views[0]` when its format views itself (`SELF_VIEWING_FORMATS`: pdf/txt/md/json/csv/tsv/frag — deliberately not ifc, whose proper view is the processed frag). A file carrying the legacy `derivedFileId` link brings the derivative into the folder as a view, migrating the retired link concept into the folder-document shape.

## 0.24.0

### Minor Changes

- 8e42e13: `OperationBuilder` joins the SDK: authors an interoperability operation — geometry-less .frag, envelope `revitflow/op@2`, laid out exactly as the C# reader expects — from plain `add`/`set`/`remove` calls, returning the deflated bytes for `suggest({ payload })` or a recipe's result. Attributes are written untranslated, in the target application's own terms and units. Its two dependencies, `flatbuffers` and `@thatopen/fragments`, are OPTIONAL peers resolved only when `build()` runs, so apps that never author operations install and pay nothing new.

## 0.23.0

### Minor Changes

- b285947: Documents, suggestion recipients, and ownership. New `client.documents(projectId)`: every document is a FOLDER carrying a `document.json` descriptor (schema `thatopen/document@1` — the document's name, its native form, its renderable views by fileId); `descriptor()`, `view(folderId, formats)` (first match in the caller's preference order; null means "offer Process"), `addView()` (one view per format, replaced not accumulated) and `setDescriptor()`. "Ready to visualize = has a view a viewer renders" is the only rule — no derived-file or linked-file concept. `FlowDoc` gains the same three (`descriptor`/`view`/`addView`, with a frag fallback and descriptor synthesis for pre-descriptor folders), plus `folderId()` and `docs()` answering `folderId` — the id the CDE knows each document by. Suggestions now carry `to`: the application that receives and executes them (the document's own source by default). And `doc.ownership()` reads the element-lock registry the native plugins arbitrate through: who currently holds which elements, arbitration applied, read-only.

## 0.22.0

### Minor Changes

- 04a4416: Second field batch for history and recipes. `history.docs()` now says what each document IS: `modelName` filled from the folder's visible model, and `empty: true` for a connected-but-never-synced shell (listed, not hidden — apps dim or skip it). `recipes.plan()` returns a `RecipePlan` and the new `recipes.queue(plan, { author })` queues EXACTLY what was planned — same opId, same payload, no second execution; `run()` stays as the one-shot shortcut. `ExistingLookup` gains `where` (attribute-equals-value against the names the native app publishes, no normalization; use stable machine fields like Revit's `CategoryId: '-2001330'`, never localized display names).

## 0.21.0

### Minor Changes

- 0518425: History and recipes, the first field batch from the Coordination app. `history.docs()` no longer lists folders the backend leaks past the parent filter (any project folder with a dash looked like a document). Suggestion ids are minted BEFORE a recipe runs and arrive in its context (`ctx.opId`), because the `revitflow/op@2` payload carries the opId inside; `doc.suggest` accepts a caller-minted `opId` too. `recipes.plan()` is the dry pass: the recipe's result and rule tallies with nothing queued; `run()` still queues. The manifest gains `title` (human name), `doc` (long markdown) and `source` (what the app offers as input picker: a connected document or a project file). Settings that name an EXISTING thing declare it with `x-existing: { of, from }` so apps render lists people pick from — the `ExistingLookup` type documents the contract; resolving candidates stays in the app until the fragments toolkit ships a shared reader.

## 0.20.0

### Minor Changes

- 5b7b0aa: The history and recipes APIs, at services level. `client.history(projectId)` reads and writes a project's connected documents (Revit, AutoCAD…): version timelines ordered by the parent graph, deltas, full models, and change requests (suggestions) with their lifecycle. The flow storage underneath (`bimterop` folders, `revitflow_history.json`, `revitflow_ops.json`, hidden deltas) is fully encapsulated: this surface is the only supported way in, so the layout and the future platform-level API can change without touching callers. Appends take an `expectedLatestGuid` and refuse with `StaleHistoryError` when the head moved; the remaining write race is documented and owned by the agreed platform-level phase 2.

  `client.recipes` is the registry and runner for recipes: scripts that write suggestions in a native application's own language, defined by a manifest (`to`, `inputs`, `runtime`, `settingsSchema`, a self-documenting rules table) plus one `run` function. Running a recipe only queues a suggestion, so trying one is always safe.

## 0.19.0

### Minor Changes

- 47e776d: `thatopen mcp`: a desktop MCP server over the platform channel. Register it in any MCP client (`npx @thatopen/services mcp`) and an LLM can drive a running That Open app: `platform-status` and `send-app-command` (`ping`, `get-loaded-models`, or whatever the app declares), with the project named per call. Credentials from `thatopen login` or `THATOPEN_TOKEN`/`THATOPEN_API_URL`.

  Sockets now connect WebSocket-only with the token in the auth payload (the SDK's execution progress socket, the MCP, and the quickstart's external-tool example): the long-polling handshake could die across the platform's load-balanced instances. Needs a platform with PR #520's backend; against older backends the handshake is refused.

  The dev server dedupes `three` and compiles beta engine libraries from source when their `src` sits next to the resolved `dist`.

## 0.18.0

### Minor Changes

- 9f557e6: Export `GISManager`, the built-in for Google Photorealistic 3D tiles, vector GIS layers (shapefile and GeoJSON) and the 2D minimap, together with its types and a consumer-facing example. Also adds examples for the GIS, 2D map and GIS properties panels. The package now depends on `@types/geojson`, which the `GISManager` types reference.

## 0.17.0

### Minor Changes

- 795529b: Hidden files can be tagged. `createHiddenFile` and `createHiddenFilesBatch` take an optional `tag` (one tag applies to every file in a batch), `getHiddenFilesByParent` takes an optional `tag` filter (a tagged listing comes back in creation order), and `HiddenFileEntity` gains the optional `tag` field. Existing calls are unchanged.

## 0.16.1

### Patch Changes

- 2e6abea: App template: join the platform channel at the start of boot, not the end. A stalled startup request (project data, the first world) used to leave the app booted-looking but silently unreachable to external tools — `channelPublish` acks came back `{ delivered: 0 }` with nothing in the console, because a join that is never requested also never times out loudly. The template now joins right after `client.setup()`, and the project-data fetch is bounded so a hung response cannot park the rest of boot either. This release also ships `src/core/examples/` (the channel walkthrough the 0.16.0 docs referenced but did not include).

## 0.16.0

### Minor Changes

- fca00b4: Scaffolded apps ship wired to the platform channel: a typed command map
  (`ping`, `get-loaded-models`) that external tools of the account (an MCP
  server, a CLI, a desktop LLM) can call with typed replies, plus a joined
  collaboration room, in `src/setups/channel.ts`. Extending the surface is one
  entry in `AppCommands` and its handler.

  Docs: the AI quickstart gains section 5b (driving the running app from
  outside, with a working socket.io driver) and the Chrome "Local network
  access" note without which the dev loop fails silently. The `localStorage`
  advice is gone from every doc that gave it: the production sandbox runs apps
  on an opaque origin where all origin storage throws; drafts live in memory
  and the platform is the only persistence.

## 0.15.0

### Minor Changes

- 6e4a97d: Add `client.channel` to `PlatformClient`: typed access, from inside an app, to the platform channel. `channel.collab<Events>()` is a collaboration room shared with other users of the app, with presence (`peers`, `onPeerJoined`, `onPeerLeft`). `channel.external<Commands>(kind?)` receives commands from external tools (MCP, CLI, Revit plugin); a handler's return value is sent back to the caller automatically, and a throw becomes an error reply. Rooms are opt-in through `join()` and `leave()`. Requires a platform whose channel gateway stamps `scope` and `kind` on messages; without it messages are still delivered by type.

## 0.14.0

### Minor Changes

- 1722a72: `ProjectManager`: add a project-wide `crs` singleton (`CrsData`: `epsgCode`, `geoidUndulation`) and make `origin` and `crs` reactive (`onChange`), with dirty tracking (`dirty`, `dirtyEntities`, `onDirtyChange`). Remove the unused `bimCoordinates` sites collection and its `BimSite`/`BimCoordinatesData` types.

## 0.13.0

### Minor Changes

- dfa30c8: Inject the `executionContext` global (`projectId`, `executionId`, `toolId`, `toolVersion`) into `thatopen run`/local-server executions, matching what the platform injects at real execution time. Components reading `executionContext` locally no longer crash with "executionContext is not defined".

## 0.12.0

### Minor Changes

- 47b18f3: Export `ProjectManager`, the canonical project-level data store for origin/georeferencing, BIM site coordinates, asset coordinates, and graphics settings.

## 0.11.0

### Minor Changes

- 21e4fb5: Rate limit guidance and a backoff-aware retry policy.

  - `docs/rate-limits.md` documents the per-endpoint limits, the `429` body, and the local-draft
    save pattern (keep work in progress in `localStorage` / IndexedDB, write on an explicit save).
  - `resources/AGENTS.md` gains a hard rule against autosaving to the platform on every change,
    so assistants stop building write-per-keystroke loops.
  - `RequestError.retryAfter` exposes the wait in seconds, read from `Retry-After` or
    `details.retryAfter`.
  - Retries now back off exponentially with jitter and honour `Retry-After`. Only network
    failures, `429` and `5xx` are retried — other `4xx` fail immediately instead of being
    repeated. Retries remain off by default.

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
