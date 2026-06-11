import * as THREE from "three";
import * as OBC from "@thatopen/components";
import * as BUI from "@thatopen/ui";

import appManagerDef from "../AppManager/index";
import viewportManagerDef from "./index";

const AppManager = appManagerDef.componentDefinition;
const ViewportManager = viewportManagerDef.componentDefinition;

// ── App type ──────────────────────────────────────────────────────────

type PanelState = { components: OBC.Components };

interface ViewportApp {
  icons: ["LOAD", "VIEW", "SPLIT"];
  grid: BUI.Grid<
    ["Viewer", "Split"],
    [
      { name: "viewer"; state: null },
      { name: "panel"; state: PanelState }
    ]
  >;
}

// ── Initialise OBC & BUI ──────────────────────────────────────────────

BUI.Manager.init();
const components = new OBC.Components();

const app = components.get(AppManager<ViewportApp>);
const viewports = components.get(ViewportManager);

// ── Create a viewport ─────────────────────────────────────────────────

const { element: viewerElement, world } = await viewports.create({
  backgroundColor: "#202932",
});

// ── Add a simple cube to the scene ────────────────────────────────────

const geometry = new THREE.BoxGeometry(3, 3, 3);
const material = new THREE.MeshStandardMaterial({ color: "#6528D7" });
const cube = new THREE.Mesh(geometry, material);
cube.position.set(0, 1.5, 0);
world.scene.three.add(cube);

await world.camera.controls.setLookAt(10, 8, 10, 0, 1.5, 0);

// Load a sample model
const loadModel = async () => {
  const fragments = components.get(OBC.FragmentsManager);
  const file = await fetch(
    "https://thatopen.github.io/engine_components/resources/frags/school_arq.frag",
  );
  const buffer = await file.arrayBuffer();
  await fragments.core.load(buffer, { modelId: "school_arq" });
  await fragments.core.update(true);
};

// ── Templates ─────────────────────────────────────────────────────────

const panelTemplate: BUI.StatefullComponent<PanelState> = (_state) => {
  return BUI.html`
    <bim-panel active label="App Info">
      <bim-panel-section label="Actions">
        <bim-button @click=${loadModel} label="Load School Model"></bim-button>
      </bim-panel-section>
      <bim-panel-section label="Info">
        <bim-label>Use the sidebar to switch layouts.</bim-label>
      </bim-panel-section>
    </bim-panel>
  `;
};

// ── Init ──────────────────────────────────────────────────────────────

app.init({
  icons: {
    LOAD: "solar:upload-bold",
    VIEW: "mdi:monitor",
    SPLIT: "solar:settings-bold",
  },
  grid: (grid) => {
    grid.elements = {
      viewer: viewerElement,
      panel: { template: panelTemplate, initialState: { components } },
    };
    grid.layouts = {
      Viewer: {
        template: `"viewer" 1fr / 1fr`,
        icon: app.icons.VIEW,
      },
      Split: {
        template: `"panel viewer" 1fr / 20rem 1fr`,
        icon: app.icons.SPLIT,
      },
    };
    grid.layout = "Viewer";
  },
  container: document.getElementById("container")!,
});

app.showSidebar = true;

components.init();
