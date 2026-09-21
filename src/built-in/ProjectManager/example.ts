/* MD
  ## ProjectManager
  ---
  Project-level configuration and data — GIS origin, georeferencing, app
  settings, and other project-scoped concerns — need a single canonical place
  to live. Without it, every builtin that needs to persist something at the
  project level (not per-file, not per-user) ends up inventing its own file,
  its own save/load pattern, and its own place to put it.

  ProjectManager is that canonical store. It persists one JSON file
  (`${ProjectManager.uuid}.json`) loose directly inside `__project_data` — the
  same folder convention `GISManager` already used — rather than in a
  per-app subfolder like `collider`/`cde`, which are reserved for secondary,
  per-builtin data.

  This tutorial covers initializing the manager from the platform client; the
  `origin` and `graphicsSettings` singletons; the `assetCoordinates`
  collection used for splats and point clouds; auto-save and its events; and
  the read-only namespace introspection API.

  ProjectManager has no built-in UI panel — it's a pure data layer. Apps that
  need georeferencing or project-settings UI (like Aqualia's viewer) build it
  on top of this.

  ### 🖖 Importing our libraries
*/

import * as OBC from "@thatopen/components";
import { PlatformClient, ProjectManager } from "@thatopen/services";


/* MD
  ### 🚀 Initializing ProjectManager
  Like any other built-in, ProjectManager is set up through the platform
  client. `client.setup(...)` resolves the shared `OBC.Components` instance
  and gives us back everything we need.
*/

const client = PlatformClient.fromPlatformContext();

const { components } = (await client.setup(
  { OBC },
  { uuid: ProjectManager.uuid },
)) as { components: OBC.Components };

const manager = components.get(ProjectManager);

/* MD
  `init(client)` loads the persisted JSON for the current project — or
  creates it with the default schema if it doesn't exist yet. `manager.ready`
  flips to `true` once that's done, and the entity accessors below are only
  safe to use after that.
*/

await manager.init(client);
console.log("ready:", manager.ready);
console.log("namespaces:", manager.getNamespaces());

manager.onSaveStart.add(() => console.log("[event] onSaveStart"));
manager.onSaveComplete.add((success) => console.log("[event] onSaveComplete:", success));

/* MD
  ### 📍 origin — a singleton entity
  `origin` holds the project's GIS origin: latitude, longitude, height, and
  rotation. Singletons expose `get`/`set`/`update`; `set` replaces the whole
  value, `update` merges a partial one. Both schedule a debounced auto-save —
  call `flush()` to force it immediately and await completion.
*/

console.log("origin before:", manager.origin.get());

await manager.origin.set({ lat: 40.4164, lon: -3.7038, height: 700, rotation: 0 });
await manager.origin.update({ height: 710 });
await manager.flush();

console.log("origin after update+flush:", manager.origin.get());

/* MD
  ### 🖼️ assetCoordinates — the files collection
  `assetCoordinates` georeferences individual files — splats, point clouds —
  that live outside the BIM model tree. Unlike sites, entries are keyed by
  the caller-supplied `fileId`, since that id already comes from the platform
  and is stable by construction.
*/

await manager.assetCoordinates.set("splat_1", {
  type: "splat",
  lat: 40.416600807789145,
  lon: -3.703739209785748,
  height: 727.2700125737748,
  rotation: 0,
});
await manager.flush();

console.log("splats:", manager.assetCoordinates.getByType("splat"));
console.log("splat_1:", manager.assetCoordinates.get("splat_1"));

/* MD
  ### ⚙️ graphicsSettings — another singleton
  Same shape as `origin` — `get`/`set`/`update`, debounced auto-save.
*/

await manager.graphicsSettings.update({ /* project-wide graphics defaults */ } as any);
await manager.flush();

console.log("graphicsSettings:", manager.graphicsSettings.get());

/* MD
  ### 🔍 Namespaces — read-only introspection
  `getNamespaces()` lists the closed set of namespaces the schema defines;
  `getNamespace(key)` returns every entity registered under one. Useful for
  debugging or building a generic project-data inspector — not for reading
  values you already know the shape of, which is what the entity accessors
  above are for.
*/

console.log("georeferencing namespace:", manager.getNamespace("georeferencing"));

/* MD
  ### 🤖 What's not covered here
  ProjectManager ships without a UI panel — everything above is the data
  layer only. Building georeferencing or project-settings UI on top of
  `origin`/`crs`/`assetCoordinates` is up to the consuming app.
*/
