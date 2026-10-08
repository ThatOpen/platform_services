/* MD
  ## GISManager
  ---
  Georeferenced BIM projects need their surroundings: the real terrain and
  buildings around the model, and the project's GIS layers (parcels, networks,
  boundaries) drawn at the right place in the 3D scene and on a 2D map.

  GISManager is the component that owns all of that. It streams Cesium Ion 3D
  Tiles (Google Photorealistic 3D Tiles by default) around the project origin,
  loads vector layers (shapefile zip or GeoJSON) declared in the project's
  layer manifest, and renders a 2D minimap with markers.

  This tutorial covers initializing the manager from the platform client;
  enabling the 3D tiles; the layer manifest and how heights, styles and
  coordinate systems are read; selecting and focusing features; and the 2D
  minimap with its markers. The recommended UI is provided by `top-gis-panel`,
  `top-map-panel` and `top-gis-properties-panel`.

  GISManager reads the project origin from `ProjectManager`, so initialize
  `ProjectManager` first.

  ### 🖖 Importing our libraries
*/

import * as OBC from "@thatopen/components";
import * as OBF from "@thatopen/components-front";
import * as BUI from "@thatopen/ui";
import * as THREE from "three";
import * as FRAGS from "@thatopen/fragments";
import { PlatformClient, GISManager, ProjectManager } from "@thatopen/services";


/* MD
  ### 🚀 Initializing GISManager
  Both components are set up through the platform client.
  `client.setup(...)` resolves the shared `OBC.Components` instance.
*/

const client = PlatformClient.fromPlatformContext();

const { components } = (await client.setup(
  { OBC, OBF, BUI, THREE, FRAGS },
  { uuid: ProjectManager.uuid },
  { uuid: GISManager.uuid },
)) as { components: OBC.Components };

await components.get(ProjectManager).init(client);

const gis = components.get(GISManager);

/* MD
  `init(client)` restores the project origin from `ProjectManager` and reads
  the project's layer manifest (see below). It never throws: with no project or
  no stored file the manager just keeps its defaults, and an empty layer list.
*/

await gis.init(client);
console.log("layers:", gis.vectorLayersConfig);

/* MD
  ### 🌍 3D tiles
  Streaming the tiles needs a Cesium Ion token. The component does not persist
  the token anywhere: your application provides it (from its own settings, or
  typed by the user in `top-gis-panel`) before enabling the tiles.

  `enableTiles()` resolves once the first tiles are loaded and rejects with a
  readable message if the token is invalid or has no access to the tileset (the
  same message is also fired through `onLoadError`).
*/

gis.onLoadError.add((message) => console.warn("GIS tiles:", message));

gis.apiToken = "<your Cesium Ion token>";
await gis.enableTiles();

/* MD
  `onStateChanged` fires whenever the token, origin, tiles visibility, tiles
  offset or tiles opacity change, with a plain snapshot of all of them.
  `setTilesOpacity(0.5)` makes the tiles see-through (1 = opaque), which lets
  you see vector layers that run underground. `disableTiles()` unloads
  everything.

  On hosts whose engine supports the deferred postproduction pipeline, the
  tiles and the vector layers are drawn through an occlusion pass, which is what
  makes the see-through effect possible. On other hosts they are added to the
  scene directly and stay opaque. You do not need to do anything for this: the
  component detects it.

  On those deferred hosts the tiles also dissolve gradually near the camera's far
  plane instead of ending in a hard edge. `horizonFade` is the fraction of the far
  distance over which this happens: with the default `0.8` and a far plane at
  1000, the tiles are fully visible up to 200 and fully transparent at 1000. It
  combines with the see-through opacity, and `0` turns it off. While the map is
  loaded the fade is a fraction of `mapFar` (see below), not of the camera's own
  far plane.

  While the tiles are loaded, the empty background behind them is also painted
  as a sky: a gradient from `skyHorizonColor` (default `#d7e3ee`, a light hazy
  blue) at the horizon to `skyZenithColor` (default `#6a9bd1`) straight up, so
  the tiles dissolve into the horizon colour. Set `sky = false` to keep the
  background as it is. Like the fade, it only exists on deferred hosts.

  To let the map reach the horizon, `GISManager` takes over the far plane of the
  world's cameras while the tiles are loaded: `mapFar`, `10000` by default. With
  the default `horizonFade` of `0.8` the map is fully visible up to 2 km and
  fades out until 10 km. A far plane the application or the user set is only
  remembered while the map is loaded and comes back when `disableTiles()` runs
  (a larger far set by code that grows it, for example when it loads a large
  point cloud, is respected, and kept). Setting `mapFar` while the map is loaded
  applies immediately. This works on every host, deferred or not.
*/

gis.horizonFade = 0.4;
gis.mapFar = 15000;
gis.skyHorizonColor = "#e8d9c5";
gis.skyZenithColor = new THREE.Color(0x4f86c6);
gis.sky = true;

