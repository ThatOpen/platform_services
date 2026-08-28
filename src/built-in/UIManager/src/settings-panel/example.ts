/* MD
  ## top-settings-panel
  ---
  Every viewer app ends up needing the same settings screen: rendering
  options, clip/measurement styling, a "which cloud component converts this
  format" picker, a keyboard-shortcut reference — plus a search box that
  filters all of it and a "restore defaults" button that resets whatever has
  persisted state. Building that, and keeping it in sync with the tools it
  configures, is real work before you've added a single setting of your own.

  `top-settings-panel` is a ready-made web component that delivers exactly
  that. Mounted as-is, it's a complete, self-wiring Settings panel. But like
  `top-viewer-toolbar` (see that tutorial), it's built out of standalone,
  individually-importable `<top-*-settings>` elements — so you can drop the
  panel it builds for you and compose your own layout out of the same
  pieces, mixed freely with sections of your own.

  This tutorial covers the prerequisites; the default, batteries-included
  panel; what it manages automatically; building your own section with
  `bim-panel-section`; and composing a custom layout with `headless`.

  By the end, you'll have a working default panel plus your own custom
  section, both wired into the same shared search box and reset button as
  the stock ones.
*/

import { html, LitElement } from "lit";
import { customElement, state } from "lit/decorators.js";
import { consume } from "@lit/context";
import * as THREE from "three";
import * as OBC from "@thatopen/components";
import * as OBF from "@thatopen/components-front";
import * as FRAGS from "@thatopen/fragments";
import * as BUI from "@thatopen/ui";
import { PlatformClient, UIManager } from "@thatopen/services";
// TODO(#34 follow-up): `settingsSearchContext` is not part of the published
// `@thatopen/services` surface yet — see the TODO in settings-panel/index.ts.
// Imported by local relative path until the distribute pipeline exports
// context objects too; same workaround `app/examples/Contexts/example.ts`
// uses for `componentsContext`/`clientContext`.
import { settingsSearchContext } from "./src/context";
import type { App } from "../app/index";

/* MD
  ### ✅ Prerequisites

  `UIManager` must be in the setup call so `<top-settings-panel>` and every
  `<top-*-settings>` element are registered. `<top-settings-panel>` must be
  mounted as a descendant of `<top-app>` — it and its sections consume
  `componentsContext`/`clientContext`, which `top-app` provides. It does
  **not** need to be a descendant of `<top-viewer>` specifically — but the
  sections that talk to the 3D engine (Graphics, Clip styling, Measurement,
  Commands) render an empty placeholder until a `<top-viewer>` exists
  somewhere in the same app, since that's what actually builds the tools they
  configure.
*/

const client = PlatformClient.fromPlatformContext();

const { components } = (await client.setup(
  { OBC, OBF, BUI, THREE, FRAGS },
  { uuid: UIManager.uuid },
)) as { components: OBC.Components };

components.get(UIManager).init();

/* MD
  ### 🖥️ Default panel (batteries included)

  Add it as a plain element anywhere under `top-app` — a side-by-side layout
  with the 3D viewer is the most natural arrangement, since most of its
  sections act on what's in the scene:

  ```html
  <top-viewer>...</top-viewer>
  <top-settings-panel></top-settings-panel>
  ```

  ### 🤖 What the default panel manages automatically

  **Graphics** — point/line/edge styling, background, shadows, ambient
  occlusion — whatever `top-viewer` supports, persisted across reloads.

  **Clip styling** — fill/edge color, opacity, width for the clip tool,
  shared live with `top-viewer-toolbar`'s clip button.

  **Measurement** — units (length/area/angle), color, decimals, per-snap-kind
  toggles, shared live with the toolbar's measurement buttons.

  **File conversion** — which provisioned cloud component converts each
  format when a file is opened, per project.

  **Commands** — a click-to-run shortcut reference (focus, hide, isolate,
  ghost, show all, clear selection) that also registers the actual keyboard
  shortcuts while mounted.

  **Search box** — filters every section's own rows by label, stock or
  custom, as long as a section opts in (see below).

  **Restore defaults** — a two-click-confirm button that resets every
  section with persisted state (currently: Graphics) back to its defaults.

  ### 🧩 Building your own section

  A custom section is a `LitElement` that renders its own `<bim-panel-section>`
  — nothing about it is specific to `top-settings-panel` beyond that. Consume
  `settingsSearchContext` if you want the shared search box to filter your
  rows too; skip it and your section simply never filters.
*/

@customElement("my-lidar-settings")
class MyLidarSettings extends LitElement {
  @consume({ context: settingsSearchContext, subscribe: true })
  searchQuery = "";

  @state() private _pointBudget = 2_000_000;
  @state() private _showIntensity = false;

