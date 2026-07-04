/* MD
  ## top-models-list
  ---
  top-models-list is the project files panel: it lists the project's files, uploads new ones, converts IFC to fragments, and loads `.frag` models into the 3D scene. Its loaders are PLUGGABLE — the panel owns the UI and the orchestration (progress, refresh, association), but the HOST decides how each file format is loaded, so you can teach it new formats without forking the built-in.

  This tutorial covers the two extension points. First, registering a custom loader for a file extension — either imperatively with `registerLoader(ext, fn)` or up front via the `loaders` property; a loader receives `(fileId, ctx)` where `ctx` carries the engine (`components`), the platform `client`, and per-file alignment persistence. A format with no registered loader simply hides its load action. Second, overriding the IFC to fragments `converter` — omit it to use the built-in default (which drives the project's IfcFragmenter cloud component), or provide one to run conversion elsewhere.

  By the end you'll have a files panel that knows how to load a custom format and how to run a custom IFC conversion, with the panel's UI untouched.
*/

import { html } from "lit";
import * as THREE from "three";
import * as OBC from "@thatopen/components";
import * as OBF from "@thatopen/components-front";
import * as FRAGS from "@thatopen/fragments";
import * as BUI from "@thatopen/ui";
import { PlatformClient } from "thatopen-services";
import uiManagerDef from "../../index";
import type { App } from "../app/index";
import type { ModelsList } from "./index";

const UIManager = uiManagerDef.componentDefinition;

const client = PlatformClient.fromPlatformContext();

// UIManager registers every platform web component (top-app, top-viewer,
// top-models-list, …) before the DOM renders.
const { components } = (await client.setup(
  { OBC, OBF, BUI, THREE, FRAGS },
  { uuid: UIManager.uuid },
)) as { components: OBC.Components };

components.get(UIManager).init();

const app = document.createElement("top-app") as unknown as App;

app.setup = (waitUntil) => {
  waitUntil(
    (async () => {
      const fragments = components.get(OBC.FragmentsManager);
      const workerUrl = await FRAGS.FragmentsModels.getWorker();
      fragments.init(await FRAGS.toClassicWorker(workerUrl), {
        classicWorker: true,
      });
    })(),
    "Fragments Core",
  );
  return { components, client };
};

// One stable <top-models-list>, kept by reference so re-rendering top-app reuses
// it. The loaders are read LIVE, so registration can happen at any time.
const modelsList = document.createElement("top-models-list") as ModelsList;

// ── Extension point 1: a custom loader, keyed by file extension ──────────────
// A ModelLoader is `(fileId, ctx) => void | Promise<void>`. The panel calls it
// when the user loads a file whose extension matches. `ctx` gives you everything
// you need: { name, ext, components, client, getAlignment, setAlignment }. Do
// whatever it takes to put the file in the scene — fetch it via the client,
// parse it, and add geometry to a world from `components`.
modelsList.registerLoader("xyz", async (fileId, ctx) => {
  // const buffer = await ctx.client
  //   .downloadFile(fileId)
  //   .then((r: Response) => r.arrayBuffer());
  // ...parse `buffer` and add it to the world here...
  // Persist/restore a placement matrix across reloads via the panel's app-data:
  //   const saved = ctx.getAlignment(fileId);
  //   ctx.setAlignment(fileId, matrix.toArray());
  console.log(`[xyz loader] would load "${ctx.name}" (${fileId})`, ctx.components);
});

// Equivalent declarative form — hand the whole registry over at once:
//   modelsList.loaders = { xyz: async (fileId, ctx) => { ... } };
//
// Registering a loader for an extension is also what makes that format's files
// APPEAR in the list (recognition follows the loaders registry). For a
// CONVERT-style action — e.g. a PLY that runs a PLY→3D-tiles cloud component
// then views the result — register a RICH entry so the button reads correctly:
//   modelsList.registerLoader("ply", {
//     label: "Generate 3D tiles",
//     icon: "mdi:cube-scan",
//     fn: async (fileId, ctx) => {
//       // const { executionId } = await ctx.client.executeComponent(...);
//       // ...poll until done, then open the produced tileset...
//     },
//   });

// ── Extension point 2: override the IFC → fragments converter ────────────────
// OMIT this to keep the built-in default (drives the project's IfcFragmenter
// cloud component via the platform client). Provide it to run conversion
// elsewhere / differently — the panel keeps the progress bar, reload-survival,
// association and refresh; your converter just `start`s and is `poll`ed.
modelsList.converter = {
  async start(fileId) {
    // kick off your conversion; return an execution id to poll
    return `exec-${fileId}`;
  },
  async poll(executionId) {
    // report progress; when done, hand back the produced .frag id
    return { done: true, ok: true, fragId: "demo-frag", message: "Converted" };
  },
};

// Mount the panel into a one-area layout. (In a real app it sits beside a
// top-viewer so loaded models have a world to render into.)
app.elements = {
  files: () => html`${modelsList}`,
};
app.layouts = {
  main: {
    label: "Files",
    icon: "mdi:folder-multiple-outline",
    template: `"files" 1fr / 1fr`,
  },
};
app.layout = "main";

const container = document.getElementById("that-open-app") ?? document.body;
container.appendChild(app);
document.body.style.margin = "0";
