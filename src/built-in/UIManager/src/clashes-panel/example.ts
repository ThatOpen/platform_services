/* MD
  ## clashes-panel
  ---
  BIM coordinators need a dedicated review environment where they can see all
  detected clashes, filter by status, navigate to each issue in the 3D viewer,
  and mark items as resolved — without writing any UI code themselves.

  `clashes-panel` is a ready-made web component that delivers exactly that. It
  connects to `ClashesManager` automatically and manages the entire review
  workflow: the detection matrix, the clash table with status filters, sphere
  markers and element highlights in the viewer, run controls with live progress,
  and a loading skeleton while fresh data reloads after a run completes.

  This tutorial covers the prerequisites before mounting the panel; dropping it
  into a `top-app` layout alongside a 3D viewer; and a detailed breakdown of
  everything the panel handles automatically so you know what you do not need to
  implement yourself.

  By the end, you'll have a fully working clash-review environment running in
  your application with a single line of markup.
*/

import { html } from "lit";
import * as THREE from "three";
import * as OBC from "@thatopen/components";
import * as OBF from "@thatopen/components-front";
import * as FRAGS from "@thatopen/fragments";
import * as BUI from "@thatopen/ui";
import { PlatformClient, UIManager, ClashesManager } from "@thatopen/services";
import type { App } from "../app/index";


/* MD
  ### ✅ Prerequisites

  Two conditions must be met before the panel mounts:

  1. **`UIManager` must be in the setup call.** It registers all platform web
     components, including `<top-clashes-panel>` itself. Without it the element is
     unknown to the browser and renders as an empty box.

  2. **`ClashesManager.init(client)` must have resolved.** The panel reads all
     its initial data from the manager in `connectedCallback`. If `init` has not
     finished, the panel mounts into an empty state and never catches up because
     it only subscribes to change events — it does not poll.

  Both conditions are naturally satisfied when you call `init` before appending
  `top-app` to the document, which is the pattern shown below.
*/

const client = PlatformClient.fromPlatformContext();

const { components } = (await client.setup(
  { OBC, OBF, BUI, THREE, FRAGS },
  { uuid: UIManager.uuid },
  { uuid: ClashesManager.uuid },
)) as { components: OBC.Components };

components.get(UIManager).init();

// init must resolve before top-app (and therefore clashes-panel) mounts.
await components.get(ClashesManager).init(client);

/* MD
  ### 🖥️ Wiring the panel

  Add `clashes-panel` as a named area in `app.elements` and reference it in your
  layout template. A side-by-side layout with the 3D viewer is the most natural
  arrangement — the panel controls markers and highlights directly in the scene.
*/

const app = document.createElement("top-app") as unknown as App;

app.setup = (waitUntil) => {
  waitUntil(
    (async () => {
      const fragments = components.get(OBC.FragmentsManager);
      const workerUrl = await FRAGS.FragmentsModels.getWorker();
      fragments.init(await FRAGS.toClassicWorker(workerUrl), { classicWorker: true });
    })(),
    "Fragments Core",
  );

  waitUntil(
    (async () => {
      const loader = components.get(OBC.IfcLoader);
      await loader.setup();
    })(),
    "IFC Loader",
  );

  return { components, client };
};

app.elements = {
  viewer:  () => html`<top-viewer><top-viewer-tools></top-viewer-tools></top-viewer>`,
  clashes: () => html`<top-clashes-panel></top-clashes-panel>`,
};

app.layouts = {
  main: {
    label:    "Main",
    icon:     "solar:3d-square-bold",
    template: `"viewer clashes" 1fr / 1fr 22rem`,
  },
};

app.layout = "main";

const container = document.getElementById("that-open-app") ?? document.body;
container.appendChild(app);
document.body.style.margin = "0";

/* MD
  ### 🤖 What the panel manages automatically

  Once mounted, `clashes-panel` takes ownership of the following without any
  further code from you:

  **Data synchronization** — the panel subscribes to every `ClashesManager`
  event (`onJobsChanged`, `onRunsChanged`, `onClashesChanged`,
  `onClashStatusChanged`, `onQueriesChanged`, `onRunningJobsChanged`) and keeps
  its tables in sync. Changes made programmatically through the manager API are
  reflected in the panel immediately.

  **Run lifecycle** — a progress callout appears as soon as a run starts
  (`onRunProgress`), updates its percentage and message in real time, and
  disappears when the run completes or errors. If a run was already in progress
  when the page loaded, the panel calls `reconnectIfRunning` automatically when
  the user opens that job.

  **Post-run reload skeleton** — after a successful run the manager reloads clash
  data from storage. During that window (`onReloadingChanged = true`) the panel
  replaces its entire content with an animated skeleton so the user is never left
  looking at stale results that appear final.

  **Sphere markers** — entering a job view places colored spheres in the 3D scene
  at each clash location, transformed from IFC world space to viewer space.
  Selecting a clash in the table zooms the camera, ghosts unrelated elements, and
  re-focuses the markers on the selection. Leaving the job view removes all
  markers and restores the full scene.

  **Element highlights** — element A is highlighted green and element B red for
  every new or active clash in the current job. Selecting a single clash refines
  the highlight to that pair only. Clearing the selection or changing status
  restores the full job highlight.

  **Model awareness** — the panel tracks which fragment models are currently
  loaded in the scene. Markers and highlights are activated only when the relevant
  models are present, and are cleaned up automatically if a model is disposed
  while the panel is open.

  **Save indicator** — a subtle indicator appears while auto-save is in progress
  (`onSaveStart`) and disappears once the write confirms (`onSaveComplete`), so
  users know their status changes and query edits are persisted.

  **Disconnection cleanup** — when the panel is removed from the DOM it calls
  `hideMarkers` and `clearClashHighlight` on the manager, leaving the 3D scene
  clean regardless of what was selected at the time.
*/
