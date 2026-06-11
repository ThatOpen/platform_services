/* MD
  ## File uploads, versioning, and the download cache
  ---
  A site coordinator drops a batch of files onto the CDE every Monday after the
  weekend review: some are entirely new models, some are revised versions of files
  already in the project, and sometimes the metadata group they upload into should
  be stamped automatically onto the new files. If the platform makes the coordinator
  sort this out manually, it slows the handoff and introduces naming errors. And if
  an upload fails halfway through a batch, the file table should land in a safe state
  rather than freeze at a loading spinner.

  CDEManager's upload method compares each incoming file against the current list by
  base name and extension. Files with no match are created from scratch; files that
  match an existing entry produce a new version instead. When a metadata group is
  active, the group's values are stamped onto every file in the batch without any
  extra action from the user. The state machine moves through a dedicated uploading
  state so any component in the platform can show a progress indicator by reading a
  single source of truth.

  This tutorial covers uploading new files and reading the result from the
  upload-completed event; uploading a file whose name matches an existing entry and
  confirming it is versioned rather than duplicated; attaching metadata automatically
  when the upload runs inside an active metadata group; recovering cleanly from an
  upload error through the state machine; and reading file content through the
  in-memory cache that avoids re-fetching the same version twice.

  By the end, you'll have a working demonstration of the full upload lifecycle —
  create, version, auto-metadata, error recovery — plus the cache hit and miss
  behavior that the viewer relies on when loading models.
*/

import * as OBC from "@thatopen/components";
// In production platform apps, CDEManager is loaded through the platform client:
//   const cde = await client.initBuiltInComponent(CDEManager.uuid, components);
// Here we import directly from source for local testing.
import { CDEManager } from "../../index";
import type { CDEFile } from "../../src/types";

/* MD
  ### 🛠️ Setting up
  All flows in this example use a minimal mock client so they run without a backend
  connection. Unlike mock flows that clear the client context after loading permissions,
  upload and download operations require an active client throughout — so the context
  stays set for the full example.
*/

const components = new OBC.Components();
const cde = components.get(CDEManager);

const output = document.getElementById("output") as HTMLPreElement;
const log = (msg: string) => { console.log(msg); output.textContent += msg + "\n"; };

let fileCounter = 0;
// Track created version records so the versioning demo can find them.
const mockVersions: Record<string, { tag: string }[]> = {};

const mockClient = {
  checkPermissionBatch: async () => Array(5).fill({ hasPermission: true }),
  getProjectData: async () => ({ project: { title: "Demo Project" }, users: [] }),
  listFolders: async () => [],
  createFile: async ({ name, versionTag, parentFolderId }: any) => {
    const id = `file-${fileCounter++}`;
    mockVersions[id] = [{ tag: versionTag }];
    return {
      item: { _id: id, name, folderId: parentFolderId ?? null, createdAt: new Date().toISOString(), createdBy: "mock-user", itemType: "FILE" },
      version: { tag: versionTag },
    };
  },
  listVersions: async (fileId: string) => mockVersions[fileId] ?? [],
  createVersion: async (fileId: string, _file: File, tag: string) => {
    mockVersions[fileId] = [...(mockVersions[fileId] ?? []), { tag }];
    return { tag };
  },
  updateFileVersionMetadata: async () => ({}),
  downloadFile: async (_id: string) => ({ arrayBuffer: async () => new ArrayBuffer(4096) }),
  archiveFile: async () => ({}),
};

cde.ctx = { client: mockClient as any, projectId: "mock" };
await cde.loadFolders();

cde.onMachineStateChanged.add((s) => log(`  → ${s.kind}`));

/* MD
  ### 📤 Uploading new files
  Calling the upload method transitions the machine to an uploading state, carries
  out the operation, then returns to idle and fires a completion event. The event
  payload separates newly created files from versioned ones, so the UI can show a
  targeted confirmation — "2 files added" versus "1 file updated" — without parsing
  the whole file list.
*/

cde.onUploadCompleted.add(({ created, versioned }) => {
  log(`  [onUploadCompleted] created: ${created.length}, versioned: ${versioned.length}`);
  for (const f of created) log(`    + ${f.name}`);
  for (const f of versioned) log(`    ↑ ${f.name}`);
});

log("\n--- upload: create new files ---");
const f1 = new File([new ArrayBuffer(100)], "column.ifc", { type: "application/octet-stream" });
const f2 = new File([new ArrayBuffer(50)], "report.pdf");
await cde.uploadFiles([f1, f2]);
log(`  cde.files after upload: ${cde.files.length}`);

