/* MD
  ## ClashesManager
  ---
  Structural engineers and BIM coordinators routinely detect geometric clashes
  between disciplines — structural steel penetrating ductwork, pipes clashing
  with slabs — and need to track the status of each issue through resolution
  without leaving their BIM environment.

  ClashesManager is the platform-side component that owns clash data: it loads and
  persists jobs, runs, and clashes; launches cloud-based clash detection in a Web
  Worker; and exposes the events and methods needed to build review workflows on
  top of it.

  This tutorial covers initializing the manager from the platform client; the
  recommended `clashes-panel` UI that works out of the box once `init` has been
  called; defining queries and detection matrices for fine-grained control;
  launching a detection run and tracking progress; updating clash status
  programmatically; and rendering sphere markers and element highlights without
  the built-in panel.

  By the end, you'll understand every public surface of ClashesManager and know
  which parts are handled automatically by `clashes-panel` so you can decide how
  much of the stack you need for your use case.
*/

import * as THREE from "three";
import * as OBC from "@thatopen/components";
import * as OBF from "@thatopen/components-front";
import * as FRAGS from "@thatopen/fragments";
import * as BUI from "@thatopen/ui";
import { PlatformClient } from "thatopen-services";
import clashesManagerDef from "./index";

const ClashesManager = clashesManagerDef.componentDefinition;

const client = PlatformClient.fromPlatformContext();

const { components } = (await client.setup(
  { OBC, OBF, BUI, THREE, FRAGS },
  { uuid: ClashesManager.uuid },
)) as { components: OBC.Components };

/* MD
  ### 🚀 Initializing the manager

  `init(client)` is the only call required before using the manager. It:

  - Loads all persisted clash data (jobs, runs, clashes, queries, matrices) from
    the project's cloud storage into memory.
  - Registers `save` and `reload` callbacks so writes are debounced to storage
    automatically and the manager can refresh its data after a run completes.
  - Reads any in-flight cloud executions so that a page reload mid-run doesn't
    lose track of the job.
  - Resolves the engine's active `World` in the background — if no world exists
    yet, it waits until one is created, so the order of initialization does not
    matter.

  After `init` resolves, `manager.ready` is `true` and all data properties
  (`jobs`, `runs`, `clashes`, `queries`, `matrices`) are populated.
*/

const manager = components.get(ClashesManager);
await manager.init(client);

console.log(
  `Loaded ${manager.jobs.length} jobs, ` +
  `${manager.runs.length} runs, ` +
  `${manager.clashes.length} clashes.`,
);

/* MD
  ### 🖥️ Adding the built-in panel (recommended)

  Once `init` has been called, the `<clashes-panel>` web component is the
  recommended way to interact with `ClashesManager`. It covers the full
  review workflow — detection matrix, clash table, sphere markers, status
  filters, run progress — with zero additional wiring.

  `clashes-panel` is registered when `UIManager` is included in the platform
  setup call. See the **clashes-panel** tutorial for the complete setup and a
  detailed breakdown of everything the panel manages automatically.

  The sections below are for cases where you need direct control: building a
  custom UI, integrating clash data into your own panels, or automating status
  updates from outside the panel.
*/

/* MD
  ### 📐 Queries and matrices

  A `ClashQuery` defines a named set of model elements: which files to scan and,
  optionally, which IFC categories or attribute conditions to match. Queries have
  no detection logic of their own — they are inputs to a matrix.

  A `ClashMatrix` pairs queries in an upper-triangle grid. Each active cell
  corresponds to one `ClashJob` that the cloud worker will execute. The matrix
  also carries the clash type (`hard` or `clearance`) and, for clearance checks,
  the tolerance in metres.

  Assigning to `manager.queries` or `manager.matrices` triggers a debounced
  auto-save (2 s). Call `await manager.flush()` to persist immediately before
  navigating away.
*/

const structuralFileId = "file-id-of-structural-model";
const mepFileId        = "file-id-of-mep-model";

manager.queries = [
  {
    id:           "q-structural",
    name:         "Structural",
    modelFileIds: [structuralFileId],
    query:        { categories: ["IFCBEAM", "IFCCOLUMN", "IFCSLAB"] },
  },
  {
    id:           "q-mep",
    name:         "MEP",
    modelFileIds: [mepFileId],
    // Omitting `query` matches all elements with geometry in the listed files.
  },
];

// The matrix below defines a single hard-clash job between Structural and MEP.
// `activePairs` lists the upper-triangle cell keys (queryAId:queryBId).
// `jobIds` is managed by the platform when the matrix is saved; leave it empty
// on first creation and the backend fills it after the first save.
manager.matrices = [
  {
    id:          "matrix-main",
    name:        "Structural vs MEP",
    queryIds:    ["q-structural", "q-mep"],
    activePairs: ["q-structural:q-mep"],
    jobIds:      [],
    jobType:     "hard",
  },
];

await manager.flush();

