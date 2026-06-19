import * as THREE from "three";
import * as OBC from "@thatopen/components";
import * as OBF from "@thatopen/components-front";
import * as FRAGS from "@thatopen/fragments";
// Inlines the fragments worker so it runs inside the platform's sandboxed iframe.
import "@thatopen/fragments/inline";
import * as BUI from "@thatopen/ui";
import * as MARKERJS from "@markerjs/markerjs3";
import { PlatformClient, UIManager } from "@thatopen/services";
import { setAppContext } from "./app";
import {
  propertiesPanel,
  modelTree,
  filesPanel,
  graphicsPanel,
  clipperTool,
  clipperPanel,
  commandsPanel,
  measurementTool,
  dataTablePanel,
  fpsIndicator,
  activeToolHud,
  navigationGizmo,
  visibilityToolbar,
  walkthrough,
} from "./setups";
import { objectsPanel } from "./setups/objects-panel";
import { inspectionInstances, inspectionActions } from "./setups/inspection";
import { measurementSettingsPanel } from "./setups/measurement-settings-panel";
import { settingsPanel } from "./setups/settings-panel";

// ─── A2 migration — PHASES 1+2: boot on UIManager + re-dock panels ───────────
// Juan consolidated the old AppManager (layout) + ViewportsManager (viewport)
// built-ins into the single UIManager built-in, which ships `top-app` (shell +
// layout) and `top-viewer` (deferred-PEN viewport). This boots the bim-viewer on
// that model.
//   Phase 1 — top-app shell hosting one top-viewer + auto-load.  [done]
//   Phase 2 — re-dock the side panels (tree/properties/files/data/objects/
//             settings) into top-app's layouts + sidebar.        [this file]
//   Phase 3 — the viewer-overlay tools (fps/HUD/gizmo/bottom toolbar/measure +
//             clip handles) that mount over the canvas.          [next]
// The pre-A2 rich main is preserved at `main.rich.ts.bak`.
async function main() {
  const client = PlatformClient.fromPlatformContext();

  // Brand accent (purple) — drives layout-selector active state, dividers, etc.
  document.documentElement.style.setProperty("--bim-ui_accent-base", "#6528d7");

  // The dev `thatopen serve` wrapper HTML doesn't zero the UA body margin (8px),
  // which insets the whole app inside the platform iframe. Kill it here so it's
  // fixed in both dev and production regardless of the host page.
  document.body.style.margin = "0";

  // UIManager must be in the setup call: it registers the platform web
  // components (top-app, top-viewer, top-viewer-tools, …) before the DOM renders.
  const { components } = await client.setup<OBC.Components>(
    { OBC, OBF, BUI, THREE, FRAGS, MARKERJS },
    { uuid: UIManager.uuid },
  );
  components.get(UIManager).init();

  // One STABLE top-viewer node, returned by reference so re-rendering top-app
  // (when we add the panels below) reuses it instead of disposing/recreating
  // its world. No <top-viewer-tools>: the bim-viewer mounts its own tabbed
  // visibility/inspect toolbar (see below), so the platform default would just
  // duplicate it.
  const viewerEl = document.createElement("top-viewer");

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const app = document.createElement("top-app") as any;

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

  // Mount minimally first (viewer only) so top-viewer creates the world; the
  // panels + their tools are built once that world exists (below).
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

  // Wait for top-viewer's world before building world-dependent tools/panels.
  const world = await firstWorld(components.get(OBC.Worlds));
  // Auto-anchor: the orbit pivot follows the surface picked on left-press
  // (library dynamicAnchor). top-viewer doesn't enable it, so set it here.
  world.dynamicAnchor = true;
  // …and show that pivot as an on-screen dot (projected from 3D each frame).
  setupAnchorDot(world, viewerEl);

  // Platform client + project data for the AppManager-shim consumers
  // (CloudRunner, data-table-panel, app-info-section).
  const projectId: string | undefined = client?.context?.projectId;
  let projectData;
  try {
    if (projectId) projectData = await client.getProjectData(projectId);
  } catch {
    /* dev/no-project → consumers degrade gracefully */
  }
  setAppContext(client, projectData);

  // Headless tools — drive the panels; they resolve the world via `components`.
  const clipTool = clipperTool(components);
  const measureTool = measurementTool(components);

  // Panels.
  const treeEl = modelTree(components);
  const propsEl = propertiesPanel(components);
  const filesEl = filesPanel(components, client) as unknown as HTMLElement;
  const dataTableEl = dataTablePanel(components) as unknown as HTMLElement;
  // FPS counter — mounted into the viewer overlay; the Graphics panel "Show FPS"
  // switch drives it (pass the controller in).
  const fps = fpsIndicator(viewerEl);
  const graphicsEl = graphicsPanel(components, fps) as unknown as HTMLElement;
  const clippingEl = clipperPanel(components, clipTool) as unknown as HTMLElement;
  const commandsEl = commandsPanel(components) as unknown as HTMLElement;
  const measureSettingsEl = measurementSettingsPanel(
    measureTool,
  ) as unknown as HTMLElement;
  const inspection = inspectionInstances(clipTool, measureTool);
  const objectsEl = objectsPanel(inspection) as unknown as HTMLElement;
  const settingsEl = settingsPanel([
    { label: "Graphics", icon: "mdi:tune", el: graphicsEl },
    { label: "Clip styling", icon: "mdi:scissors-cutting", el: clippingEl },
    { label: "Measurement", icon: "mdi:ruler", el: measureSettingsEl },
    { label: "Commands", icon: "mdi:keyboard", el: commandsEl },
  ]) as unknown as HTMLElement;

  for (const el of [
    treeEl,
    propsEl,
    filesEl,
    dataTableEl,
    objectsEl,
    settingsEl,
  ] as HTMLElement[]) {
    el.style.width = "100%";
    el.style.height = "100%";
    // top-app's grid areas are overflow:hidden; border-box keeps the panel's own
    // border inside the area so it isn't clipped on the bottom/right edges.
    el.style.boxSizing = "border-box";
  }

  // Re-dock: same stable viewer + the panels, under the bim-viewer's named
  // layouts with the activity-bar sidebar (Explorer · Assets · Data · Settings).
  const wrap = (el: HTMLElement) => () => BUI.html`${el}`;
  app.elements = {
    viewer: () => BUI.html`${viewerEl}`,
    tree: wrap(treeEl),
    properties: wrap(propsEl),
    files: wrap(filesEl),
    dataTable: wrap(dataTableEl),
    objects: wrap(objectsEl),
    settings: wrap(settingsEl),
  };
  // No `label` → the sidebar renders icon-only activity-bar buttons (matching
  // the pre-A2 look), background only on the active one.
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
  };
  app.layout = "Explorer";
  app.sidebar = true;

  // ── Viewer-overlay tools — appended to the top-viewer host, so they slot into
  // top-viewer's pointer-events:none overlay over the canvas (interactive parts
  // opt back into pointer events themselves). ────────────────────────────────
  activeToolHud(viewerEl, components);

  let walk;
  try {
    walk = walkthrough(components);
  } catch (e) {
    console.warn("[a2] walkthrough controller failed to init", e);
  }

  // Floating bottom toolbar (tabbed): "View" = visibility (hide/show/ghost/
  // isolate + projection + walkthrough); "Inspect" = Select / Clip / Measure,
  // routed through the tool-mode manager.
  visibilityToolbar(
    components,
    viewerEl,
    walk,
    undefined,
    inspectionActions(clipTool, measureTool),
  );

  // Navigation gizmo / view-cube (top-right): live orientation + click-to-orient.
  try {
    navigationGizmo(components, viewerEl);
  } catch (e) {
    console.warn("[a2] navigationGizmo failed to mount", e);
  }

  // Auto-load one model (top-viewer's world wires fragments→scene itself).
  void autoLoadFirstModel(components, client);
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

