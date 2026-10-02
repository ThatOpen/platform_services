/* MD
  ## top-models-list
  ---
  top-models-list is the project's 3D-viewable-files tree: it mirrors the real storage folder structure, converts IFC to fragments, and loads `.frag`/`.potree`/`.splat` models into the 3D scene. Its loaders are PLUGGABLE — the panel owns the UI and the orchestration (progress, refresh, association), but the HOST decides how each extra file format is loaded, so you can teach it new formats without forking the built-in.

  This tutorial covers the two extension points. First, registering a custom loader for a file extension — either imperatively with `registerLoader(ext, fn)` or up front via the `loaders` property; a loader receives `(fileId, ctx)` where `ctx` carries the engine (`components`), the platform `client`, and per-file alignment persistence. Second, overriding the IFC to fragments `converter` — omit it to use the built-in default (which drives the project's IfcFragmenter cloud component, resolved by its stable name — see `adrs/resolve-ifc-fragmenter-by-stable-name.md`), or provide one to run conversion elsewhere.

  A behaviour worth knowing: registering a loader does NOT control whether a file shows up in the tree — the tree always mirrors the project's real storage folders, so an unrecognized file is still listed as long as it's a source (IFC/LAS/PLY) or derivative (`.frag`/`.potree`/`.splat`) extension; the loaders registry only decides whether a file's row gets a load action or none.

  Known gaps (intentionally deferred, not forgotten): the base-model/auto-coordinate settings aren't ported, and the panel has no default upload of its own: `allow-upload` is opt-in (off by default) and adds an "Upload file" item to the row menu of the root and folder rows, which hands each picked file to the uploader you registered for its extension (see the uploader section below) — files with no uploader aren't uploaded. Everything else per-file is here, including editable attach/detach via a picker — MINUS delete, dropped on purpose. See `models-list/legacy-example.ts` + `models-list/impl.ts` for the retired implementation those gaps would be ported from.

  By the end you'll have a files tree that knows how to load a custom format and how to run a custom IFC conversion, with the panel's UI untouched.
*/

import { html } from "lit";
import * as THREE from "three";
import * as OBC from "@thatopen/components";
import * as OBF from "@thatopen/components-front";
import * as FRAGS from "@thatopen/fragments";
import * as BUI from "@thatopen/ui";
import { PlatformClient, UIManager } from "@thatopen/services";
import type { App } from "../app/index";
import type { ModelsListV2 } from "./src/v2/models-list-panel";


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

// One stable <top-models-list>, kept by reference so re-rendering top-app
// reuses it. The loaders are read LIVE, so registration can happen at any time.
const modelsList = document.createElement("top-models-list") as ModelsListV2;

// ── Extension point 1: a custom loader, keyed by file extension ──────────────
// A ModelLoader is `(fileId, ctx) => void | Promise<void>`. The panel calls it
// when the user loads a file whose extension matches. `ctx` gives you everything
// you need: { name, ext, components, client, getAlignment, setAlignment, progress }.
// For a long-running load call `ctx.progress(percent, label?)` to show it on the
// row (omit `percent` while unknown). Do
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
// Registering a loader for an extension gives its files a load action here —
// but doesn't control visibility (see the note above). For a CONVERT-style
// action — e.g. a PLY that runs a PLY→3D-tiles cloud component then views the
// result — register a RICH entry so the button reads correctly:
//   modelsList.registerLoader("ply", {
//     label: "Generate 3D tiles",
//     icon: "mdi:cube-scan",
//     fn: async (fileId, ctx) => {
//       // const { executionId } = await ctx.client.executeComponent(...);
//       // ...poll until done, then open the produced tileset...
//     },
//   });

// ── Upload: opt in, then register an uploader per file extension ─────────────
// `allow-upload` adds an "Upload file" item to the row menu of the root and
// folder rows. It opens a file picker and hands each picked file to the
// uploader registered for its extension, which fully owns that upload. Files
// whose extension has no uploader are not uploaded (the user gets a warning).
// `ctx` carries { name, ext, folderId, projectId, components, client };
// `folderId` is undefined when the upload was started from the root row. While
// the uploader runs, the panel shows a temporary row for the file; call
// `ctx.progress(percent, label?)` to drive its progress bar (omit `percent`
// while unknown for a spinner). The list refreshes once an uploader has run.
modelsList.setAttribute("allow-upload", "");
modelsList.registerUploader("ifc", async (file, ctx) => {
  // Create the file in `ctx.folderId` (or the project root) with `ctx.client`,
  // upload `file`'s bytes, and report success/failure however your app does.
  ctx.progress(undefined, "Preparing…");
  ctx.progress(50);
  console.log(`[ifc uploader] would upload "${file.name}" to`, ctx.folderId ?? "the project root");
});

// Declarative form: modelsList.uploaders = { ifc: async (file, ctx) => { ... } };

// ── File actions: extra entries in a file row's three-dots menu ──────────────
// The menu already holds the panel's own items (fit camera, attach/detach); the
// actions you register for an extension are added after them. Pass a fixed list,
// or a resolver that runs every time the menu opens (it may be async — the menu
// shows a loading state meanwhile). While an action runs the file's row shows
// its status instead of its buttons: call `ctx.progress(percent, label?)` to
// drive it, and `ctx.reload()` if the action added/removed/renamed files.
modelsList.registerActions("ifc", [
  {
    label: "Re-index",
    icon: "mdi:database-refresh-outline",
    run: async (fileId, ctx) => {
      ctx.progress(undefined, "Indexing…");
      // await ctx.client.…
      ctx.progress(100);
      console.log(`[ifc action] re-indexed "${ctx.name}" (${fileId})`);
    },
  },
]);
modelsList.registerActions("ply", async (fileId, ctx) => {
  // Build the menu from state fetched when it opens, e.g. whether a derived
  // file already exists for `fileId` (using `ctx.client`).
  const alreadyConverted = false;
  return [
    {
      label: "Regenerate 3D tiles",
      icon: "mdi:cube-scan",
      disabled: !alreadyConverted,
      run: async (_id, actionCtx) => {
        actionCtx.progress(25, "Converting…");
        await actionCtx.reload();
      },
    },
  ];
});

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
