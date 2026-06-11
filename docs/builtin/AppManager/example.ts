import * as OBC from "@thatopen/components";
import * as BUI from "@thatopen/ui";
import appManagerDef from "./index";

// ── State types ───────────────────────────────────────────────────────

type Panel1State = { label: string; components: OBC.Components };
type Panel2State = { label: string; components: OBC.Components };

// ── App type ──────────────────────────────────────────────────────────

interface MyApp {
  icons: ["LOAD", "TREE", "VIEW"];
  grid: BUI.Grid<
    ["Split", "Viewer"],
    [{ name: "panel1"; state: Panel1State }, { name: "panel2"; state: Panel2State }]
  >;
}

// ── Initialise OBC & BUI ──────────────────────────────────────────────

BUI.Manager.init();
const components = new OBC.Components();

const AppManager = appManagerDef.componentDefinition;
const app = components.get(AppManager<MyApp>);

// ── Define element templates ──────────────────────────────────────────

const panel1Template: BUI.StatefullComponent<Panel1State> = ({ label, components }) => {
  const app = components.get(AppManager<MyApp>);
  return BUI.html`
    <bim-panel active label=${label} style="min-width: 14rem;">
      <bim-panel-section label="Actions">
        <bim-button icon=${app.icons.LOAD} label="Load School Model"></bim-button>
      </bim-panel-section>
      <bim-panel-section label="Info">
        <bim-label>Use the sidebar to switch layouts.</bim-label>
      </bim-panel-section>
    </bim-panel>
  `;
};

const panel2Template: BUI.StatefullComponent<Panel2State> = ({ label, components }) => {
  const app = components.get(AppManager<MyApp>);
  return BUI.html`
    <bim-panel active label=${label} style="min-width: 14rem;">
      <bim-panel-section label="Settings">
        <bim-button icon=${app.icons.VIEW} label="View"></bim-button>
      </bim-panel-section>
    </bim-panel>
  `;
};

// ── Init ──────────────────────────────────────────────────────────────

app.init({
  icons: {
    LOAD: "solar:upload-bold",
    TREE: "mdi:file-tree",
    VIEW: "mdi:monitor",
  },
  grid: (grid) => {
    grid.elements = {
      panel1: { template: panel1Template, initialState: { label: "Models", components } },
      panel2: { template: panel2Template, initialState: { label: "Settings", components } },
    };
    grid.layouts = {
      Split: {
        template: `
          "panel1" 1fr
          "panel2" 1fr
          / 25rem 1fr`,
        icon: app.icons.TREE,
      },
      Viewer: {
        template: `"panel1" 1fr / 1fr`,
        icon: app.icons.VIEW,
      },
    };
    grid.layout = "Split";
  },
  container: document.getElementById("container")!,
});

app.showSidebar = true;
