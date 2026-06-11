/* MD
  ## Folder management — create, rename, archive, and commit
  ---
  A project reaches the construction phase and the coordination team needs to
  restructure the folder hierarchy: add a "Facades" discipline folder, rename
  "Structural" to its official abbreviation, and archive two superseded folders that
  have been merged. Doing these one at a time through separate API calls means the
  folder tree flickers between invalid states as each change lands — a freshly created
  folder appears before its sibling is renamed, and the archived folders briefly
  disappear before the new one is visible.

  CDEManager stages all folder changes in memory first. Adds, renames, and archives
  accumulate in a `pendingChanges` list before anything is sent to the backend. The
  full diff is readable from the machine state at any point, so the UI can preview
  exactly what the folder tree will look like after the commit. Cancelling throws away
  all staged changes in one step. Saving applies everything in the right dependency
  order and fires a single completion event with the counts.

  This tutorial covers entering folder edit mode; staging new folders with a temporary
  ID that gets resolved to a real ID on save; staging renames and observing how
  renaming back to the original value automatically removes the change; the
  archive-folder toggle behavior, where sending the event a second time unstages the
  archive; removing a staged temp folder and all its staged children in one event;
  reverting all staged changes for a single folder; and committing the full batch.

  By the end, you'll have a working demonstration of every folder-management state
  machine flow — stage, inspect, revert, and commit — against mock data with no
  backend connection needed for the staging sections.
*/

import * as OBC from "@thatopen/components";
// In production platform apps, CDEManager is loaded through the platform client:
//   const cde = await client.initBuiltInComponent(CDEManager.uuid, components);
// Here we import directly from source for local testing.
import { CDEManager } from "../../index";

/* MD
  ### 🛠️ Setting up
  The save path requires a live client context — `_saveFolderChanges` returns early if
  no context is set and the machine would stay stuck in `savingFolderChanges` forever.
  We keep the mock context active throughout the entire example so the commit section
  works correctly.
*/

const components = new OBC.Components();
const cde = components.get(CDEManager);

const output = document.getElementById("output") as HTMLPreElement;
const log = (msg: string) => { console.log(msg); output.textContent += msg + "\n"; };

let folderIdx = 0;
const mockClient = {
  checkPermissionBatch: async () => Array(5).fill({ hasPermission: true }),
  getProjectData: async () => ({ project: { title: "" }, users: [] }),
  listFolders: async () => [],
  archiveFolder: async (_id: string) => ({}),
  updateFolder: async (_id: string, _updates: any) => ({}),
  createFolder: async (name: string, parentId?: string) => ({
    _id: `created-${folderIdx++}`, name, parentId: parentId ?? null,
  }),
};

cde.ctx = { client: mockClient as any, projectId: "mock" };
await cde.loadFolders();

const folders = [
  { _id: "folder-str", name: "Structural", parentId: null },
  { _id: "folder-arch", name: "Architecture", parentId: null },
  { _id: "folder-mep", name: "MEP", parentId: "folder-arch" },
];
cde.folders = folders as any;

cde.onMachineStateChanged.add((s) => log(`  → ${s.kind}`));
cde.onFolderChangesCompleted.add(({ created, renamed, archived }) =>
  log(`  [onFolderChangesCompleted] created: ${created}, renamed: ${renamed}, archived: ${archived}`)
);

/* MD
  ### 📁 Staging folder changes
  New folders are added with a temporary ID assigned by the caller — the UI can use it
  to identify the row in the pending list before the real ID arrives from the backend.
  Renames and archives for existing folders are keyed by their real ID. All three
  change kinds accumulate in the same `pendingChanges` array, so the UI can render a
  single diff view for the whole operation.

  Cancelling discards everything and returns to idle. Unlike file bulk editing, folder
  editing has no concept of "return to previous selection" — it always returns to idle.
*/

log("\n--- stage changes and cancel ---");
cde.sendMachineEvent({ type: "START_EDIT_FOLDERS" });

// New root-level folder.
cde.sendMachineEvent({ type: "ADD_FOLDER", tempId: "temp_facades", name: "Facades", parentId: null });
// New folder nested inside the temp folder above.
cde.sendMachineEvent({ type: "ADD_FOLDER", tempId: "temp_facades_sub", name: "Glazing", parentId: "temp_facades" });

// Rename an existing folder.
cde.sendMachineEvent({ type: "RENAME_FOLDER", folderId: "folder-str", name: "STR" });

// Archive an existing folder.
cde.sendMachineEvent({ type: "ARCHIVE_FOLDER", folderId: "folder-mep" });

if (cde.machineState.kind === "editingFolders") {
  const changes = cde.machineState.pendingChanges;
  const creates = changes.filter(c => c.kind === "create").length;
  const renames = changes.filter(c => c.kind === "rename").length;
  const archives = changes.filter(c => c.kind === "archive").length;
  log(`  pending: ${creates} create(s), ${renames} rename(s), ${archives} archive(s)`);
}

cde.sendMachineEvent({ type: "CANCEL_FOLDER_CHANGES" });
log(`  state after cancel: ${cde.machineState.kind}`);
log(`  folders unchanged: ${cde.folders.length}`);

/* MD
  ### 🔍 Smart rename diff and archive toggle
  Renaming an existing folder back to its current name automatically removes the
  rename change from the pending list — the same smart diffing used for file metadata.
  This keeps the pending list clean so the commit only sends real changes to the
  backend.

  Archiving the same existing folder twice toggles the staged archive off. This is
  different from the file-editing archive, which needs an explicit unarchive event to
  remove the mark. For folders, sending the archive event again is the undo gesture.
*/

