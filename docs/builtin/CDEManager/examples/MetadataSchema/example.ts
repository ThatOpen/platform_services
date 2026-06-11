/* MD
  ## Metadata schema — define, stage, and publish field definitions
  ---
  Every project has its own vocabulary for describing files: discipline codes,
  revision phases, area zones, review statuses. A metadata schema defines which
  fields exist, what values they accept, and whether they are mandatory. Without a
  structured schema, each user invents their own labels and the file list becomes
  impossible to filter or report on consistently.

  CDEManager stages schema changes in memory before anything is written. New fields
  start with a placeholder name and get their permanent key from their label at save
  time. Edits to existing fields are tracked per-key so the UI can show a diff, and
  changes can be reverted field by field. Deletions are staged as null markers, which
  lets the UI still show the field as "pending removal" rather than making it disappear
  immediately.

  This tutorial covers entering schema edit mode; adding new fields and updating their
  definitions; observing that updating a field back to its original values removes it
  from the pending list; staging a deletion and restoring it; and committing the full
  batch, including how new field keys are derived from their label text.

  By the end, you'll understand the full schema editing lifecycle and how the machine
  state carries a complete diff — additions, updates, and deletions — before any
  changes reach the backend.
*/

import * as OBC from "@thatopen/components";
// In production platform apps, CDEManager is loaded through the platform client:
//   const cde = await client.initBuiltInComponent(CDEManager.uuid, components);
// Here we import directly from source for local testing.
import { CDEManager } from "../../index";
import type { CDEMetadataField } from "../../src/types";

/* MD
  ### 🛠️ Setting up
  Schema editing is gated by the manage permission. We use the mock context pattern
  to load permissions, then clear the context — schema staging is entirely in-memory
  and does not need a backend connection. Saving without a context skips persistence
  but still applies the changes locally, which is enough to verify the machine behavior.
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

// Seed an initial schema to work with.
cde.metadataSchema = {
  discipline: { label: "Discipline", type: "string", required: true },
  phase:      { label: "Phase",      type: "string", required: false },
};

cde.onMachineStateChanged.add((s) => log(`  → ${s.kind}`));

/* MD
  ### ➕ Adding and updating fields
  New fields are added with a placeholder definition and a machine-generated temporary
  key. The actual key is derived from the field label when the schema is saved, so the
  caller only needs to set a meaningful label — not invent a key manually.

  Any update to a field is stored as a replacement of the entire field definition under
  that key. If all properties are changed back to the original values, the edit is
  removed from the pending list automatically — no explicit undo step is needed.
*/

log("\n--- add and update ---");
cde.sendMachineEvent({ type: "START_CONFIGURE_METADATA_SCHEMA" });

// New field starts as "New Field" with a temp key like "field_1234567890".
cde.sendMachineEvent({ type: "ADD_METADATA_FIELD" });

if (cde.machineState.kind === "configuringMetadataSchema") {
  const tempKey = Object.keys(cde.machineState.pendingEdits).find(k => k.startsWith("field_"))!;
  log(`  new field temp key: ${tempKey.slice(0, 10)}…`);

  // Give it a real label and type.
  cde.sendMachineEvent({
    type: "UPDATE_METADATA_FIELD",
    key: tempKey,
    value: { label: "Issue Phase", type: "list", required: false, options: [{ value: "open", label: "Open" }, { value: "closed", label: "Closed" }] },
  });

  const pending = Object.keys(cde.machineState.pendingEdits);
  log(`  pending fields after update: ${pending.length}`);
}

// Update an existing field — changes are tracked separately from new ones.
cde.sendMachineEvent({
  type: "UPDATE_METADATA_FIELD",
  key: "discipline",
  value: { label: "Discipline", type: "string", required: false },
});

if (cde.machineState.kind === "configuringMetadataSchema") {
  log(`  discipline pending: ${Object.keys(cde.machineState.pendingEdits).includes("discipline")}`);
}

cde.sendMachineEvent({ type: "CANCEL_CONFIGURE_METADATA_SCHEMA" });

/* MD
  ### 🔍 Smart update diff
  Updating a field back to exactly its original values removes it from the pending
  list. This keeps the diff clean — the UI doesn't need to track which changes were
  reverted, it just reads the pending list.
*/

log("\n--- smart diff on update ---");
cde.sendMachineEvent({ type: "START_CONFIGURE_METADATA_SCHEMA" });

// Change discipline's required flag.
cde.sendMachineEvent({
  type: "UPDATE_METADATA_FIELD",
  key: "discipline",
  value: { label: "Discipline", type: "string", required: false },
});
if (cde.machineState.kind === "configuringMetadataSchema") {
  log(`  discipline in pending: ${Object.keys(cde.machineState.pendingEdits).includes("discipline")}`);
}

