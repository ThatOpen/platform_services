/* MD
  ## top-viewer
  ---
  Every BIM app needs a 3D viewport: a scene, a camera, a grid, element
  highlighting, and the plumbing to keep loaded models framed and rendering
  efficiently as they stream in. Building that from scratch is a project on
  its own, before a single button or panel gets wired to it.

  `top-viewer` is a ready-made web component that delivers exactly that. Drop
  it into a `top-app` layout and it creates the 3D world, wires camera
  controls, sets up the highlighter, keeps every loaded fragment model framed
  and culled correctly, and exposes four docking slots so toolbars and tools
  can attach to it without any manual overlay/positioning code.

  This tutorial covers the prerequisites; the minimal mount; what the
  viewport does automatically; how docking works; and loading your first
  model into it.

  By the end, you'll have a fully working 3D viewport running in your
  application with a single line of markup.
*/

import { html } from "lit";
import * as THREE from "three";
import * as OBC from "@thatopen/components";
import * as OBF from "@thatopen/components-front";
import * as FRAGS from "@thatopen/fragments";
import * as BUI from "@thatopen/ui";
import { PlatformClient, UIManager } from "@thatopen/services";
import type { App } from "../app/index";

/* MD
  ### ✅ Prerequisites

  Two conditions must be met before `<top-viewer>` does anything useful:

  1. **`UIManager` must be in the setup call.** It registers all platform web
     components, including `<top-viewer>` itself. Without it the element is
     unknown to the browser and renders as an empty box.

  2. **`OBC.FragmentsManager` must be initialized** (`fragments.init(...)`)
     before you try to load any model. `top-viewer` itself doesn't need this
     to mount — its world, camera, and grid are ready the moment it connects
     — but nothing will load until the fragments worker is up.

  Both are naturally satisfied when you do the setup shown below before
  appending `top-app` to the document.
*/

const client = PlatformClient.fromPlatformContext();

const { components } = (await client.setup(
  { OBC, OBF, BUI, THREE, FRAGS },
  { uuid: UIManager.uuid },
)) as { components: OBC.Components };

components.get(UIManager).init();

/* MD
  ### 🖥️ Minimal mount

  `<top-viewer>` alone is a fully working, empty viewport — camera controls,
  grid, and highlighter are already set up, no further code needed:

  ```html
  <top-viewer></top-viewer>
  ```

  It does **not** come with a toolbar. If you want the built-in one, add
  `<top-viewer-toolbar>` as a child (see that component's own tutorial) — a
  bare `<top-viewer>` is intentionally just the viewport.
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
  return { components, client };
};

app.elements = {
  viewer: () => html`<top-viewer></top-viewer>`,
};

app.layouts = {
  main: {
    label: "Main",
    icon: "solar:3d-square-bold",
    template: `"viewer" 1fr / 1fr`,
  },
};

app.layout = "main";

const container = document.getElementById("that-open-app") ?? document.body;
container.appendChild(app);
document.body.style.margin = "0";

/* MD
  ### 🤖 What's handled automatically

  Once mounted, `<top-viewer>` takes ownership of the following without any
  further code from you:

  **World + camera** — an `OBC.SimpleWorld` with a transparent-background
  scene, an `OBC.OrthoPerspectiveCamera` (orbit controls, perspective by
  default), and a reference grid.

  **Highlighter** — `OBF.Highlighter` is set up for the world, ready for any
  built-in or custom code to select/highlight elements.

  **Model framing** — every model loaded through `OBC.FragmentsManager`
  (anywhere in your app, not just inside this component) is automatically
  added to the scene, told which camera to use for culling/LOD, and factored
  into the camera's far-plane distance so large models never get clipped.
  You never need to call `scene.add()` or `useCamera()` yourself.

  **Navigation tools** — the navigation gizmo and active-tool HUD are baked
  onto the viewport overlay the moment the world is ready.

  **Context for descendants** — `<top-viewer>` provides `worldContext` (the
  `OBC.World` instance) to any descendant, regardless of shadow-DOM
  boundaries. `<top-viewer-toolbar>` and its standalone buttons consume it
  this way — you never pass `world` around by hand.

  **Cleanup** — disposes the world (and the highlighter) automatically when
  the element is removed from the DOM.

  ### 🧩 Docking slots

  `<top-viewer>` exposes four named slots for toolbars/tools, arranged around
  the viewport: `"bottom"`, `"top"`, `"left"`, `"right"`. Any element can use
  them, not just `<top-viewer-toolbar>`:

  ```html
  <top-viewer>
    <top-viewer-toolbar></top-viewer-toolbar>            <!-- no slot → auto-docks "bottom" -->
    <my-custom-panel slot="right"></my-custom-panel>
  </top-viewer>
  ```

  A `<top-viewer-toolbar>` added **without** a `slot` attribute is
  auto-docked into `"bottom"` for you — that's the only slot with special
  handling; every other element (or every other slot) needs its `slot`
  attribute set explicitly.

  ### ⚠️ Gotchas

  - **No toolbar is added for you.** A bare `<top-viewer>` has no bottom bar,
    no buttons — just the viewport. If your app expects one, you must add
    `<top-viewer-toolbar>` yourself.
  - **Only `"bottom"`, `"top"`, `"left"`, `"right"` are recognized slot
    names.** Anything else (a typo, or an app-specific name) is not placed
    into any docking area and simply doesn't render where you'd expect.
  - **`worldContext` starts out `undefined`.** World creation is asynchronous
    — any custom descendant consuming the context must handle the
    not-yet-ready case, the same way `<top-viewer-toolbar>` does.
  - **The host needs real, resolved dimensions from its parent.** `width:
    100%; height: 100%` alone isn't enough if the parent's own size hasn't
    resolved (e.g. an unsized grid area) — give the viewer's container an
    explicit size.

  ### 📥 Loading a model

  Load any `.frag` through the shared `OBC.FragmentsManager` — `<top-viewer>`
  picks it up and frames it automatically, no matter where in your app the
  load happens:

  ```ts
  const fragments = components.get(OBC.FragmentsManager);
  const file = await fetch("https://your-storage.example.com/model.frag");
  const buffer = await file.arrayBuffer();
  await fragments.core.load(buffer, { modelId: "example-model" });
  ```
*/
