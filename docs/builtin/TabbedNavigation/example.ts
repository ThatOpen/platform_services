import * as OBC from "@thatopen/components";
import * as BUI from "@thatopen/ui";

import appManagerDef from "../AppManager/index";
import tabbedNavDef from "./index";

const AppManager = appManagerDef.componentDefinition;
const TabbedNavigation = tabbedNavDef.componentDefinition;

// ── App type ──────────────────────────────────────────────────────────

type PanelState = { label: string };

interface NavApp {
  icons: ["DASHBOARD", "FILES", "SETTINGS"];
  grid: BUI.Grid<
    ["Dashboard", "Files", "Settings"],
    [
      { name: "tabs"; state: null },
      { name: "dashboard"; state: PanelState },
      { name: "files"; state: PanelState },
      { name: "settings"; state: PanelState }
    ]
  >;
}

// ── Initialise OBC & BUI ──────────────────────────────────────────────

BUI.Manager.init();
const components = new OBC.Components();

const app = components.get(AppManager<NavApp>);
const tabs = components.get(TabbedNavigation);

// ── Templates ─────────────────────────────────────────────────────────

const makePanel = (): BUI.StatefullComponent<PanelState> =>
  ({ label }) => BUI.html`
    <bim-panel active label=${label}>
      <bim-panel-section label="Content">
        <bim-label>Current screen: ${label}</bim-label>
      </bim-panel-section>
    </bim-panel>
  `;

// The grid caches elements by template-function identity, so each tab area
// needs its own function reference — otherwise the grid reuses the same
// panel element across layouts.
const dashboardPanel = makePanel();
const filesPanel = makePanel();
const settingsPanel = makePanel();

// We'll fill the tabs element after init.
let tabsElement: HTMLElement | null = null;

// ── Init ──────────────────────────────────────────────────────────────

app.init({
  icons: {
    DASHBOARD: "mdi:view-dashboard",
    FILES: "mdi:file-multiple",
    SETTINGS: "mdi:cog",
  },
  grid: (grid) => {
    grid.elements = {
      tabs: (() => {
        // Lazy placeholder — TabbedNavigation attaches here after app.init().
        const slot = document.createElement("div");
        slot.style.cssText = "display: flex; padding: 0.5rem;";
        tabsElement = slot;
        return slot;
      })(),
      dashboard: { template: dashboardPanel, initialState: { label: "Dashboard" } },
      files: { template: filesPanel, initialState: { label: "Files" } },
      settings: { template: settingsPanel, initialState: { label: "Settings" } },
    };
    grid.layouts = {
      Dashboard: {
        template: `
          "tabs" auto
          "dashboard" 1fr
          / 1fr
        `,
        icon: app.icons.DASHBOARD,
      },
      Files: {
        template: `
          "tabs" auto
          "files" 1fr
          / 1fr
        `,
        icon: app.icons.FILES,
      },
      Settings: {
        template: `
          "tabs" auto
          "settings" 1fr
          / 1fr
        `,
        icon: app.icons.SETTINGS,
      },
    };
    grid.layout = "Dashboard";
  },
  container: document.getElementById("container")!,
});

// Create the tab bar now that the grid exists.
const { element: tabBar } = tabs.create();
tabsElement?.appendChild(tabBar);

// Hide the default sidebar — tabs replace it.
app.showSidebar = false;

components.init();
