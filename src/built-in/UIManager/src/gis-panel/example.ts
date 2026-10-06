/* MD
  ## gis-panel
  ---
  A georeferenced project is much easier to review with its real surroundings
  around the model, and with the GIS layers of the site (networks, parcels,
  boundaries) switched on and off from a list. Streaming the terrain and
  buildings needs a Cesium Ion token and a way to load and unload them, and
  fine-tuning their position needs a few controls.

  `gis-panel` is a ready-made web component that delivers all of that. It
  connects to `GISManager` automatically and gives the user the token input, the
  button that loads the 3D map, the position fine-tune and the list of the
  project's vector layers.

  This tutorial covers the prerequisites before mounting the panel; dropping it
  into a `top-app` layout next to a 3D viewer; and a breakdown of everything the
  panel handles automatically so you know what you do not need to implement
  yourself.

  By the end, you'll have the GIS controls of your project running in your
  application with a single line of markup.
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
     components, including `<top-gis-panel>` itself. Without it the element is
     unknown to the browser and renders as an empty box.

  2. **`ProjectManager.init(client)` must have resolved.** `GISManager` takes
     the project origin from it: without it the 3D tiles and the vector layers
     are placed around a default origin instead of the project's.

  3. **`GISManager.init(client)` must have resolved**, after `ProjectManager`.
     The panel reads the manager's state when it is
     connected to the document (the token, the tiles state, the tiles offset and
     the layer list), then follows its events. Without `init`, the manifest is
     never read, so the layer list stays empty, and the tiles offset cannot be
     saved.

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

  Add `gis-panel` as a named area in `app.elements` and reference it in your
  layout template. A narrow column on the left of the 3D viewer is the natural
  arrangement: the tiles and the layers are drawn in the viewer's scene.
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
  viewer: () => html`<top-viewer><top-viewer-tools></top-viewer-tools></top-viewer>`,
};

app.layouts = {
  main: {
    label:    "Main",
    icon:     "mdi:earth",
    template: `"gis viewer" 1fr / 22rem 1fr`,
  },
};

app.layout = "main";

const container = document.getElementById("that-open-app") ?? document.body;
container.appendChild(app);
document.body.style.margin = "0";

/* MD
  ### 🤖 What the panel manages automatically

  Once mounted, `gis-panel` takes ownership of the following without any
  further code from you:

  **Cesium Ion token** — a password field holds the token. It is written to
  `GISManager.apiToken` as the user types. The panel does not store it: if
  you want it to survive a reload, set `gis.apiToken` yourself before the
  panel mounts.

  **Loading the 3D map** — the "Load GIS Map" button calls `enableTiles()`
  (disabled until there is a token) and turns into "Unload GIS Map", which calls
  `disableTiles()`. While the tiles load the button shows its loading state. A
  success toast confirms the load, and a failure shows the readable message
  coming from `onLoadError` (invalid token, no access to the tileset, rate
  limit, no connection).

  **Tiles fine-tune offset** — three sliders (East, North, Up, in metres) move
  the tiles through `setTilesOffset`. Once the offset differs from the saved
  one, a "Save offset" button appears. It calls `saveTilesOffset()`, which
  writes the offset into the project's layer manifest, and a toast reports
  whether the save worked. The offset is restored by `GISManager.init` the next
  time the project is opened.

  **Vector layers** — a table lists the layers declared in the manifest
  (`vectorLayersConfig`), each with a checkbox. Checking it loads the layer
  (`loadVectorLayer`), unchecking it removes it (`unloadVectorLayer`), and the
  row shows "(loading…)" in between. If a layer cannot be read, for example an
  unsupported coordinate system, an error toast carries the reason reported by
  `onVectorLayerError`. The list updates by itself if the manifest is read
  after the panel mounts.

  **Registering layers** — the panel only lists and toggles the layers the
  manifest already declares. There is no user interface to upload a shapefile or
  a GeoJSON file, name it and style it yet: your application writes the
  manifest (see the `GISManager` tutorial for its format).

  **Origin** — the project origin is not edited here. It belongs to
  `ProjectManager`, and it is set from the "Coordinates" section of the settings
  panel. The tiles and the layers follow it live.

  **Notifications** — every toast is a `top:notification` event that bubbles up
  to `top-app`, which displays it.

  **Disconnection cleanup** — when the panel is removed from the DOM it
  unsubscribes from every `GISManager` event. The 3D map and the layers stay
  loaded.
*/