gis.onStateChanged.add((state) => console.log("tiles visible:", state.tilesVisible));
gis.setTilesOpacity(0.6);

/* MD
  A small East/North/Up correction (in metres) can be applied to the tiles to
  compensate for the tileset's own positioning error. Persist it with
  `saveTilesOffset()`; it is stored in the same file as the layer manifest and
  restored by `init`.
*/

gis.onOffsetSaveComplete.add((success) => console.log("offset saved:", success));
gis.setTilesOffset(0.5, -0.3, 0);
gis.saveTilesOffset();

/* MD
  ### 🗂️ The layer manifest
  The vector layers of a project are declared in one JSON file,
  `{GISManager.uuid}.json`, stored loose in the project's `__project_data`
  folder. `init(client)` reads it into `gis.vectorLayersConfig`; it only holds
  metadata (the geometry stays in the layer's own file, referenced by `fileId`
  and downloaded when the layer is loaded).

  There is no user interface to register layers yet: the manifest is written by
  your application (or by hand). The component only reads it, and rewrites it
  (keeping `layers` as they are) when the tiles offset is saved.

  Each entry of `layers` has:

  - `id` — unique id, used by every API below.
  - `name` — display name (shown by the panels).
  - `fileId` — id of the layer's file in the project.
  - `type` — `"shapefile"` (a zip with the `.shp`, `.dbf`, `.prj`… files) or
    `"geojson"`. If it is missing or unrecognised the downloaded bytes decide:
    a zip signature means shapefile, a leading `{` means GeoJSON.
  - `style` — `stroke` (CSS colour), `stroke-width` (pixels), `fill` (CSS
    colour, polygons) and `fill-opacity` (0 to 1). All optional.
  - `height` — optional, how features get their height (next section).

  Here is a complete manifest with a points layer whose vertices carry their
  own height, and a lines layer whose heights come from its attributes:

  ```json
  {
    "layers": [
      {
        "id": "manholes",
        "name": "Manholes",
        "fileId": "<file id of manholes.zip>",
        "type": "shapefile",
        "style": { "stroke": "#ffb300", "stroke-width": 6 },
        "height": { "source": "geometry" }
      },
      {
        "id": "pipes",
        "name": "Pipes",
        "fileId": "<file id of pipes.geojson>",
        "type": "geojson",
        "style": { "stroke": "#1e88e5", "stroke-width": 3 },
        "height": {
          "source": "attributes",
          "startProperty": "z_start",
          "endProperty": "z_end",
          "startDepthProperty": "depth_start",
          "endDepthProperty": "depth_end",
          "nodeLayers": ["manholes"],
          "nodeSnapDistance": 0.5
        }
      }
    ],
    "tilesOffset": { "east": 0.5, "north": -0.3, "up": 0 }
  }
  ```

  Once `init` has read it, every layer can be loaded and unloaded by id.
  `loadVectorLayer` downloads and parses the file; it never throws, failures
  are reported through `onVectorLayerError`.
*/

gis.onLayersLoaded.add((layers) => console.log("manifest read:", layers.length, "layers"));
gis.onVectorLayerError.add(({ id, message }) => console.warn(`Layer ${id}:`, message));

await gis.loadVectorLayer("manholes");
await gis.loadVectorLayer("pipes");

console.log("loaded:", gis.vectorLayers.isLayerLoaded("pipes"));

gis.unloadVectorLayer("manholes");

/* MD
  ### 📏 Layer heights
  The `height` option of a layer decides at what height its features are drawn:

  - **No `height`** — the layer is drawn flat, at the origin's height.
  - **`{ "source": "geometry" }`** — every vertex is placed at its own Z (the
    third GeoJSON coordinate). If any vertex of the layer has no Z, the whole
    layer is drawn flat instead (with a console warning).
  - **`{ "source": "attributes", … }`** — for line features only (other
    geometry types are drawn flat). A line gets a height at its first vertex
    and at its last one, and the vertices in between are interpolated along
    the line. Each end is resolved in this order:
      1. its own height property (`startProperty` / `endProperty`);
      2. otherwise the surface height of the nearest node minus its depth
         property (`startDepthProperty` / `endDepthProperty`). Nodes are the
         points with a Z found in the layers listed in `nodeLayers`, and
         "nearest" means within `nodeSnapDistance` metres (0.5 by default) of
         the line end;
      3. otherwise the height resolved for the other end (the line is drawn
         level);
      4. otherwise the surface height of the nearest node.

    A property counts as missing when it is not a finite number or is exactly
    `0`. Rules 1 and 2 are tried on both ends before rule 3 is applied, so a
    copied height never comes from another copy. A line for which no rule can
    give a height to both ends is not drawn (one console warning per layer
    summarizes how many).

  All heights are orthometric (the usual survey heights above the geoid). The
  component adds the project's geoid undulation, taken from the `ProjectManager`
  CRS, to place them in the scene, and re-places the loaded layers if it changes.
*/

