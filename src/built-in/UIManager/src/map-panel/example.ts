/* MD
  ## map-panel
  ---
  In a large site, the 3D camera alone is a poor way to get oriented: users
  want a plan view to see where they are, where the GIS features are, and to
  jump somewhere else with a click.

  `map-panel` is a ready-made web component that delivers exactly that: a
  top-down, north-up map of the GIS tiles with the project's vector layers drawn
  over it, a marker for the 3D camera, and your own markers. It connects to
  `GISManager` automatically, and everything on it stays synchronized with
  the 3D view.

  This tutorial covers the prerequisites before mounting the panel; dropping it
  into a `top-app` layout beside the 3D viewer; a breakdown of everything the
  panel handles automatically; and how an application adds its own markers.

  By the end, you'll have an interactive minimap in your application with a
  single line of markup.
*/

import { html } from "lit";
import * as THREE from "three";
import * as OBC from "@thatopen/components";
import * as OBF from "@thatopen/components-front";
import * as FRAGS from "@thatopen/fragments";
import * as BUI from "@thatopen/ui";
import { PlatformClient, UIManager, GISManager, ProjectManager } from "@thatopen/services";
import type { App } from "../app/index";


/* MD
  ### ✅ Prerequisites

  Three conditions must be met before the panel mounts:

  1. **`UIManager` must be in the setup call.** It registers all platform web
     components, including `<top-map-panel>` itself. Without it the element is
     unknown to the browser and renders as an empty box.

  2. **`ProjectManager.init(client)` must have resolved.** `GISManager` takes
     the project origin from it: without it the 3D tiles and the vector layers
     are placed around a default origin instead of the project's.

  3. **`GISManager.init(client)` must have resolved**, after `ProjectManager`.
     The panel needs the 3D tiles to capture the map, and
     `init` is what reads the layer manifest: the captured area is the box
     of all the manifest's layers, so without `init` the area falls back to a
     square around the origin and no layers are drawn over the map.

  Both are satisfied by awaiting the two `init`s, in that order, before
  appending `top-app` to the document, which is the pattern shown below.
*/

const client = PlatformClient.fromPlatformContext();

const { components } = (await client.setup(
  { OBC, OBF, BUI, THREE, FRAGS },
  { uuid: UIManager.uuid },
  { uuid: ProjectManager.uuid },
  { uuid: GISManager.uuid },
)) as { components: OBC.Components };

components.get(UIManager).init();

// Order matters: GISManager reads the origin that ProjectManager has loaded.
await components.get(ProjectManager).init(client);
await components.get(GISManager).init(client);

/* MD
  ### 🖥️ Wiring the panel

  Add `map-panel` as a named area next to the viewer. The map can only be
  captured once the 3D tiles are loaded, so this layout also mounts
  `gis-panel`, which lets the user enter the token and load the map. Your
  application can do the same by code with `GISManager.enableTiles()`. The
  viewer also carries `top-viewer-gis-ghost-button` in a toolbar, which makes the
  map see-through so its vector features can be picked.
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
  gis:    () => html`<top-gis-panel></top-gis-panel>`,
  viewer: () => html`
    <top-viewer>
      <top-viewer-tools></top-viewer-tools>
      <top-viewer-toolbar headless>
        <top-viewer-gis-ghost-button></top-viewer-gis-ghost-button>
      </top-viewer-toolbar>
    </top-viewer>
  `,
  map:    () => html`<top-map-panel></top-map-panel>`,
};

app.layouts = {
  main: {
    label:    "Main",
    icon:     "mdi:map-search-outline",
    template: `"gis viewer map" 1fr / 20rem 1fr 26rem`,
  },
};

app.layout = "main";

const container = document.getElementById("that-open-app") ?? document.body;
container.appendChild(app);
document.body.style.margin = "0";

/* MD
  ### 🤖 What the panel manages automatically

  Once mounted, `map-panel` takes ownership of the following without any
  further code from you:

  **Capturing the map** — a "Capture map" button calls `minimap.captureMap()`.
  It is disabled until the 3D tiles are loaded, with a hint saying so, and a
  failed capture is reported as a toast. A map that has already been captured
  stays on screen if the tiles are unloaded afterwards. The area is the box of
  all the manifest's layers (a square around the origin when there are none),
  and the image has a fixed resolution.

  **Pan and zoom** — the wheel zooms around the cursor and dragging pans. The
  zoom is limited by the image's resolution: the map never magnifies the image
  beyond the point where it is just blur.

  **Live vector layers** — the loaded layers are drawn as 2D vectors under the
  captured image (so they stay crisp at any zoom), with the style of the
  manifest. Where the terrain is opaque it hides them, just like in 3D.

  **Hover and selection, in sync with 3D** — moving over a feature highlights it
  on the map and in the 3D view, and the selected feature is highlighted in both.
  Hovering and clicking features on the map only work while the terrain is
  see-through, since you cannot pick what you cannot see. The
  `<top-viewer-gis-ghost-button>` placed in the viewer toolbar above toggles it
  (it is disabled until the tiles are loaded). An application without a toolbar
  can call `GISManager.setTilesOpacity` with a value below 1 instead.

  **Click to select and focus** — a click on a feature selects it, exactly like a
  3D click (`onFeatureSelected` fires), and the 3D camera flies to it while the
  map zooms to the same neighbourhood. A click on empty ground moves the 3D
  camera there, keeping its height and viewing direction, and leaves the
  selection alone.

  **Camera indicator** — an arrow and a view cone show where the 3D camera is and
  where it looks, live.

  **Markers** — the markers added to `GISManager.minimap` are drawn over the map
  and follow its zoom and pan (see the next section). Markers without their own
  element are drawn as a default badge showing the label.

  **Disconnection cleanup** — when the panel is removed from the DOM it
  unsubscribes from the manager and clears the hover it had set. The capture and
  the markers live in `GISManager`, so a recreated panel (for example after the
  user switches layout) shows them again straight away.
*/

/* MD
  ### 📍 Adding your own markers

  The markers belong to `GISManager.minimap`, not to the panel. Add them with a
  scene position (`vectorLayers.geoToWorld` converts a latitude and a longitude)
  and, optionally, a `createElement` factory to draw them your way. Without the
  factory the panel draws a badge with the label and reports the clicks through
  `onMarkerClicked`.
*/

const gis = components.get(GISManager);

gis.minimap.addMarker({
  id: "site-office",
  label: "Site office",
  position: gis.vectorLayers.geoToWorld(gis.latitude, gis.longitude, gis.height),
});

gis.minimap.onMarkerClicked.add((id) => console.log("marker clicked:", id));