/**
 * On-screen pivot dot for the dynamic anchor: an HTML element projected from the
 * 3D anchor point each frame. Appended to the top-viewer host so it slots into
 * the viewer overlay over the canvas. Revealed once a drag starts (so a click-to-
 * select doesn't flash it) and kept glued to the pivot as the camera orbits.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function setupAnchorDot(world: any, element: HTMLElement) {
  const dot = document.createElement("div");
  dot.style.cssText =
    "position:absolute; width:13px; height:13px; border-radius:50%;" +
    "background:#6528d7; transform:translate(-50%,-50%);" +
    "pointer-events:none; display:none; z-index:5;" +
    "box-shadow:0 0 0 2px rgba(255,255,255,0.35);";
  element.appendChild(dot);

  let anchor: THREE.Vector3 | null = null;
  const place = () => {
    if (!anchor) return;
    const ndc = anchor.clone().project(world.camera.three);
    dot.style.left = `${(ndc.x * 0.5 + 0.5) * element.clientWidth}px`;
    dot.style.top = `${(-ndc.y * 0.5 + 0.5) * element.clientHeight}px`;
  };

  let shown = false;
  world.onDynamicAnchorSet.add((p: THREE.Vector3) => {
    anchor = p.clone();
    shown = false;
    place();
  });
  world.onDynamicAnchorClear.add(() => {
    anchor = null;
    shown = false;
    dot.style.display = "none";
  });

  // Reveal only once a real drag starts (DRAG px), so a click-to-select doesn't
  // flash the dot.
  const DRAG = 6;
  let press: { x: number; y: number } | null = null;
  element.addEventListener("pointerdown", (e) => {
    if (e.button === 0) press = { x: e.clientX, y: e.clientY };
  });
  element.addEventListener("pointermove", (e) => {
    if (!press || !anchor || shown) return;
    const dx = e.clientX - press.x;
    const dy = e.clientY - press.y;
    if (dx * dx + dy * dy >= DRAG * DRAG) {
      shown = true;
      place();
      dot.style.display = "block";
    }
  });
  const clearPress = () => {
    press = null;
  };
  element.addEventListener("pointerup", clearPress);
  element.addEventListener("pointercancel", clearPress);

  // Keep the dot glued to the 3D pivot as the camera orbits around it.
  world.renderer?.onBeforeUpdate.add(place);
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function autoLoadFirstModel(components: OBC.Components, client: any) {
  const fragments = components.get(OBC.FragmentsManager);
  const projectId: string | undefined = client?.context?.projectId;
  if (!projectId) {
    console.warn("[a2] no projectId — skipping auto-load");
    return;
  }
  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const items = (await client.listFiles({ projectId })) as any[];
    const frags = items.filter((it) =>
      (it.name ?? "").toLowerCase().endsWith(".frag"),
    );
    const frag =
      frags.find((it) => (it.name ?? "").toLowerCase().includes("bloxhub")) ??
      frags[0];
    if (!frag) {
      console.warn("[a2] no .frag in project to auto-load");
      return;
    }
    const resp = await client.downloadFile(String(frag._id));
    const buffer = await resp.arrayBuffer();
    await fragments.core.load(buffer, { modelId: String(frag._id) });
    await fragments.core.update(true);
    console.log("[a2] auto-loaded model:", frag.name);
  } catch (error) {
    console.warn("[a2] auto-load failed", error);
  }
}

main().catch(console.error);
