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
import { setupChannel } from "./setups/channel";

// A platform app made of the platform's own pieces, as the Hub and the Coordinator are: the project's documents on the
// left, the document viewer on the right, the model's tree, properties and data beside it. Built on WebGPU (`src/webgpu/`).
async function main() {
  const client = PlatformClient.fromPlatformContext();

  // Brand accent: the library's own purple (UI colours only from @thatopen/ui's variables), as the platform's apps.
  document.documentElement.style.setProperty("--bim-ui_accent-base", "var(--bim-ui_main-base)");

  // The dev `thatopen serve` wrapper HTML doesn't zero the UA body margin (8px),
  // which insets the whole app inside the platform iframe. Kill it here so it's
  // fixed in both dev and production regardless of the host page.
  document.body.style.margin = "0";
  // The library's background, set by the app and not by the host page, so it holds inside the platform too.
  document.body.style.background = "var(--bim-ui_bg-base)";

  // UIManager must be in the setup call: it registers the platform web
  // components (top-app, top-viewer, top-viewer-tools, …) before the DOM renders.
  const { components } = await client.setup<OBC.Components>(
    { OBC, OBF, BUI, THREE, FRAGS, MARKERJS },
    { uuid: UIManager.uuid },
  );
  components.get(UIManager).init();

  // The platform channel, pre-wired (see ./setups/channel.ts): external tools
  // of this account (an MCP server, a CLI, a plugin) can command this app, and
  // other open tabs of it are reachable for collaboration. Joined HERE, before
  // any await the boot can park on (the world, project data): a stalled fetch
  // further down must not leave the app unreachable — and silently so, since a
  // join that is never requested also never gets to time out loudly. It only
  // exists inside the platform iframe, so a failure is a warning, never a boot
  // error.
  try {
    setupChannel(client, components);
  } catch (error) {
    console.warn("[channel] unavailable outside the platform:", error);
  }

  // The platform's document viewer, as the Hub's and the Coordinator's: each file opened with its viewer (3D, PDF,
  // text), the 3D scene kept alive between them. Given no viewers it brings the platform's own: a 3D viewer ready for
  // streamed models, its bar (3D/2D, projection, the colours softened by default), undo of section planes and measures.
  // One STABLE node, returned by reference so re-rendering top-app reuses it instead of rebuilding its world.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const viewerEl = document.createElement("top-file-viewer") as any;
  viewerEl.keepScene = true;

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

  // Wait for the viewer's world to exist before building world-dependent panels.
  await firstWorld(components.get(OBC.Worlds));

  // Platform client + project data for the AppManager-shim consumers
  // (CloudRunner, data-table-panel, app-info-section).
  const projectId: string | undefined = client?.context?.projectId;
  let projectData;
  try {
    // Bounded: this request carries no AbortSignal, so a stalled response
    // parked everything below it for good (that is how the app once ended up
    // booted but with no panels and, before the channel moved up top, deaf to
    // external tools). Past the deadline the app boots without project data —
    // the same degraded path the catch below already provides.
    if (projectId) {
      projectData = await Promise.race([
        client.getProjectData(projectId),
        new Promise<undefined>((resolve) => {
          setTimeout(() => resolve(undefined), 20_000);
        }),
      ]);
    }
  } catch {
    /* dev/no-project → consumers degrade gracefully */
  }
  setAppContext(client, projectData);

  // Re-dock: the stable viewer + the panels, under the bim-viewer's named layouts
  // with the activity-bar sidebar (Explorer · Assets · Data · Settings). All panels
  // are now built-ins that self-wire from top-app's componentsContext/clientContext
  // — no `components` plumbing in the app.
  app.elements = {
    viewer: () => BUI.html`${viewerEl}`,
    tree: () => BUI.html`<top-model-tree></top-model-tree>`,
    properties: () => BUI.html`<top-properties-panel></top-properties-panel>`,
    // The project's documents, as every platform app lists them: a click opens one in the viewer.
    files: () => BUI.html`<top-documents-panel reads-project opens-drops></top-documents-panel>`,
    dataTable: () => BUI.html`<top-data-table-panel></top-data-table-panel>`,
    settings: () => BUI.html`<top-settings-panel></top-settings-panel>`,
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
      template: `"files viewer" 1fr "properties viewer" 1fr / 22rem 1fr`,
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

  // No auto-load: the viewer opens empty. A document clicked in the Assets panel opens in it.
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
