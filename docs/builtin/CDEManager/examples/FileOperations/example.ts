/* MD
  ## File operations — inline edit, rename, view, download, archive
  ---
  BIM coordinators reviewing a model drop repeat the same small actions throughout
  their session: correcting a discipline tag that changed after a scope revision,
  renaming a file to match the agreed convention, opening it alongside the structural
  model to check for clashes, handing it off to a sub-consultant, or removing a
  superseded version from the live set. If every panel in the platform handles these
  separately, two panels looking at the same file at the same time can show
  contradictory states — one says "uploading", another still shows the old name.

  CDEManager gives all of these operations a single shared state. Every action moves
  through a known transition so any part of the platform — the file table, the viewer,
  the side panel — reacts to the same source of truth without coordinating with every
  other panel individually.

  This tutorial covers selecting files and editing a metadata value inline; cancelling
  an in-progress edit; committing the edit and reading the updated value back from the
  state; renaming a file optimistically and observing the local update; opening files
  in the viewer, adding a second file to the active view, simulating load completion,
  and removing files from the view one at a time; closing the viewer while keeping the
  selection intact; and, with live credentials, downloading a selection and archiving a
  file through the state machine.

  By the end, you'll have a working demonstration of every per-file state machine flow
  — inline edit, rename, viewer, download, and archive — with all mock-data flows
  running without any backend connection.
*/

import * as OBC from "@thatopen/components";
// In production platform apps, CDEManager is loaded through the platform client:
//   const cde = await client.initBuiltInComponent(CDEManager.uuid, components);
// Here we import directly from source for local testing.
import { CDEManager } from "../../index";
import type { CDEFile } from "../../src/types";

/* MD
  ### 🛠️ Setting up
  Most flows in this example run against mock data without a backend connection.
  However, operations like editing metadata and renaming files are permission-gated —
  the platform normally loads those permissions when the app starts. We simulate that
  startup step here so the demo flows work in isolation. We also register viewer groups
  before setting any files because the transition into the viewer validates the group
  configuration at the moment of the event.
*/

const components = new OBC.Components();
const cde = components.get(CDEManager);

const output = document.getElementById("output") as HTMLPreElement;
const log = (msg: string) => { console.log(msg); output.textContent += msg + "\n"; };

// The "ifc/frag" group allows multiple files open at the same time; "pdf" does not.
cde.viewerGroups = [
  { extensions: ["ifc", "frag"], multiple: true },
  { extensions: ["pdf"] },
];

// Simulate the platform startup step that loads user permissions.
// Without this, permission-gated events (edit, rename, archive) are silently ignored.
cde.ctx = {
  client: {
    checkPermissionBatch: async () => Array(5).fill({ hasPermission: true }),
    getProjectData: async () => ({ project: { title: "" }, users: [] }),
    listFolders: async () => [],
    updateFile: async (id: string) => ({ item: { _id: id } }),
    updateFileVersionMetadata: async () => ({}),
  } as any,
  projectId: "mock",
};
await cde.loadFolders();
// Clear the context after loading permissions — mock flows don't make API calls.
// With a live client, operations like rename would also confirm via onRenameCompleted.
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
];
cde.files = mockFiles;

cde.onMachineStateChanged.add((s) => log(`  → ${s.kind}`));
cde.onFilesChanged.add((files) => log(`  [onFilesChanged] ${files.length} file(s)`));
cde.onRenameCompleted.add(({ success, error }) =>
  log(success ? "  [onRenameCompleted] server confirmed" : `  [onRenameCompleted] rolled back — ${error}`)
);
cde.onDownloadReady.add(({ blob, filename }) =>
  log(`  [onDownloadReady] "${filename}" — ${blob.size} bytes`)
);

/* MD
  ### ✏️ Inline metadata edit
  When a coordinator spots a wrong discipline tag, they should be able to correct it
  right in the file row rather than navigating to a separate form. The edit stays
  pending — visible as an unsaved diff — so the UI can show exactly what will change
  before anything is written.

  Entering the edit state carries the selected files along, so the form always knows
  which file it is editing. Cancelling discards all pending values and returns to the
  exact same selection — nothing is sent to the backend.
*/