/* MD
  ### 🔄 Versioning an existing file
  When the incoming file's base name and extension match an entry already in the list,
  the upload method creates a new version rather than a duplicate. The file counter in
  the version tag is computed from the existing version history, so the tag always
  follows on from whatever the project already has.
*/

log("\n--- upload: version existing file ---");
// "column.ifc" is already in cde.files from the previous upload.
const f1v2 = new File([new ArrayBuffer(120)], "column.ifc", { type: "application/octet-stream" });
await cde.uploadFiles([f1v2]);
log(`  cde.files after version upload: ${cde.files.length}`);

const colFile = cde.files.find(f => f.name === "column.ifc")!;
log(`  column.ifc version tag: ${(colFile as any).versionTag}`);

/* MD
  ### 🏷️ Auto-metadata from a metadata group
  When metadata grouping is active and a group is selected, every file uploaded in
  that session inherits the group's metadata values automatically. The coordinator
  selects the "Structural SD phase" group, drops files, and every new file arrives
  already tagged — no post-upload editing required.
*/

log("\n--- upload: auto-metadata ---");
cde.sendMachineEvent({ type: "SET_GROUPS_VIEW_MODE", mode: "metadata" });
cde.selectedMetadataGroup = { discipline: "STR", phase: "SD" };

const f3 = new File([new ArrayBuffer(80)], "foundations-v2.ifc", { type: "application/octet-stream" });
await cde.uploadFiles([f3]);

const uploaded = cde.files.find(f => f.name === "foundations-v2.ifc")!;
log(`  discipline: ${uploaded.metadata.discipline}, phase: ${uploaded.metadata.phase}`);

// Reset back to groups view for subsequent sections.
cde.sendMachineEvent({ type: "SET_GROUPS_VIEW_MODE", mode: "groups" });
cde.selectedMetadataGroup = null;

/* MD
  ### ⚠️ Recovering from an upload error
  If the backend rejects the upload, the machine moves to an error state rather than
  silently returning to idle. The error state carries the reason message so the UI can
  surface it, and sending a dismiss event returns to idle so the user can try again.
  No manual state cleanup is needed.
*/

log("\n--- upload: error recovery ---");
cde.ctx = {
  client: {
    ...mockClient,
    createFile: async () => { throw new Error("Upload failed — server unavailable"); },
  } as any,
  projectId: "mock",
};

const fBroken = new File([new ArrayBuffer(10)], "broken.ifc", { type: "application/octet-stream" });
await cde.uploadFiles([fBroken]);

if (cde.machineState.kind === "error") {
  log(`  error reason: ${cde.machineState.reason}`);
  cde.sendMachineEvent({ type: "DISMISS" });
}
log(`  state after dismiss: ${cde.machineState.kind}`);

// Restore the working mock client.
cde.ctx = { client: mockClient as any, projectId: "mock" };

/* MD
  ### 💾 File download cache
  The download method on CDEManager keeps a buffer cache in memory so the viewer
  does not re-fetch the same file version twice during a session. The cache logs each
  access — a miss triggers a download, a hit returns the stored buffer immediately.
  Only extensions in `cacheExtensions` are stored; all others are downloaded every
  time so the cache stays focused on the large binary files that benefit most from it.

  Note: files uploaded in the same session are already placed in the cache by the
  upload method. The demo below uses a file injected directly — simulating a file
  that arrived from a previous session load — to show a clean miss on the first
  access.
*/

log("\n--- download cache ---");

// A file loaded from the backend (not uploaded this session) starts with no cache entry.
const serverFile = {
  _id: "server-ifc", name: "arch.ifc", folderId: null, versionTag: "v3",
  createdBy: "carol", createdAt: new Date(), metadata: {},
} as CDEFile;
cde.files = [...cde.files, serverFile];

// First access — cache miss, buffer fetched and stored.
const buf1 = await cde.downloadFile(serverFile);
log(`  arch.ifc first access (miss): ${buf1.byteLength} bytes`);

// Second access — cache hit, no network call.
const buf2 = await cde.downloadFile(serverFile);
log(`  arch.ifc second access (hit): ${buf2.byteLength} bytes`);

// PDF extension is not in cacheExtensions — fetched but not stored.
const pdfFile = cde.files.find(f => f.name === "report.pdf")!;
const bufPdf = await cde.downloadFile(pdfFile);
log(`  report.pdf access (skip): ${bufPdf.byteLength} bytes`);

log(`\n  cacheExtensions: [${[...cde.cacheExtensions].join(", ")}]`);
log(`  cacheMaxBytes: ${(cde.cacheMaxBytes / 1024 / 1024).toFixed(0)} MB`);