/* MD
  ### ▶️ Running clash detection

  `run(jobId)` launches a Web Worker that calls the cloud clash-detection
  endpoint. It returns immediately — all feedback arrives through events.

  | Event | Payload | When |
  |-------|---------|------|
  | `onRunProgress` | `{ message, progress }` | Periodically while the worker runs |
  | `onRunComplete` | `{ runId, clashCount }` | Worker finished successfully |
  | `onRunError`    | `{ code?, message }`    | Worker or cloud error |
  | `onRunningJobsChanged` | `Set<string>` | A job starts or finishes |
  | `onReloadingChanged`   | `boolean`     | Data reload after a successful run |

  If the page is reloaded while a run is in progress, `init` re-reads the
  in-flight execution from storage and populates `runningJobIds`. Call
  `reconnectIfRunning(jobId)` to resume receiving progress events for that job.
*/

manager.onRunProgress.add(({ message, progress }) => {
  console.log(`[${progress}%] ${message}`);
});

manager.onRunComplete.add(({ runId, clashCount }) => {
  console.log(`Run ${runId} complete — ${clashCount} clash(es) found.`);
});

manager.onRunError.add(({ code, message }) => {
  console.error(`Run failed (${code ?? "unknown"}): ${message}`);
});

manager.onReloadingChanged.add((reloading) => {
  // Use this flag to show a loading state in a custom UI while fresh data
  // is fetched from storage after the run. clashes-panel handles this automatically.
  console.log(reloading ? "Reloading clash data…" : "Clash data ready.");
});

// Guard: only run if the manager is ready and the job is not already running.
const jobToRun = manager.jobs[0];
if (jobToRun && manager.ready && !manager.runningJobIds.has(jobToRun.id)) {
  manager.run(jobToRun.id);
}

// If a run was already in progress before this page loaded, reconnect to it.
for (const jobId of manager.runningJobIds) {
  manager.reconnectIfRunning(jobId);
}

/* MD
  ### ✅ Updating clash status

  Each clash starts with status `"new"`. Reviewers move clashes through a
  workflow by calling `updateClash`. Valid statuses are:

  - `"new"` — detected, not yet reviewed
  - `"active"` — under investigation
  - `"acknowledged"` — known issue, not blocking
  - `"resolved"` — fixed and verified

  Status changes and comments are persisted automatically via the same
  auto-save mechanism as queries and matrices.

  `runsForJob(jobId)` and `clashesForRun(runId)` let you navigate the history:
  a clash's `firstSeenRunId` / `lastSeenRunId` span shows across which runs it
  was present, so you can determine whether a resolution actually closed it.
*/

manager.onClashStatusChanged.add((allClashes) => {
  const open = allClashes.filter(c => c.status === "new" || c.status === "active");
  console.log(`Open clashes: ${open.length}`);
});

const clashToAcknowledge = manager.clashes[0];
if (clashToAcknowledge) {
  manager.updateClash(clashToAcknowledge.id, {
    status:   "acknowledged",
    comments: "Coordination with MEP team scheduled for next sprint.",
  });
}

// Navigate run history for the first job.
const firstJob = manager.jobs[0];
if (firstJob) {
  const runs = manager.runsForJob(firstJob.id);    // newest first
  const latestRun = runs[0];
  if (latestRun) {
    const clashesInRun = manager.clashesForRun(latestRun.id);
    console.log(`Latest run has ${clashesInRun.length} active clash(es).`);
  }
}

/* MD
  ### 📍 Visualization without the built-in panel

  If you are building a custom UI and not using `clashes-panel`, you can drive
  the visualization layer directly.

  **Sphere markers** — `showMarkers` places colored 3D spheres at clash
  locations in the viewer. Call `hideMarkers` to remove them and re-enable
  hover highlighting. Points are automatically transformed from IFC world space
  to Three.js viewer space using `FragmentsManager.baseCoordinationMatrix`.

  **Element highlights** — `highlightAllClashes` colors element A (green) and
  element B (red) for every new/active clash in the provided list.
  `clearClashHighlight` removes both styles. For single-clash focus, use
  `highlightClash` and pair it with `ghostClashes` to dim everything else.

  **Clustering** — `cluster(clashes, threshold)` groups spatially close clashes
  into a single marker. Pass `threshold = 0` to show one sphere per clash.
  `toViewerPoint` converts a raw IFC point to viewer space if you need to
  position custom objects.
*/

const jobClashes = manager.clashes.filter(c => c.jobId === firstJob?.id);

// Show one marker per clash, colored by status.
manager.showMarkers(
  jobClashes.map(c => ({ id: c.id, point: c.point, count: 1, status: c.status })),
);

// Highlight all open clashes across both element sets.
manager.highlightAllClashes(jobClashes);

// --- Clustered view ---
// Group clashes within 2 m of each other into a single sphere.
const clusters = manager.cluster(jobClashes, 2);
manager.showMarkers(
  clusters.map(group => ({
    point:  group[0].point,
    count:  group.length,
    status: group[0].status,
  })),
);

// Focus on a single clash: ghost everything else and zoom in.
const focusClash = jobClashes[0];
if (focusClash) {
  manager.clearClashHighlight();
  manager.highlightClash(focusClash);
  await manager.ghostClash(focusClash);
}

// Restore full scene when done.
manager.hideMarkers();
manager.clearClashHighlight();
await manager.clearGhostClash();
