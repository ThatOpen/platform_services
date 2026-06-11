/* MD
  ## Bulk file editing — stage, preview, revert, and commit
  ---
  A project manager preparing a deliverable handoff needs to update discipline tags
  across fifteen IFC files after a scope change, rename each to match the new naming
  convention, and archive three superseded models — all before anything is sent to the
  backend. Doing the changes one file at a time risks leaving the file list in a
  half-updated state if the session is interrupted, and there is no way to review
  exactly what will change before committing.

  CDEManager provides a staging mode where metadata edits, renames, and archive marks
  can be accumulated across any number of files before anything is written. The full
  diff is visible in the machine state at any point, so the UI can show a per-row
  preview of what is about to happen and let the user change their mind before
  confirming.

  This tutorial covers entering bulk edit mode from both the idle state and an active
  selection; staging metadata edits and renames for multiple files; observing how
  staging the original value back automatically clears a staged edit; reverting all
  staged changes for one file in a single step; staging and unstaging a file for
  archive; committing all staged changes and reading the result; and confirming that
  the state returns to the correct previous position after the commit.

  By the end, you'll have a working demonstration of the full bulk edit cycle — stage,
  preview, revert, commit, and cancel — with all transitions driven through the state
  machine.
*/

import * as OBC from "@thatopen/components";
// In production platform apps, CDEManager is loaded through the platform client:
//   const cde = await client.initBuiltInComponent(CDEManager.uuid, components);
// Here we import directly from source for local testing.
import { CDEManager } from "../../index";
import type { CDEFile } from "../../src/types";

/* MD
  ### 🛠️ Setting up
  All flows in this example run against mock data without a backend connection. Entering
  bulk edit mode is permission-gated, so we simulate the platform startup step that
  loads user permissions before running any demos.
*/

const components = new OBC.Components();
const cde = components.get(CDEManager);

const output = document.getElementById("output") as HTMLPreElement;
const log = (msg: string) => { console.log(msg); output.textContent += msg + "\n"; };

// Simulate the platform startup step that loads permissions.
cde.ctx = {
  client: {
    checkPermissionBatch: async () => Array(5).fill({ hasPermission: true }),
    getProjectData: async () => ({ project: { title: "" }, users: [] }),
    listFolders: async () => [],
  } as any,
  projectId: "mock",
};
await cde.loadFolders();
// Clear the context — mock flows don't make API calls.
cde.ctx = undefined;

const now = new Date();
const mockFiles: CDEFile[] = [
  {
    _id: "f1", name: "column.ifc", folderId: null,
    createdBy: "alice", createdAt: now,
    metadata: { discipline: "STR", phase: "DD" },
  } as CDEFile,
  {
    _id: "f2", name: "foundations.ifc", folderId: null,
    createdBy: "bob", createdAt: now,
    metadata: { discipline: "STR", phase: "CD" },
  } as CDEFile,
  {
    _id: "f3", name: "report.pdf", folderId: null,
    createdBy: "alice", createdAt: now,
    metadata: {},
  } as CDEFile,
];
cde.files = mockFiles;

cde.onMachineStateChanged.add((s) => log(`  → ${s.kind}`));
cde.onFilesChanged.add((files) => log(`  [onFilesChanged] ${files.length} file(s)`));

/* MD
  ### 📋 Staging edits across multiple files
  In bulk edit mode, every change accumulates in the machine state rather than being
  applied right away. The state carries a per-file record of staged metadata edits and
  renames, so the UI can display a diff table without any extra bookkeeping — it just
  reads the machine state.

  Cancelling discards all staged changes and returns to wherever the session started,
  leaving every file exactly as it was.
*/

log("\n--- stage edits and cancel ---");
cde.sendMachineEvent({ type: "START_EDIT_FILES" });

cde.sendMachineEvent({ type: "UPDATE_FILE_METADATA", fileId: "f1", key: "discipline", value: "MEP" });
cde.sendMachineEvent({ type: "UPDATE_FILE_METADATA", fileId: "f2", key: "phase", value: "SD" });
cde.sendMachineEvent({ type: "RENAME_FILE", fileId: "f1", name: "column-revised.ifc" });

if (cde.machineState.kind === "editingFiles") {
  const { pendingEdits, pendingRenames } = cde.machineState;
  log(`  staged edits:   ${Object.keys(pendingEdits).length} file(s)`);
  log(`  staged renames: ${Object.keys(pendingRenames).length} file(s)`);
}

cde.sendMachineEvent({ type: "CANCEL_EDIT_FILES" });
log(`  state after cancel: ${cde.machineState.kind}`);
// Files are untouched — nothing was committed.
log(`  f1 discipline: ${cde.files.find(f => f._id === "f1")!.metadata.discipline}`);

/* MD
  ### 🔍 Smart diff: staging the original value clears the edit
  The staging system tracks whether a value actually differs from the file's current
  state. If a user edits a field and then edits it back to its original value, the
  edit disappears from the staged list on its own — the state machine does the diffing
  so the UI doesn't need to.
*/

log("\n--- smart diff ---");
cde.sendMachineEvent({ type: "START_EDIT_FILES" });

