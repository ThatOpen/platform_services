/* MD
  ## CDEManager
  ---
  CDEManager is the central state machine for a Common Data Environment. It holds
  files, folders, metadata schemas, viewer groups, and user permissions, and exposes a
  typed state machine that all file operations — selecting, editing, uploading,
  viewing — route through. It has no DOM or Three.js dependencies and can run in Node,
  a browser, or a server-side worker wherever `@thatopen/components` is available.

  This example shows how to initialize CDEManager, populate it with mock and live data,
  subscribe to its events, navigate the state machine, and build file names from a
  naming schema.

  ### 🖖 Importing our libraries
  First, install all necessary dependencies:
*/

// In production platform apps, CDEManager is loaded through the platform client:
//   const cde = await client.initBuiltInComponent(CDEManager.uuid, components);
// Here we import directly from source for local testing.
import * as OBC from "@thatopen/components";
import { CDEManager } from "./index";
import type { CDEFile } from "./src/types";

/* MD
  ### 🚀 Initializing CDEManager
  CDEManager is an `OBC.Component`, so you get it from the shared `components`
  registry with `components.get(CDEManager)`. The constructor registers it
  automatically — calling `get` a second time returns the same instance.
*/

const components = new OBC.Components();
const cde = components.get(CDEManager);

const output = document.getElementById("output") as HTMLPreElement;
const log = (msg: string) => {
  console.log(msg);
  output.textContent += msg + "\n";
};

/* MD
  ### 📋 Subscribing to events
  All CDEManager events are `OBC.Event<T>` instances. Subscribe before setting data
  so you capture the first trigger.
*/

cde.onFilesChanged.add((files) => {
  log(`[event] onFilesChanged: ${files.length} file(s)`);
});

cde.onFoldersChanged.add((folders) => {
  log(`[event] onFoldersChanged: ${folders.length} folder(s)`);
});

cde.onMachineStateChanged.add((state) => {
  log(`[event] machineState → ${state.kind}`);
});

cde.onSelectedGroupChanged.add((group) => {
  log(`[event] selectedGroup → ${group ?? "(none)"}`);
});

/* MD
  ### 📂 Populating with mock data
  Setting `cde.files` and `cde.folders` directly triggers `onFilesChanged` and
  `onFoldersChanged`. This lets you build and test views without a live backend.
*/

const mockFolder = { _id: "folder-str", name: "Structural", parentId: null };
cde.folders = [mockFolder];

const now = new Date();
const mockFiles: CDEFile[] = [
  {
    _id: "file-col", name: "column.ifc",
    folderId: "folder-str", createdBy: "alice@example.com",
    createdAt: now, metadata: { discipline: "STR", phase: "DD" },
    itemType: "FILE",
  } as CDEFile,
  {
    _id: "file-fnd", name: "foundations.ifc",
    folderId: "folder-str", createdBy: "bob@example.com",
    createdAt: now, metadata: { discipline: "STR", phase: "CD" },
    itemType: "FILE",
  } as CDEFile,
  {
    _id: "file-pdf", name: "report.pdf",
    folderId: null, createdBy: "alice@example.com",
    createdAt: now, metadata: {},
    itemType: "FILE",
  } as CDEFile,
];
cde.files = mockFiles;

/* MD
  ### 🔍 Filtering files: visibleFiles vs getSelectedFiles
  `visibleFiles` excludes files whose folder was marked as a system folder by
  `loadFolders` (folders whose names start with `__`). With mock data set directly,
  no system folders are marked, so all files are always visible.

  `getSelectedFiles` is the folder-scoped view used by the UI table. When
  `selectedGroup` is `null` it returns root files only (no folderId); when set to a
  folder id it returns files in that folder.
*/

log(`\nvisibleFiles (all, no system folders excluded): ${cde.visibleFiles.length}`);

// getSelectedFiles respects selectedGroup, not visibleFiles.
cde.selectedGroup = null;
log(`getSelectedFiles (selectedGroup=null → root only): ${cde.getSelectedFiles().length}`);

cde.selectedGroup = "folder-str";
log(`getSelectedFiles (selectedGroup=folder-str): ${cde.getSelectedFiles().length}`);