log("\n--- smart rename diff ---");
cde.sendMachineEvent({ type: "START_EDIT_FOLDERS" });

cde.sendMachineEvent({ type: "RENAME_FOLDER", folderId: "folder-str", name: "STR" });
if (cde.machineState.kind === "editingFolders") {
  log(`  after rename "STR": ${cde.machineState.pendingChanges.filter(c => c.kind === "rename").length} rename(s)`);
}

// Renaming back to the original name removes the change automatically.
cde.sendMachineEvent({ type: "RENAME_FOLDER", folderId: "folder-str", name: "Structural" });
if (cde.machineState.kind === "editingFolders") {
  log(`  after revert to "Structural": ${cde.machineState.pendingChanges.filter(c => c.kind === "rename").length} rename(s)`);
}

log("\n--- archive toggle ---");
cde.sendMachineEvent({ type: "ARCHIVE_FOLDER", folderId: "folder-arch" });
if (cde.machineState.kind === "editingFolders") {
  log(`  after first ARCHIVE_FOLDER: ${cde.machineState.pendingChanges.filter(c => c.kind === "archive").length} archive(s)`);
}

cde.sendMachineEvent({ type: "ARCHIVE_FOLDER", folderId: "folder-arch" });
if (cde.machineState.kind === "editingFolders") {
  log(`  after second ARCHIVE_FOLDER (toggle): ${cde.machineState.pendingChanges.filter(c => c.kind === "archive").length} archive(s)`);
}

cde.sendMachineEvent({ type: "CANCEL_FOLDER_CHANGES" });

/* MD
  ### 🗑️ Removing temp folders and reverting existing ones
  When a staged new folder is archived or reset, it is removed from the pending list
  entirely — there is nothing to archive on the backend yet because it was never
  created. Any folders staged as children of the removed folder are removed along with
  it, so the pending list never contains orphaned children.

  For existing folders, a reset event clears all staged changes for that folder at
  once — both a pending rename and a pending archive in the same step — without
  affecting any other staged changes.
*/

log("\n--- remove temp folder cascade ---");
cde.sendMachineEvent({ type: "START_EDIT_FOLDERS" });

// Stage a temp parent with two children.
cde.sendMachineEvent({ type: "ADD_FOLDER", tempId: "temp_p", name: "Parent", parentId: null });
cde.sendMachineEvent({ type: "ADD_FOLDER", tempId: "temp_c1", name: "Child A", parentId: "temp_p" });
cde.sendMachineEvent({ type: "ADD_FOLDER", tempId: "temp_c2", name: "Child B", parentId: "temp_p" });

if (cde.machineState.kind === "editingFolders") {
  log(`  staged before archive: ${cde.machineState.pendingChanges.length} change(s)`);
}

// Archiving a temp folder removes it AND all its staged children.
cde.sendMachineEvent({ type: "ARCHIVE_FOLDER", folderId: "temp_p" });

if (cde.machineState.kind === "editingFolders") {
  log(`  staged after archive temp parent: ${cde.machineState.pendingChanges.length} change(s)`);
}

log("\n--- reset existing folder ---");
cde.sendMachineEvent({ type: "RENAME_FOLDER", folderId: "folder-str", name: "STR" });
cde.sendMachineEvent({ type: "ARCHIVE_FOLDER", folderId: "folder-str" });

if (cde.machineState.kind === "editingFolders") {
  const changes = cde.machineState.pendingChanges;
  log(`  before reset: ${changes.filter(c => c.kind === "rename" || c.kind === "archive").length} change(s) for folder-str`);
}

// RESET_FOLDER removes all staged changes for folder-str in one event.
cde.sendMachineEvent({ type: "RESET_FOLDER", folderId: "folder-str" });

if (cde.machineState.kind === "editingFolders") {
  const changes = cde.machineState.pendingChanges;
  log(`  after reset: ${changes.filter(c => c.kind === "rename" || c.kind === "archive").length} change(s) for folder-str`);
}

cde.sendMachineEvent({ type: "CANCEL_FOLDER_CHANGES" });

/* MD
  ### 💾 Committing folder changes
  Saving applies all staged changes to the backend in the correct order: archives
  first, then renames on folders that were not archived, then creates in parent-before-
  child order so that nested new folders resolve to real IDs. After everything is
  persisted, the folder list reloads from the backend and a single completion event
  reports how many folders were created, renamed, and archived.
*/

log("\n--- commit ---");
cde.sendMachineEvent({ type: "START_EDIT_FOLDERS" });

cde.sendMachineEvent({ type: "ADD_FOLDER", tempId: "temp_facades", name: "Facades", parentId: null });
cde.sendMachineEvent({ type: "RENAME_FOLDER", folderId: "folder-str", name: "STR" });
cde.sendMachineEvent({ type: "ARCHIVE_FOLDER", folderId: "folder-mep" });

if (cde.machineState.kind === "editingFolders") {
  log(`  pending before save: ${cde.machineState.pendingChanges.length} change(s)`);
}

await new Promise<void>(resolve => {
  cde.onFolderChangesCompleted.add(() => resolve());
  cde.sendMachineEvent({ type: "SAVE_FOLDER_CHANGES" });
});

log(`  state after commit: ${cde.machineState.kind}`);