cde.sendMachineEvent({ type: "UPDATE_FILE_METADATA", fileId: "f1", key: "discipline", value: "MEP" });
if (cde.machineState.kind === "editingFiles") {
  log(`  f1 staged: ${Object.keys(cde.machineState.pendingEdits).includes("f1")}`);
}

// Staging the original value back auto-removes f1 from pendingEdits.
cde.sendMachineEvent({ type: "UPDATE_FILE_METADATA", fileId: "f1", key: "discipline", value: "STR" });
if (cde.machineState.kind === "editingFiles") {
  log(`  f1 staged after revert: ${Object.keys(cde.machineState.pendingEdits).includes("f1")}`);
}

cde.sendMachineEvent({ type: "CANCEL_EDIT_FILES" });

/* MD
  ### ↩️ Reverting all staged changes for one file
  When a user wants to undo everything they staged for a particular file — not just
  one field — a single revert event wipes all of its staged edits, renames, and archive
  marks at once. Files with no staged changes are unaffected.
*/

log("\n--- revert one file ---");
cde.sendMachineEvent({ type: "START_EDIT_FILES" });

cde.sendMachineEvent({ type: "UPDATE_FILE_METADATA", fileId: "f1", key: "discipline", value: "MEP" });
cde.sendMachineEvent({ type: "RENAME_FILE", fileId: "f1", name: "column-revised.ifc" });
cde.sendMachineEvent({ type: "ARCHIVE_FILE_EDIT", fileId: "f1" });

if (cde.machineState.kind === "editingFiles") {
  const { pendingEdits, pendingRenames, pendingArchives } = cde.machineState;
  log(`  before revert — edits: ${Object.keys(pendingEdits).length}, renames: ${Object.keys(pendingRenames).length}, archives: ${pendingArchives.length}`);
}

// REVERT_FILE_METADATA clears edits, renames, and archive mark for f1 in one event.
cde.sendMachineEvent({ type: "REVERT_FILE_METADATA", fileId: "f1" });

if (cde.machineState.kind === "editingFiles") {
  const { pendingEdits, pendingRenames, pendingArchives } = cde.machineState;
  log(`  after revert  — edits: ${Object.keys(pendingEdits).length}, renames: ${Object.keys(pendingRenames).length}, archives: ${pendingArchives.length}`);
}

cde.sendMachineEvent({ type: "CANCEL_EDIT_FILES" });

/* MD
  ### 🗑️ Staging archives and committing
  Marking a file for archive in bulk edit mode stages the deletion — the file stays
  visible in the table, just flagged, so the user can see it in the preview and change
  their mind before committing. Unstaging removes the mark and the file is back to
  normal. Files staged for archive are excluded from metadata and rename operations
  when the commit runs, so staging both a rename and an archive on the same file never
  creates a conflict.
*/

log("\n--- archive staging + commit ---");
cde.sendMachineEvent({ type: "START_EDIT_FILES" });

cde.sendMachineEvent({ type: "ARCHIVE_FILE_EDIT", fileId: "f3" });
if (cde.machineState.kind === "editingFiles") {
  log(`  pending archives: ${cde.machineState.pendingArchives.length}`);
}

// Unstaging gives the user a chance to reconsider before the commit.
cde.sendMachineEvent({ type: "UNARCHIVE_FILE_EDIT", fileId: "f3" });
if (cde.machineState.kind === "editingFiles") {
  log(`  after unarchive: ${cde.machineState.pendingArchives.length}`);
}

// Stage f3 for archive again, and also rename f1.
cde.sendMachineEvent({ type: "ARCHIVE_FILE_EDIT", fileId: "f3" });
cde.sendMachineEvent({ type: "RENAME_FILE", fileId: "f1", name: "column-renamed.ifc" });

log(`  files before commit: ${cde.files.length}`);
cde.sendMachineEvent({ type: "SAVE_FILE_EDITS" });

// Without a live client, changes are applied locally and synchronously.
log(`  files after commit: ${cde.files.length}`);
log(`  f1 name: ${cde.files.find(f => f._id === "f1")?.name ?? "not found"}`);
log(`  f3 still in list: ${cde.files.some(f => f._id === "f3")}`);

/* MD
  ### 🔁 Returning to the previous selection
  The state machine records where it came from when bulk edit mode is entered. Entering
  from an active selection returns there after committing — the same files are still
  highlighted in the table. Entering from idle returns to idle. Either way, the
  selection is never lost.
*/

log("\n--- previousState: commit from selection ---");
// Start fresh with the original two IFC files.
const f1 = cde.files.find(f => f._id === "f1")!;
const f2 = cde.files.find(f => f._id === "f2")!;

cde.sendMachineEvent({ type: "SELECT", files: [f1, f2] });
// Entering from "selected" records it as the return point.
cde.sendMachineEvent({ type: "START_EDIT_FILES" });

cde.sendMachineEvent({ type: "UPDATE_FILE_METADATA", fileId: "f1", key: "phase", value: "SD" });
cde.sendMachineEvent({ type: "SAVE_FILE_EDITS" });

log(`  state after commit: ${cde.machineState.kind}`);
if (cde.machineState.kind === "selected") {
  log(`  selection preserved: ${cde.machineState.files.length} file(s)`);
}