/* MD
  ### 🎛️ State machine navigation
  Every UI-level action goes through `sendMachineEvent`. The current state is readable
  via `cde.machineState`. Events that aren't valid for the current state are silently
  ignored — checking `machineState.kind` before sending prevents unexpected no-ops.

  The `"selected"` state stores the selected files in `machineState.files`. This is
  separate from `getSelectedFiles()`, which always returns the current folder view
  regardless of machine state.
*/

log(`\nmachineState before SELECT: ${cde.machineState.kind}`);

cde.sendMachineEvent({ type: "SELECT", files: [mockFiles[0], mockFiles[1]] });
// machineState.files holds the selection — getSelectedFiles() returns the folder view.
const sel = cde.machineState as { kind: string; files?: CDEFile[] };
log(`machineState.files: ${sel.files?.length ?? 0} file(s) selected`);

cde.sendMachineEvent({ type: "DESELECT" });
log(`machineState after DESELECT: ${cde.machineState.kind}`);

/* MD
  ### 🏷️ Viewer groups and canView
  `viewerGroups` declares which file extensions can be loaded side by side.
  `multiple: true` allows multi-file loads; omitting it means only one file at a time.
  `canView` checks whether a set of files belongs to one group and respects the flag.
*/

cde.viewerGroups = [
  { extensions: ["ifc", "frag"], multiple: true },
  { extensions: ["pdf"] },
];

const ifcFiles = mockFiles.filter(f => f.name.endsWith(".ifc"));
log(`\ncanView([column.ifc, foundations.ifc]): ${cde.canView(ifcFiles)}`);
log(`canView([report.pdf]): ${cde.canView([mockFiles[2]])}`);
// Mixed types never share a viewer group, regardless of multiple.
log(`canView([column.ifc, report.pdf]): ${cde.canView([mockFiles[0], mockFiles[2]])}`);

/* MD
  ### 📝 Naming schema
  A naming schema assembles a computed file name from metadata fields. Segments define
  the order and an optional transform; `separator` joins them. If a metadata key is
  absent, `missingMetadataPlaceholder` is used so missing values stay visible.
*/

cde.missingMetadataPlaceholder = "XX";
cde.setNamingSchema({
  segments: [
    { key: "discipline" },
    { key: "phase" },
  ],
  separator: "-",
});

// column.ifc has both fields → "STR-DD"
log(`\nbuildFileName(column.ifc): "${cde.buildFileName(mockFiles[0])}"`);
// report.pdf has no metadata → "XX-XX"
log(`buildFileName(report.pdf): "${cde.buildFileName(mockFiles[2])}"`);

/* MD
  ### 🌐 Live data (requires credentials)
  The live section below connects to a real backend. Pass credentials as query
  parameters when opening example.html:

    example.html?accessToken=<token>&apiUrl=https://...&projectId=<id>

  Without them, this section is skipped.

  `loadFolders()` does more than just fetch folders — it also loads user permissions
  and project members in the same call, then excludes any `__`-prefixed system
  folders from `cde.folders`.
*/

const params = new URLSearchParams(location.search);
const accessToken = params.get("accessToken");
const apiUrl = params.get("apiUrl");
const projectId = params.get("projectId");

if (accessToken && apiUrl && projectId) {
  const { EngineServicesClient } = await import("thatopen-services");
  const client = new EngineServicesClient(accessToken, apiUrl);
  cde.ctx = { client, projectId };

  await cde.loadFolders();
  log(`\nloadFolders: ${cde.folders.length} visible folder(s), project: "${cde.projectName}"`);
  log(`userPermissions: ${JSON.stringify(cde.userPermissions)}`);

  await cde.loadMetadataSchema();
  log(`loadMetadataSchema: ${Object.keys(cde.metadataSchema).length} field(s) defined`);
} else {
  log("\nLive data skipped — pass ?accessToken=&apiUrl=&projectId= to run the full cycle.");
}

/* MD
  ### 🎉 Wrap up
  CDEManager handles state, events, filtering, and naming entirely in memory. The
  backend connection through `cde.ctx` is optional — everything above `loadFolders`
  works offline with mock data. See platform_cde for the full production wiring.
*/
