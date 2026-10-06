/* MD
  ## gis-properties-panel
  ---
  A GIS feature (a pipe, a parcel, a manhole) is useless without its
  attributes: diameter, material, owner, installation date. Users want to
  click a feature, in the 3D view or on the map, and read them.

  `gis-properties-panel` is a ready-made web component that delivers exactly
  that. It connects to `GISManager` automatically and shows the attribute table of
  the selected vector feature, with a filter and readable values.

  This tutorial covers the prerequisites before mounting the panel; dropping it
  into a `top-app` layout next to the map; a breakdown of everything the panel
  handles automatically; and how an application can use one properties column
  for both BIM and GIS selections.

  By the end, you'll have GIS attributes on screen with a single line of markup.
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
     components, including `<top-gis-properties-panel>` itself. Without it the element is
     unknown to the browser and renders as an empty box.

  2. **`ProjectManager.init(client)` must have resolved.** `GISManager` takes
     the project origin from it: without it the 3D tiles and the vector layers
     are placed around a default origin instead of the project's.

  3. **`GISManager.init(client)` must have resolved**, after `ProjectManager`.
     The panel itself only listens to selections, but
     without `init` the manifest is never read, so there are no layers to
     select. A panel created after a selection already exists shows that
     selection straight away.

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

  Add `gis-properties-panel` as a named area. Next to the map is the usual
  place: the user clicks a feature on the map or in the 3D view, and reads
  its attributes in the column beside it. Selecting features on the map requires
  `map-panel` (and, as it is documented there, see-through terrain).
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
  gis:        () => html`<top-gis-panel></top-gis-panel>`,
  viewer:     () => html`<top-viewer><top-viewer-tools></top-viewer-tools></top-viewer>`,
  map:        () => html`<top-map-panel></top-map-panel>`,
  properties: () => html`<top-gis-properties-panel></top-gis-properties-panel>`,
};

app.layouts = {
  main: {
    label:    "Main",
    icon:     "mdi:information-outline",
    template: `"gis viewer map" 1fr "gis viewer properties" 1fr / 20rem 1fr 26rem`,
  },
};

app.layout = "main";

const container = document.getElementById("that-open-app") ?? document.body;
container.appendChild(app);
document.body.style.margin = "0";

/* MD
  ### 🤖 What the panel manages automatically

  Once mounted, `gis-properties-panel` takes ownership of the following without
  any further code from you:

  **Selection tracking** — the panel subscribes to `GISManager.onFeatureSelected`,
  so it shows the selected feature whether the click came from the 3D view, the
  map, or your own call to `selectVectorFeature`.

  **Attribute table** — the section is titled with the layer's name, shows the
  geometry type, and lists every attribute of the feature as a name and a value.

  **Filter** — a search box filters the table by attribute name or by visible
  value.

  **Value formatting** — numbers and text are shown as they are, booleans as
  Yes/No, dates as `YYYY-MM-DD` (with the time when they have one) and complex
  values as JSON. Empty values (null, blank text, invalid dates, non-finite
  numbers) are shown as a dimmed dash, and are not matched by the filter.

  **Empty state** — with no selection the panel explains that an element of a
  vector layer has to be selected, and it goes back to that state when the
  selection is cleared.

  **Disconnection cleanup** — when the panel is removed from the DOM it
  unsubscribes from the manager.
*/

/* MD
  ### 🔀 One properties column for BIM and GIS

  The panel only knows about GIS features. If your application has a single
  properties column, switch what it shows from the selection events: the GIS
  panel when a vector feature is selected, the BIM `top-properties-panel` when
  a BIM element is. Keep both elements alive and swap them inside one stable
  container.
*/

const gis = components.get(GISManager);

const bimProperties = document.createElement("top-properties-panel");
const gisProperties = document.createElement("top-gis-properties-panel");
const column = document.createElement("div");
column.style.height = "100%";
column.append(bimProperties);

gis.onFeatureSelected.add((selection) => {
  if (selection) column.replaceChildren(gisProperties);
});

components.get(OBF.Highlighter).events.select.onHighlight.add(() => {
  column.replaceChildren(bimProperties);
});

// Render `column` from the `properties` element of the layout above.