log("\n--- inline edit: cancel ---");
cde.sendMachineEvent({ type: "SELECT", files: [mockFiles[0]] });
cde.sendMachineEvent({ type: "START_EDIT" });
cde.sendMachineEvent({ type: "UPDATE_METADATA", key: "phase", value: "SD" });

if (cde.machineState.kind === "editing") {
  log(`  pending phase: ${cde.machineState.pendingMetadata.phase}`);
}

cde.sendMachineEvent({ type: "CANCEL_EDIT" });
// The original mockFiles[0] reference is unchanged — nothing was applied.
log(`  phase after cancel: ${mockFiles[0].metadata.phase}`);

/* MD
  Committing the edit applies the pending values to the file in memory and returns to
  the selection, with the file already reflecting its new values. With a live backend,
  the changes are persisted before the transition completes; without one, the local
  update still happens. Either way, the updated file is in the machine state's
  selection — not in the original array reference.
*/

log("\n--- inline edit: save ---");
// Re-enter from the current "selected" state.
cde.sendMachineEvent({ type: "START_EDIT" });
cde.sendMachineEvent({ type: "UPDATE_METADATA", key: "phase", value: "SD" });
cde.sendMachineEvent({ type: "SAVE" });

// _saveFileMetadata without a client applies the edit locally and returns synchronously.
if (cde.machineState.kind === "selected") {
  log(`  phase after save: ${cde.machineState.files[0].metadata.phase}`);
}

/* MD
  ### 🏷️ Optimistic rename
  Renaming a file can't wait for a server round-trip — the user should see the new
  name appear immediately. The rename applies locally the moment it is triggered, then
  a confirmation arrives once the backend has saved it. If the server rejects the
  change, the name reverts automatically and a rollback event is fired so the UI can
  notify the user.

  Without a live backend, the local rename still applies and the file list updates —
  only the server confirmation step is skipped, so the rollback path is never reached.
*/

log("\n--- rename immediate ---");
cde.sendMachineEvent({ type: "RENAME_FILE_IMMEDIATE", fileId: "f1", name: "column-v2.ifc" });

const renamedFile = cde.files.find(f => f._id === "f1")!;
log(`  local name: ${renamedFile.name}`);
// onRenameCompleted fires only with a live client — skipped here.

// Restore the original name so the view-flow demo works with "column.ifc".
cde.sendMachineEvent({ type: "RENAME_FILE_IMMEDIATE", fileId: "f1", name: "column.ifc" });

/* MD
  ### 👁️ Viewer
  Opening files in the viewer is a state transition, not a direct method call. This
  keeps the viewer component decoupled from the file table — any part of the platform
  can request a view by sending an event, and the viewer just reacts to the state
  change. No direct reference from one component to the other is required.

  When a viewer group supports multiple files, a second can be added while the first
  is still loading. Each file tracks its own load status independently, so the viewer
  can show a spinner per model without needing its own state management.
*/

log("\n--- view: open and add ---");
cde.sendMachineEvent({ type: "SELECT", files: [mockFiles[0]] });
cde.sendMachineEvent({ type: "VIEW" });

// The viewer calls this once its geometry is ready — here we simulate it.
cde.sendMachineEvent({ type: "SET_VIEW_FILE_STATUS", fileId: "f1", status: "ready" });

cde.sendMachineEvent({ type: "ADD_TO_VIEW", file: mockFiles[1] });

if (cde.machineState.kind === "viewing") {
  log(`  files in viewer: ${cde.machineState.files.length}`);
  log(`  f1: ${cde.machineState.fileStatus["f1"]}, f2: ${cde.machineState.fileStatus["f2"]}`);
}

cde.sendMachineEvent({ type: "SET_VIEW_FILE_STATUS", fileId: "f2", status: "ready" });