  render() {
    const rows = [
      {
        label: "Point budget",
        control: html`<bim-number-input
          label="Point budget"
          slider
          value=${this._pointBudget}
          min="100000"
          max="10000000"
          step="100000"
          @change=${(e: Event) => {
            this._pointBudget = Number((e.target as HTMLInputElement).value);
          }}
        ></bim-number-input>`,
      },
      {
        label: "Show intensity",
        control: html`<bim-checkbox
          label="Show intensity"
          toggle
          ?checked=${this._showIntensity}
          @change=${(e: Event) => {
            this._showIntensity = (e.target as HTMLInputElement).checked;
          }}
        ></bim-checkbox>`,
      },
    ];

    const q = this.searchQuery.trim().toLowerCase();
    const visible = q
      ? rows.filter((r) => r.label.toLowerCase().includes(q))
      : rows;

    return html`<bim-panel-section label="LIDAR" icon="mdi:radar">
      ${visible.length
        ? visible.map((r) => r.control)
        : html`<bim-label style="opacity: 0.6; font-size: 0.78rem;"
            >No settings match "${this.searchQuery}".</bim-label
          >`}
    </bim-panel-section>`;
  }
}

/* MD
  ### 🧱 Composing a custom layout with `headless`

  Set the `headless` attribute to skip the panel's own 5 stock sections —
  everything else (the search box, the reset button, both contexts) keeps
  running. Slot whatever `top-*-settings` elements and/or your own sections
  as light-DOM children, in whatever order you want; that's exactly what
  renders.

  The most common case: keep every stock section and just add your own —
  this is the live demo below.

  ```html
  <top-settings-panel headless>
    <top-graphic-settings></top-graphic-settings>
    <top-clipstyling-settings></top-clipstyling-settings>
    <top-measurement-settings></top-measurement-settings>
    <top-fileconversion-settings></top-fileconversion-settings>
    <top-commands-settings></top-commands-settings>
    <my-lidar-settings></my-lidar-settings>
  </top-settings-panel>
  ```
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
  viewer: () =>
    html`<top-viewer><top-viewer-toolbar></top-viewer-toolbar></top-viewer>`,
  settings: () => html`
    <top-settings-panel headless>
      <top-graphic-settings></top-graphic-settings>
      <top-clipstyling-settings></top-clipstyling-settings>
      <top-measurement-settings></top-measurement-settings>
      <top-fileconversion-settings></top-fileconversion-settings>
      <top-commands-settings></top-commands-settings>
      <my-lidar-settings></my-lidar-settings>
    </top-settings-panel>
  `,
};

app.layouts = {
  main: {
    label: "Main",
    icon: "solar:3d-square-bold",
    template: `"viewer settings" 1fr / 1fr 22rem`,
  },
};

app.layout = "main";

const container = document.getElementById("that-open-app") ?? document.body;
container.appendChild(app);
document.body.style.margin = "0";

/* MD
  ### 🔀 A few other ways to compose it

  A lighter viewer that only needs Graphics plus its own section — drop
  everything else:

  ```html
  <top-settings-panel headless>
    <top-graphic-settings></top-graphic-settings>
    <my-lidar-settings></my-lidar-settings>
  </top-settings-panel>
  ```

  Reordering — `headless` respects DOM order, so Commands first is just:

  ```html
  <top-settings-panel headless>
    <top-commands-settings></top-commands-settings>
    <top-graphic-settings></top-graphic-settings>
    <top-clipstyling-settings></top-clipstyling-settings>
    <top-measurement-settings></top-measurement-settings>
    <top-fileconversion-settings></top-fileconversion-settings>
  </top-settings-panel>
  ```

  Swapping a single stock section for your own (e.g. Measurement with
  different units) — the same `headless` list, just with that one tag
  replaced:

  ```html
  <top-settings-panel headless>
    <top-graphic-settings></top-graphic-settings>
    <top-clipstyling-settings></top-clipstyling-settings>
    <my-measurement-settings></my-measurement-settings>
    <top-fileconversion-settings></top-fileconversion-settings>
    <top-commands-settings></top-commands-settings>
  </top-settings-panel>
  ```

  Keeping the full stock default and only ADDING a section, without going
  `headless` at all — the non-headless layout also projects a trailing
  `<slot>`, so any light-DOM children you give it render after the 5 stock
  sections:

  ```html
  <top-settings-panel>
    <my-lidar-settings></my-lidar-settings>
  </top-settings-panel>
  ```

  ### ⚠️ Gotchas

  - **Never `document.createElement` a `bim-*` element** — same rule as
    `top-viewer-toolbar`. Render them with lit's `html`/`render` (or, as
    here, from inside your own `LitElement`'s `render()`); never build them
    imperatively.
  - **A custom section renders its OWN `<bim-panel-section>`**, in its own
    shadow root — there's no API to inject rows into a stock section, only
    to sit alongside it.
  - **`fixed` layout quirk**: `<bim-panel-section>`'s default logic checks
    `this.closest("bim-panel")`, which can't see past your own section's
    shadow boundary — so, like the stock sections, a custom one may render
    with `fixed` behavior until the upstream `@thatopen/ui` fix ships. Not
    something to work around here; tracked separately.
  - **Search filtering is opt-in per section** — consuming
    `settingsSearchContext` is what makes a section respond to the shared
    search box; forgetting it just means that section never filters, not an
    error.
*/