// Revert to the original — removes it from the pending list automatically.
cde.sendMachineEvent({
  type: "UPDATE_METADATA_FIELD",
  key: "discipline",
  value: { label: "Discipline", type: "string", required: true },
});
if (cde.machineState.kind === "configuringMetadataSchema") {
  log(`  discipline in pending after revert: ${Object.keys(cde.machineState.pendingEdits).includes("discipline")}`);
}

cde.sendMachineEvent({ type: "CANCEL_CONFIGURE_METADATA_SCHEMA" });

/* MD
  ### 🗑️ Deleting and restoring fields
  Deleting an existing field marks it as null in the pending list rather than removing
  it outright, so the UI can still show it as "pending deletion" and let the user
  change their mind. Restoring removes the null marker — the field is back to its
  current state as if it was never staged for deletion.

  Deleting a field that was just added (and therefore does not yet exist in the schema)
  removes it from the pending list entirely — there is nothing to mark for deletion
  because there is nothing to undo.
*/

log("\n--- delete and restore ---");
cde.sendMachineEvent({ type: "START_CONFIGURE_METADATA_SCHEMA" });

// Stage deletion of an existing field.
cde.sendMachineEvent({ type: "DELETE_METADATA_FIELD", key: "phase" });
if (cde.machineState.kind === "configuringMetadataSchema") {
  log(`  phase value in pending: ${JSON.stringify(cde.machineState.pendingEdits["phase"])}`);
}

// Restore it — null marker removed.
cde.sendMachineEvent({ type: "RESTORE_METADATA_FIELD", key: "phase" });
if (cde.machineState.kind === "configuringMetadataSchema") {
  log(`  phase in pending after restore: ${"phase" in cde.machineState.pendingEdits}`);
}

// Add a new field, then delete it — removes it entirely (no null marker needed).
cde.sendMachineEvent({ type: "ADD_METADATA_FIELD" });
const newTempKey = Object.keys(
  (cde.machineState as any).pendingEdits
).find((k: string) => k.startsWith("field_"))!;
cde.sendMachineEvent({ type: "DELETE_METADATA_FIELD", key: newTempKey });
if (cde.machineState.kind === "configuringMetadataSchema") {
  log(`  pending after deleting new field: ${Object.keys(cde.machineState.pendingEdits).length}`);
}

cde.sendMachineEvent({ type: "CANCEL_CONFIGURE_METADATA_SCHEMA" });

/* MD
  ### 💾 Committing the schema
  When the schema is saved, new fields get their permanent key derived from their label
  — spaces become underscores, special characters are stripped. If the derived key
  would collide with an existing one, a numeric suffix is appended automatically.
  After the commit, the pending list is empty and the schema reflects all the staged
  changes.
*/

log("\n--- commit ---");
cde.sendMachineEvent({ type: "START_CONFIGURE_METADATA_SCHEMA" });

// Add a new field: label "Issue Phase" → key will become "issue_phase".
cde.sendMachineEvent({ type: "ADD_METADATA_FIELD" });
const commitTempKey = Object.keys(
  (cde.machineState as any).pendingEdits
).find((k: string) => k.startsWith("field_"))!;
cde.sendMachineEvent({
  type: "UPDATE_METADATA_FIELD",
  key: commitTempKey,
  value: { label: "Issue Phase", type: "string", required: false },
});

// Update an existing field.
cde.sendMachineEvent({
  type: "UPDATE_METADATA_FIELD",
  key: "discipline",
  value: { label: "Discipline", type: "string", required: false },
});

// Stage deletion of "phase".
cde.sendMachineEvent({ type: "DELETE_METADATA_FIELD", key: "phase" });

if (cde.machineState.kind === "configuringMetadataSchema") {
  log(`  pending before save: ${Object.keys(cde.machineState.pendingEdits).length} change(s)`);
}

// Save applies changes locally even without a backend connection.
await new Promise<void>(resolve => {
  cde.onMachineStateChanged.add((s) => { if (s.kind === "idle") resolve(); });
  cde.sendMachineEvent({ type: "SAVE_METADATA_SCHEMA" });
});

log(`  state after save: ${cde.machineState.kind}`);
log(`  schema keys: [${Object.keys(cde.metadataSchema).join(", ")}]`);
log(`  discipline.required: ${cde.metadataSchema["discipline"]?.required}`);
log(`  issue_phase exists: ${"issue_phase" in cde.metadataSchema}`);
log(`  phase removed: ${"phase" in cde.metadataSchema ? "no" : "yes"}`);
