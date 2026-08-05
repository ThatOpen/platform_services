import * as THREE from "three";
import * as OBC from "@thatopen/components";
import * as OBF from "@thatopen/components-front";
import * as FRAGS from "@thatopen/fragments";
// Inlines the fragments worker so it runs inside the platform's sandboxed iframe.
import "@thatopen/fragments/inline";
import * as BUI from "@thatopen/ui";
import * as MARKERJS from "@markerjs/markerjs3";
import {
  PlatformClient,
  UIManager,
  GitHistoryManager,
} from "@thatopen/services";
import { setAppContext } from "./app";

// The standard app, plus the revit-flow commit history: a History layout with the
// timeline beside the viewer. Scaffolded by `thatopen create <name> --beta --history`.
//
// THE BOOT ORDER IS THE WHOLE TRICK, and it is why this ships as a file rather than
// as instructions. GitHistoryManager reads the commit .frag files and colours the
// elements of a commit, so it reaches for FragmentsManager and for the 3D world the
// moment it starts. FragmentsManager is initialised inside top-app's own `setup`
// below, and the world does not exist until <top-app> is in the DOM and top-viewer
// has built it. Call `init(client)` where it reads naturally, right after
// `client.setup`, and you get "FragmentsManager not initialized" plus a pair of
// undefined `onHighlight` / `onClear` errors, none of which say "too early".
async function main() {
  const client = PlatformClient.fromPlatformContext();

  // Brand accent (purple) — drives layout-selector active state, dividers, etc.
  document.documentElement.style.setProperty("--bim-ui_accent-base", "#6528d7");

  // The dev `thatopen serve` wrapper HTML doesn't zero the UA body margin (8px),
  // which insets the whole app inside the platform iframe. Kill it here so it's
  // fixed in both dev and production regardless of the host page.
  document.body.style.margin = "0";

  // 1 ── UIManager registers the platform web components (top-app, top-viewer, …)
  // before the DOM renders. GitHistoryManager is the headless half of the history
  // panel: <top-git-history> is intent-only and asks the registry for it by uuid,
  // so without this registration the panel mounts and stays inert.
  const { components } = await client.setup<OBC.Components>(
    { OBC, OBF, BUI, THREE, FRAGS, MARKERJS },
    { uuid: UIManager.uuid },
    { uuid: GitHistoryManager.uuid },
  );
  components.get(UIManager).init();

  // One STABLE top-viewer node, returned by reference so re-rendering top-app
  // reuses it instead of disposing and recreating its world.
  const viewerEl = document.createElement("top-viewer");
  viewerEl.style.border = "1px solid var(--bim-ui_bg-contrast-20)";
  viewerEl.style.borderRadius = "0.75rem";
  viewerEl.style.boxSizing = "border-box";

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const app = document.createElement("top-app") as any;

  // 2 ── this callback is what initialises FragmentsManager. Nothing that needs
  // fragments may run before it has resolved.
  app.setup = (waitUntil: (p: Promise<void>, label?: string) => void) => {
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

  // Mount minimally first (viewer only) so top-viewer creates the world.
  app.elements = { viewer: () => BUI.html`${viewerEl}` };
  app.layouts = {
    Main: {
      label: "Main",
      icon: "solar:3d-square-bold",
      template: `"viewer" 1fr / 1fr`,
    },
  };
  app.layout = "Main";

  const container = document.getElementById("that-open-app") ?? document.body;
  container.appendChild(app);

  // 3 ── the world is created asynchronously by top-viewer. Wait for it.
  await firstWorld(components.get(OBC.Worlds));

  // Platform client + project data for the AppManager-shim consumers.
  const projectId: string | undefined = client?.context?.projectId;
  let projectData;
  try {
    if (projectId) projectData = await client.getProjectData(projectId);
  } catch {
    /* dev/no-project → consumers degrade gracefully */
  }
  setAppContext(client, projectData);

  // 4 ── ONLY NOW. Everything above had to have happened first. Read the comment
  // at the top of this file before moving this line.
  await components.get(GitHistoryManager).init(client);

  // Pluggable loaders for <top-models-list>. Heavy, app-specific loaders are
  // registered here so they stay OUT of the built-in's bundle.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let rcViewer: any = null;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const modelLoaders: Record<string, any> = {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    "3tz": async (fileId: string, ctx: any) => {
      if (!rcViewer) {
        const { realityCaptureViewer } = await import(
          "./setups/reality-capture-viewer"
        );
        rcViewer = realityCaptureViewer(ctx.components, client);
      }
      const saved = ctx.getAlignment(fileId) as number[] | undefined;
      await rcViewer.loadIntoWorld(fileId, {
        keepPostproduction: true,
        transform: saved ? new THREE.Matrix4().fromArray(saved) : undefined,
        onTransformChange: (m: THREE.Matrix4) =>
          ctx.setAlignment(fileId, m.toArray()),
      });
    },
  };

  // The stable viewer + the panels, under named layouts with the activity-bar
  // sidebar. All panels are built-ins that self-wire from top-app's contexts.
  app.elements = {
    viewer: () => BUI.html`${viewerEl}`,
    tree: () => BUI.html`<top-model-tree></top-model-tree>`,
    properties: () => BUI.html`<top-properties-panel></top-properties-panel>`,
    files: () =>
      BUI.html`<top-models-list .loaders=${modelLoaders}></top-models-list>`,
    dataTable: () => BUI.html`<top-data-table-panel></top-data-table-panel>`,
    objects: () => BUI.html`<top-objects-panel></top-objects-panel>`,
    settings: () => BUI.html`<top-settings-panel></top-settings-panel>`,
    history: () => BUI.html`<top-git-history></top-git-history>`,
  };
  app.layouts = {
    Explorer: {
      icon: "mdi:file-tree",
      template: `"tree viewer" 1fr "properties viewer" 1fr / 22rem 1fr`,
    },
    Assets: {
      icon: "mdi:folder-multiple-outline",
      template: `"files viewer" 1fr "objects viewer" 1fr / 22rem 1fr`,
    },
    Data: {
      icon: "mdi:table",
      template: `"dataTable viewer" 1fr / 22rem 1fr`,
    },
    Settings: {
      icon: "mdi:cog",
      template: `"settings viewer" 1fr / 22rem 1fr`,
    },
    // Same side, same width and same shape as the others: this only swaps the panel.
    History: {
      icon: "at-icons:git-branch",
      template: `"history viewer" 1fr / 22rem 1fr`,
    },
  };
  // Opens on History, because that is what this app was scaffolded for.
  app.layout = "History";
  app.sidebar = true;

  viewerEl.appendChild(document.createElement("top-viewer-toolbar"));

  // The history panel lights up once a revit-flow model is loaded. Load it from the
  // Assets panel, or auto-load it here if this app only ever shows one model.
}

/** Resolves with the first world once it exists (top-viewer creates it async). */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function firstWorld(worlds: any): Promise<any> {
  const existing = [...worlds.list.values()][0];
  if (existing) return Promise.resolve(existing);
  return new Promise((resolve) => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const handler = ({ value }: any) => {
      worlds.list.onItemSet.remove(handler);
      resolve(value);
    };
    worlds.list.onItemSet.add(handler);
  });
}

main().catch(console.error);
