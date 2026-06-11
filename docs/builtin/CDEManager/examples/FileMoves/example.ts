/* MD
  ## Drag-and-drop file and folder moves
  ---
  A coordinator restructures the project after a scope change: structural files move
  from the root into a dedicated discipline folder, a MEP sub-folder needs to be
  promoted to the top level, and a few documents need to come back to root to appear
  in the general view. Drag-and-drop is the natural gesture for all of this, but
  each drag session has intermediate stages — the file is "in the air", hovering over
  a candidate target — and every panel watching the file table should see the right
  state without coordinating directly with the drag component.

  CDEManager models drag-and-drop as a sequence of typed state transitions. Picking
  up files moves the machine to a dragging state that carries the files being dragged
  and where they came from. Dropping onto a target kicks off the API call and advances
  to a moving state. Releasing outside any drop zone cancels the drag and returns the
  machine to exactly the state it was in before the drag started — idle or a selection.
  Folder drags work the same way, with their own separate completion event.

  This tutorial covers starting a file drag from idle and from an active selection;
  cancelling the drag and confirming which state the machine returns to; committing
  a drop onto a folder and reading the moved files from the completion event; moving
  files back to the project root by passing a null target folder; and starting,
  cancelling, and committing a folder drag.

  By the end, you'll have a working demonstration of the full drag-and-drop cycle for
  both files and folders — start, cancel, and commit — with all state transitions and
  completion events verified against mock data.
*/

import * as OBC from "@thatopen/components";
// In production platform apps, CDEManager is loaded through the platform client:
//   const cde = await client.initBuiltInComponent(CDEManager.uuid, components);
// Here we import directly from source for local testing.
import { CDEManager } from "../../index";
import type { CDEFile } from "../../src/types";

/* MD
  ### 🛠️ Setting up
  File and folder moves are permission-gated, so we simulate the platform startup step
  that loads user permissions. The mock client also provides `updateItem` for file
  moves and `resolveAccessToken` for folder moves, which use different backend paths.
*/

const components = new OBC.Components();
const cde = components.get(CDEManager);

const output = document.getElementById("output") as HTMLPreElement;
const log = (msg: string) => { console.log(msg); output.textContent += msg + "\n"; };

const mockClient = {
  checkPermissionBatch: async () => Array(5).fill({ hasPermission: true }),
  getProjectData: async () => ({ project: { title: "" }, users: [] }),
  listFolders: async () => [],
  updateItem: async (_id: string, _updates: any) => ({}),
  resolveAccessToken: async () => "mock-token",
  context: { apiUrl: "https://mock.api" },
};

cde.ctx = { client: mockClient as any, projectId: "mock" };
await cde.loadFolders();

const folders = [
  { _id: "folder-str", name: "Structural", parentId: null },
  { _id: "folder-arch", name: "Architecture", parentId: null },
  { _id: "folder-mep", name: "MEP", parentId: "folder-arch" },
];
cde.folders = folders as any;

const now = new Date();
const mockFiles: CDEFile[] = [
  { _id: "f1", name: "column.ifc", folderId: null, createdBy: "alice", createdAt: now, metadata: {} } as CDEFile,
  { _id: "f2", name: "foundations.ifc", folderId: null, createdBy: "alice", createdAt: now, metadata: {} } as CDEFile,
  { _id: "f3", name: "duct.ifc", folderId: "folder-arch", createdBy: "bob", createdAt: now, metadata: {} } as CDEFile,
];
cde.files = mockFiles;

cde.onMachineStateChanged.add((s) => log(`  → ${s.kind}`));
cde.onFilesMovedCompleted.add(({ files, targetFolderName }) =>
  log(`  [onFilesMovedCompleted] ${files.length} file(s) → "${targetFolderName ?? "root"}"`)
);
cde.onFolderMovedCompleted.add(({ folderName, targetFolderName }) =>
  log(`  [onFolderMovedCompleted] "${folderName}" → "${targetFolderName ?? "root"}"`)
);

/* MD
  ### 🖱️ File drag — cancel
  Starting a drag records the dragged files and the folder they came from. Cancelling
  — for example when the user releases the mouse outside any drop target — returns the
  machine to the state it was in when the drag started. If the drag started from idle,
  it returns to idle. If it started from a selection, the same selection is restored.
*/