/* MD
  Removing the last file from the viewer closes it entirely — the state moves to idle
  rather than back to a selection, since there is nothing left to select. Removing one
  of several files leaves the rest open.

  Alternatively, closing the viewer explicitly returns to the selection state with the
  same files still highlighted — useful when the user wants to go back to the file
  table without losing which row was active.
*/

log("\n--- view: remove one by one ---");
cde.sendMachineEvent({ type: "REMOVE_FROM_VIEW", fileId: "f1" });
log(`  after removing f1: ${cde.machineState.kind}`);

cde.sendMachineEvent({ type: "REMOVE_FROM_VIEW", fileId: "f2" });
log(`  after removing last: ${cde.machineState.kind}`);

log("\n--- view: close keeps selection ---");
cde.sendMachineEvent({ type: "SELECT", files: [mockFiles[0]] });
cde.sendMachineEvent({ type: "VIEW" });
cde.sendMachineEvent({ type: "CLOSE_VIEW" });
log(`  state: ${cde.machineState.kind}`);
if (cde.machineState.kind === "selected") {
  log(`  selection preserved: ${cde.machineState.files.length} file(s)`);
}

/* MD
  ### 🌐 Download and archive (requires credentials)
  Download has to fetch file content from the backend, and archive needs the account
  to have delete access on the project — so both flows require live credentials. Pass
  them as query parameters to run this section:

    example.html?accessToken=<token>&apiUrl=https://...&projectId=<id>

  We create a throwaway file here so the demo is self-contained and leaves no
  permanent changes in the project.
*/

const params = new URLSearchParams(location.search);
const accessToken = params.get("accessToken");
const apiUrl = params.get("apiUrl");
const projectId = params.get("projectId");

if (accessToken && apiUrl && projectId) {
  const { EngineServicesClient } = await import("thatopen-services");
  const client = new EngineServicesClient(accessToken, apiUrl);
  // Replace the mock context with the real one.
  cde.ctx = { client, projectId };

  // loadFolders also resolves user permissions — needed before archive.
  await cde.loadFolders();
  log(`\nProject: "${cde.projectName}", canDelete: ${cde.userPermissions.canDelete}`);

  // Create a throwaway file so the demo doesn't touch existing project data.
  const blob = new Blob([JSON.stringify({ demo: true })], { type: "application/json" });
  const { item } = await client.createFile({
    file: blob, name: `__example-test__-${Date.now()}.json`, versionTag: "v1", projectId,
  });
  const liveFile: CDEFile = {
    ...item,
    createdAt: new Date(item.createdAt),
    createdBy: "",
    metadata: {},
  } as CDEFile;
  cde.files = [liveFile];
  log(`Created test file: ${item._id}`);

  // --- Download ---
  log("\n--- download ---");
  cde.sendMachineEvent({ type: "SELECT", files: [liveFile] });
  // onDownloadReady fires with { blob, filename } — multiple selected files are zipped.
  await new Promise<void>(resolve => {
    cde.onDownloadReady.add(() => resolve());
    cde.sendMachineEvent({ type: "DOWNLOAD" });
  });

  // --- Archive ---
  // ARCHIVE_FILE is silently ignored if the account lacks delete permission.
  if (cde.userPermissions.canDelete) {
    log("\n--- archive ---");
    cde.sendMachineEvent({ type: "SELECT", files: [liveFile] });
    await new Promise<void>(resolve => {
      cde.onMachineStateChanged.add((s) => {
        if (s.kind === "idle" || s.kind === "error") resolve();
      });
      cde.sendMachineEvent({ type: "ARCHIVE_FILE" });
    });

    if (cde.machineState.kind === "error") {
      log(`  archive failed: ${cde.machineState.reason}`);
      cde.sendMachineEvent({ type: "DISMISS" });
      await client.archiveFile(item._id as string);
    } else {
      log(`  archived. Files in cde: ${cde.files.length}`);
    }
  } else {
    log("Archive skipped — no delete permission. Cleaning up directly.");
    await client.archiveFile(item._id as string);
  }
} else {
  log("\nDownload and archive skipped — pass ?accessToken=&apiUrl=&projectId= to run.");
}