/* MD
  ### 🧭 GeoJSON coordinate systems
  Shapefiles are read with their `.prj`. For GeoJSON layers, the coordinate
  system comes from the legacy `crs` member of the file:

  - Longitude/latitude (`CRS84`, or `EPSG:4326`) is read as it is.
  - `EPSG:3857` and the UTM zones (`EPSG:326xx`, `327xx`, `258xx` and `269xx`)
    are reprojected to longitude/latitude when the layer loads.
  - Any other declared CRS is rejected, and so are projected coordinates in a
    file that declares no `crs`.

  A rejected layer is not loaded, and the reason (for example `Unsupported CRS
  "EPSG:2154"…`) is delivered through `onVectorLayerError`, which is what the
  GIS panel shows as a toast.
*/

/* MD
  ### 🖱️ Selection and focus
  Clicking a feature in the 3D view selects it. `onFeatureSelected` delivers
  the selection (`layerId`, `layerName`, `featureIndex`, `geometryType` and the
  feature's `properties`), or `null` when the selection is cleared. The current
  selection can also be read at any time from `gis.vectorLayers.selection`.

  Your application can select a feature too, optionally flying the camera to
  it. `onFocusRequested` fires with the bounding sphere the camera is sent to,
  which is how the 2D map follows.
*/

gis.onFeatureSelected.add((selection) => {
  if (!selection) return console.log("selection cleared");
  console.log(selection.layerName, selection.geometryType, selection.properties);
});

gis.onFocusRequested.add(({ layerId, featureIndex, sphere }) => {
  console.log("focusing", layerId, featureIndex, "radius:", sphere.radius);
});

gis.selectVectorFeature("pipes", 0, { focus: true });
gis.vectorLayers.clearSelection();

/* MD
  ### 🗺️ The 2D minimap
  `gis.minimap` renders a top-down, north-up image of the 3D tiles that
  `top-map-panel` draws together with the vector layers, the camera and the
  markers.

  `captureMap()` takes the picture. The 3D tiles must be loaded (without them
  the image is empty). The captured area is the bounding box of all the
  manifest's layers, whether they are displayed or not; with no usable layers it
  is a square of `2 * halfExtent` metres (250 by default) centred on the origin.
  The image has a fixed side of `resolution` pixels (2048 by default, limited by
  the GPU), so the larger the area, the coarser the map.
*/

gis.minimap.onCaptured.add((capture) => console.log("map captured:", capture.size, "px"));

gis.minimap.halfExtent = 400;
gis.minimap.resolution = 4096;
const capture = await gis.minimap.captureMap();
document.body.appendChild(capture.image);

/* MD
  `worldToMap` converts a scene position into normalized image coordinates
  (0 to 1, origin at the top-left), and `mapToWorld` does the opposite for a
  horizontal plane at a given height. Both return `null` until a map has been
  captured.
*/

const point = gis.vectorLayers.geoToWorld(gis.latitude, gis.longitude, gis.height);
const onMap = gis.minimap.worldToMap(point);
console.log("origin on the map:", onMap);
console.log("back to the scene:", onMap && gis.minimap.mapToWorld(onMap.x, onMap.y, point.y));

/* MD
  ### 📍 Minimap markers
  Markers are HTML elements drawn over the map by `top-map-panel`. They live in
  the minimap, not in the panel, so they survive the panel being recreated.

  A marker has an `id`, a scene `position` (read on every redraw, so changing
  it moves the marker), an optional `label` and an optional `createElement`
  factory. Without the factory the panel draws a default badge with the label
  and reports its clicks through `onMarkerClicked`. With it, the marker is your
  own element and it owns its click behaviour. It is a factory and not an
  element because each panel needs its own DOM node.

  `geoToWorld(lat, lon, height)` turns a geographic position into a scene
  position.
*/

gis.minimap.onMarkersChanged.add(({ kind, id }) => console.log("markers:", kind, id));
gis.minimap.onMarkerClicked.add((id) => console.log("clicked:", id));

gis.minimap.addMarker({
  id: "site-office",
  label: "Site office",
  position: gis.vectorLayers.geoToWorld(gis.latitude, gis.longitude, gis.height),
});

gis.minimap.addMarker({
  id: "crane",
  position: new THREE.Vector3(-20, 0, 35),
  createElement: () => {
    const pin = document.createElement("div");
    pin.textContent = "🏗️";
    pin.style.fontSize = "1.4rem";
    pin.style.cursor = "pointer";
    pin.onclick = () => console.log("crane clicked");
    return pin;
  },
});

gis.minimap.updateMarker("site-office", { label: "Main office" });
console.log("markers:", [...gis.minimap.markers.keys()]);

gis.minimap.removeMarker("crane");
gis.minimap.clearMarkers();
