/* MD
  ## Metadata views — organize fields into named table layouts
  ---
  A structural engineer and an MEP coordinator look at the same file list but care
  about completely different metadata. Showing every field to everyone produces a
  wide table that is hard to navigate. Metadata views let each role define which
  fields appear in which order — saving the layout so the table opens correctly next
  time without requiring a manual setup every session.

  CDEManager stores a list of named views, each carrying an ordered set of field keys.
  An active view filters both which columns are visible and which metadata groupings
  appear in the sidebar. Changes to the view list are staged in memory first, just like
  schema changes, and saved in one batch — so the user can add, rename, and remove
  views without any partial state reaching the backend.

  This tutorial covers initializing views from a saved configuration; switching the
  active view and reading the result; adding, updating, and removing views in the
  pending list; and committing the full batch, which saves to the user's personal
  config and fires an event with the final view list.

  By the end, you'll know how to load, display, edit, and persist named metadata
  layouts through the state machine.
*/

import * as OBC from "@thatopen/components";
// In production platform apps, CDEManager is loaded through the platform client:
//   const cde = await client.initBuiltInComponent(CDEManager.uuid, components);
// Here we import directly from source for local testing.
import { CDEManager } from "../../index";
import type { CDEMetadataView } from "../../src/types";

/* MD
  ### 🛠️ Setting up
  Loading views from a saved config and switching the active view don't require
  permissions. We still simulate the startup step to load permissions so the save
  path works later, then clear the context — staging is in-memory only.
*/

const components = new OBC.Components();
const cde = components.get(CDEManager);

const output = document.getElementById("output") as HTMLPreElement;
const log = (msg: string) => { console.log(msg); output.textContent += msg + "\n"; };

cde.ctx = {
  client: {
    checkPermissionBatch: async () => Array(5).fill({ hasPermission: true }),
    getProjectData: async () => ({ project: { title: "" }, users: [] }),
    listFolders: async () => [],
  } as any,
  projectId: "mock",
};
await cde.loadFolders();
cde.ctx = undefined;

cde.onMachineStateChanged.add((s) => log(`  → ${s.kind}`));
cde.onMetadataViewsChanged.add((views) => log(`  [onMetadataViewsChanged] ${views.length} view(s)`));

/* MD
  ### 📋 Initializing views from config
  After loading from the backend, views and the last active view ID are pushed into
  CDEManager through `initMetadataViews`. This populates the internal view list and
  fires the views-changed event so any subscribed component can render immediately.
  The active view controls which fields `getSelectedFiles` uses for grouping when
  metadata mode is on.
*/

log("\n--- init views ---");
const savedViews: CDEMetadataView[] = [
  { id: "view-str", name: "Structural", fields: ["discipline", "phase"] },
  { id: "view-mep", name: "MEP", fields: ["discipline", "zone"] },
];
cde.initMetadataViews(savedViews, "view-str");

log(`  metadataViews: ${cde.metadataViews.length}`);
log(`  activeMetadataViewId: ${cde.activeMetadataViewId}`);
log(`  activeMetadataView name: ${cde.activeMetadataView?.name}`);

/* MD
  ### 🔀 Switching the active view
  The active view can be changed from idle, a selection, or while the viewer is open.
  Switching resets the selected metadata group so the table doesn't show a stale
  filter from the previous view's grouping. The transition doesn't change the machine
  state kind — it's a targeted property update, not a full state change.
*/

log("\n--- switch active view ---");
cde.sendMachineEvent({ type: "SET_ACTIVE_METADATA_VIEW", id: "view-mep" });
log(`  active: ${cde.activeMetadataView?.name}`);

cde.sendMachineEvent({ type: "SET_ACTIVE_METADATA_VIEW", id: "view-str" });
log(`  active: ${cde.activeMetadataView?.name}`);

/* MD
  ### ✏️ Staging view changes
  Adding, updating, and removing views all operate on the `pendingViews` list inside
  the machine state. The committed view list is unchanged until the save fires. Adding
  a view generates a stable random ID immediately, so the UI can reference it for
  subsequent updates within the same session without waiting for a server response.
*/

log("\n--- stage: add, update, delete ---");
cde.sendMachineEvent({ type: "START_CONFIGURE_METADATA_VIEWS" });

// Add a new view — gets a UUID immediately.
cde.sendMachineEvent({ type: "ADD_METADATA_VIEW" });

if (cde.machineState.kind === "configuringMetadataViews") {
  const newView = cde.machineState.pendingViews.find(v => v.name === "New View")!;
  log(`  new view id: ${newView.id.slice(0, 8)}…`);

  // Name it and set its fields.
  cde.sendMachineEvent({
    type: "UPDATE_METADATA_VIEW",
    id: newView.id,
    view: { ...newView, name: "Civil", fields: ["discipline", "zone", "level"] },
  });

  log(`  views in pending: ${cde.machineState.pendingViews.length}`);
  log(`  updated view name: ${cde.machineState.pendingViews.find(v => v.id === newView.id)?.name}`);
}

// Remove an existing view from the pending list.
cde.sendMachineEvent({ type: "DELETE_METADATA_VIEW", id: "view-mep" });
if (cde.machineState.kind === "configuringMetadataViews") {
  log(`  views after delete: ${cde.machineState.pendingViews.length}`);
}

cde.sendMachineEvent({ type: "CANCEL_CONFIGURE_METADATA_VIEWS" });
// Cancelled — committed view list is unchanged.
log(`  committed views after cancel: ${cde.metadataViews.length}`);

/* MD
  ### 💾 Committing views
  Saving replaces the committed view list with the pending one and fires the views-
  changed event. The user's personal config is updated at the same time if the account
  has create permission — the same config that `loadUserConfig` reads back on the
  next session load. Without a real user identity in the mock, the persistence step is
  silently skipped but the local update still applies.
*/

log("\n--- commit ---");
cde.sendMachineEvent({ type: "START_CONFIGURE_METADATA_VIEWS" });

cde.sendMachineEvent({ type: "ADD_METADATA_VIEW" });
if (cde.machineState.kind === "configuringMetadataViews") {
  const civil = cde.machineState.pendingViews.find(v => v.name === "New View")!;
  cde.sendMachineEvent({
    type: "UPDATE_METADATA_VIEW",
    id: civil.id,
    view: { ...civil, name: "Civil", fields: ["discipline", "zone"] },
  });
}
cde.sendMachineEvent({ type: "DELETE_METADATA_VIEW", id: "view-mep" });

if (cde.machineState.kind === "configuringMetadataViews") {
  log(`  pending: ${cde.machineState.pendingViews.length} view(s)`);
}

await new Promise<void>(resolve => {
  cde.onMachineStateChanged.add((s) => { if (s.kind === "idle") resolve(); });
  cde.sendMachineEvent({ type: "SAVE_METADATA_VIEWS" });
});

log(`  state after save: ${cde.machineState.kind}`);
log(`  committed views: ${cde.metadataViews.map(v => v.name).join(", ")}`);