log("\n--- file drag: cancel from idle ---");
cde.sendMachineEvent({ type: "START_DRAG", files: [mockFiles[0]], sourceFolderId: null });

if (cde.machineState.kind === "dragging") {
  log(`  dragging: ${cde.machineState.files.length} file(s) from "${cde.machineState.sourceFolderId ?? "root"}"`);
}

cde.sendMachineEvent({ type: "END_DRAG" });
log(`  state after cancel: ${cde.machineState.kind}`);

log("\n--- file drag: cancel from selection ---");
cde.sendMachineEvent({ type: "SELECT", files: [mockFiles[0], mockFiles[1]] });
// Drag starts from "selected" — previousState carries the selection.
cde.sendMachineEvent({ type: "START_DRAG", files: [mockFiles[0]], sourceFolderId: null });
cde.sendMachineEvent({ type: "END_DRAG" });
log(`  state after cancel: ${cde.machineState.kind}`);
if (cde.machineState.kind === "selected") {
  log(`  selection preserved: ${cde.machineState.files.length} file(s)`);
}

/* MD
  ### 📁 File drag — drop onto a folder
  When the user drops files onto a valid folder target, the machine moves to a moving
  state and the API call runs. On completion, the moved files reflect their new folder
  and the machine returns to idle. The completion event carries both the updated files
  and the target folder name, so the UI can show a confirmation without reading the
  whole file list.
*/

log("\n--- file drag: drop onto folder ---");
cde.sendMachineEvent({ type: "DESELECT" });
cde.sendMachineEvent({ type: "START_DRAG", files: [mockFiles[0], mockFiles[1]], sourceFolderId: null });

await new Promise<void>(resolve => {
  cde.onFilesMovedCompleted.add(() => resolve());
  cde.sendMachineEvent({ type: "DROP_FILES", targetFolderId: "folder-str" });
});

log(`  state after move: ${cde.machineState.kind}`);
const f1Updated = cde.files.find(f => f._id === "f1")!;
log(`  f1 folderId: ${(f1Updated as any).folderId}`);

/* MD
  ### 🏠 File drag — drop at root
  Dropping files without specifying a target folder moves them to the project root.
  The completion event's `targetFolderName` is null for root drops, which the UI can
  use to display "Moved to root" instead of a folder name.
*/

log("\n--- file drag: drop at root ---");
cde.sendMachineEvent({ type: "START_DRAG", files: [mockFiles[2]], sourceFolderId: "folder-arch" });

await new Promise<void>(resolve => {
  cde.onFilesMovedCompleted.add(() => resolve());
  cde.sendMachineEvent({ type: "DROP_FILES", targetFolderId: null });
});

log(`  state after move: ${cde.machineState.kind}`);
const f3Updated = cde.files.find(f => f._id === "f3")!;
log(`  f3 folderId: ${(f3Updated as any).folderId ?? "root"}`);

/* MD
  ### 📂 Folder drag — cancel and commit
  Folder drags follow the same state sequence as file drags. Cancelling a folder drag
  returns to the previous state unchanged. Committing calls a dedicated backend
  endpoint and fires a separate completion event with the folder names involved, which
  the UI uses for confirmation messages.
*/

log("\n--- folder drag: cancel ---");
cde.sendMachineEvent({ type: "START_FOLDER_DRAG", folderId: "folder-mep", parentFolderId: "folder-arch" });

if (cde.machineState.kind === "draggingFolder") {
  log(`  draggingFolder: "${cde.machineState.folderId}"`);
}

cde.sendMachineEvent({ type: "END_FOLDER_DRAG" });
log(`  state after cancel: ${cde.machineState.kind}`);

log("\n--- folder drag: commit ---");
// _moveFolder calls fetch directly; intercept it for the mock.
const realFetch = globalThis.fetch;
globalThis.fetch = async () => new Response("{}", { status: 200 });

cde.sendMachineEvent({ type: "START_FOLDER_DRAG", folderId: "folder-mep", parentFolderId: "folder-arch" });

await new Promise<void>(resolve => {
  cde.onFolderMovedCompleted.add(() => resolve());
  // Move MEP out of Architecture and into Structural.
  cde.sendMachineEvent({ type: "DROP_FOLDER", targetFolderId: "folder-str" });
});

globalThis.fetch = realFetch;
log(`  state after commit: ${cde.machineState.kind}`);
