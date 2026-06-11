/* MD
  ## Project configuration — read, write, and reload persistent data
  ---
  A CDE application needs to store two kinds of configuration: project-wide settings
  that all team members share (the metadata schema, custom naming rules) and personal
  settings that belong to one user (which columns are visible, which metadata views
  are pinned). Both live inside the project's file storage under a reserved system
  folder, so they travel with the project and don't rely on a separate configuration
  service.

  CDEManager exposes a simple read/write API that handles the folder structure
  automatically: finding or creating the right system folders, detecting whether a
  file already exists and versioning it instead of duplicating, and returning the
  parsed JSON on read. The metadata schema and user config are pre-wired shortcuts on
  top of this same mechanism — they just target fixed paths.

  This tutorial covers writing and reading arbitrary JSON under a named application
  namespace; demonstrating that writing the same file twice creates a new version
  rather than a duplicate; loading a user's personal config and verifying the round-
  trip; and writing a metadata schema then loading it back through `loadMetadataSchema`
  to confirm the schema is applied to CDEManager correctly.

  By the end, you'll see the full persistence layer that backs the schema editor and
  user preferences, and understand how any part of the platform can store structured
  data without managing the folder hierarchy directly.
*/

import * as OBC from "@thatopen/components";
// In production platform apps, CDEManager is loaded through the platform client:
//   const cde = await client.initBuiltInComponent(CDEManager.uuid, components);
// Here we import directly from source for local testing.
import { CDEManager } from "../../index";

/* MD
  ### 🛠️ Setting up
  Project data operations require an active client context throughout — they make real
  API calls to create folders and files. We use a stateful mock that behaves like a
  real backend: folders and files are created on demand and stored in memory, so reads
  always return what was last written.
*/

const components = new OBC.Components();
const cde = components.get(CDEManager);

const output = document.getElementById("output") as HTMLPreElement;
const log = (msg: string) => { console.log(msg); output.textContent += msg + "\n"; };

// In-memory store that simulates the project file storage.
const store = {
  folders: [] as any[],
  files:   [] as any[],
  data:    new Map<string, any>(),
  fIdx: 0,
  dIdx: 0,
};

const mockClient = {
  checkPermissionBatch: async () => Array(5).fill({ hasPermission: true }),
  getProjectData: async () => ({
    project: { title: "Demo Project" },
    users: [],
    currentUser: { user: { _id: "user-alice" } },
  }),
  listFolders: async ({ parentFolderId }: any) =>
    store.folders.filter(f =>
      parentFolderId !== undefined
        ? String(f.parentId) === String(parentFolderId)
        : !f.parentId
    ),
  createFolder: async (name: string, parentId?: string) => {
    const folder = { _id: `folder-${store.fIdx++}`, name, parentId: parentId ?? null };
    store.folders.push(folder);
    return folder;
  },
  listFiles: async () => store.files,
  createFile: async ({ file: blob, name, versionTag, parentFolderId }: any) => {
    const id = `doc-${store.dIdx++}`;
    store.data.set(id, JSON.parse(await blob.text()));
    store.files.push({ _id: id, name, folderId: parentFolderId, versionTag });
    return {
      item: { _id: id, name, folderId: parentFolderId, createdAt: new Date().toISOString(), createdBy: "mock", itemType: "FILE" },
      version: { tag: versionTag },
    };
  },
  listVersions: async (fileId: string) => {
    const f = store.files.find(f => f._id === fileId);
    return f ? [{ _id: `v-${fileId}`, tag: f.versionTag ?? "v1" }] : [];
  },
  createVersion: async (fileId: string, blob: any, tag: string) => {
    store.data.set(fileId, JSON.parse(await blob.text()));
    const f = store.files.find(f => f._id === fileId);
    if (f) f.versionTag = tag;
    return { tag };
  },
  downloadFile: async (id: string) => ({
    json: async () => store.data.get(id) ?? null,
    arrayBuffer: async () => new ArrayBuffer(0),
  }),
};

cde.ctx = { client: mockClient as any, projectId: "mock" };
await cde.loadFolders();

/* MD
  ### 📝 Writing and reading project data
  `writeProjectData` takes an application namespace and a filename. The first time a
  file is written, it is created under `__project_data/{app}/`. Subsequent writes to
  the same path create a new version instead of a new file, keeping the full history
  while the read path always returns the latest content.
*/

log("\n--- write and read ---");
const payload = { lastRun: "2026-06-10", status: "ok", count: 42 };
const tag1 = await cde.writeProjectData("my-app", "run-log.json", payload);
log(`  write v1 tag: ${tag1}`);

const read1 = await cde.readProjectData("my-app", "run-log.json");
log(`  read back: status="${read1.status}", count=${read1.count}`);

/* MD
  ### 🔄 Versioning on repeated writes
  Writing to the same path a second time detects the existing file and creates a new
  version. The read always returns the latest version, so the caller doesn't need to
  track version tags — they just write and read at the same path.
*/

log("\n--- auto-versioning ---");
const updated = { ...payload, count: 99, lastRun: "2026-06-11" };
const tag2 = await cde.writeProjectData("my-app", "run-log.json", updated);
log(`  write v2 tag: ${tag2}`);

const read2 = await cde.readProjectData("my-app", "run-log.json");
log(`  read after update: count=${read2.count}`);

/* MD
  ### 👤 User configuration round-trip
  `saveUserConfig` and `loadUserConfig` are thin wrappers around `writeProjectData`
  and `readProjectData` that target a user-specific path (`cde/user_{id}.json`). They
  accept and return the same config shape as the rest of the CDE — visible columns and
  metadata views — so the schema editor and column picker can persist their state
  without knowing the path structure.
*/

log("\n--- user config round-trip ---");
const userConfig = {
  visibleColumns: ["name", "discipline", "phase", "createdAt"],
  metadataViews: [{ id: "view-str", name: "Structural", fields: ["discipline", "phase"] }],
};
await cde.saveUserConfig(userConfig);

const loaded = await cde.loadUserConfig();
log(`  visibleColumns: [${loaded?.visibleColumns?.join(", ")}]`);
log(`  views: ${loaded?.metadataViews?.length} view(s)`);

/* MD
  ### 🗂️ Schema persistence via loadMetadataSchema
  `loadMetadataSchema` reads `cde/config.json` from the project storage and applies
  the `metadataSchema` section to CDEManager. Writing the config file manually (via
  `writeProjectData`) then calling `loadMetadataSchema` is the setup path used by the
  schema editor after a successful save — the same round-trip that happens in
  production when the app boots.
*/

log("\n--- schema persistence ---");
const schemaPayload = {
  metadataSchema: {
    discipline: { label: "Discipline", type: "string", required: true },
    phase:      { label: "Phase",      type: "string", required: false },
    zone:       { label: "Zone",       type: "string", required: false },
  },
};
await cde.writeProjectData("cde", "config.json", schemaPayload);

await cde.loadMetadataSchema();
log(`  schema keys after load: [${Object.keys(cde.metadataSchema).join(", ")}]`);
log(`  discipline.required: ${cde.metadataSchema["discipline"]?.required}`);
log(`  zone exists: ${"zone" in cde.metadataSchema}`);
