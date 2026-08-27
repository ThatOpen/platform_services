/* MD
  ## top-viewer-toolbar
  ---
  A 3D viewport is only as useful as the controls around it: selecting a
  target set, hiding/isolating/ghosting elements, clipping, measuring,
  walking through the model. Building that toolbar — and keeping every
  button in sync with tool state and with each other — is real work, before
  you've customized anything.

  `top-viewer-toolbar` is a ready-made web component that delivers exactly
  that. Mounted as-is, it's a complete, self-wiring bottom toolbar. But it's
  also built out of standalone, individually-importable
  `<top-viewer-*-button>` elements — so if the default layout isn't what your
  app needs, you can drop the bar it builds for you and compose your own out
  of the same pieces, mixed freely with your own custom buttons.

  This tutorial covers the prerequisites; the default, batteries-included
  toolbar; what it manages automatically; composing a custom layout with
  `headless`; docking a vertical toolbar; and the full list of standalone
  buttons available.

  By the end, you'll have both a working default toolbar and a fully custom
  one running side by side in the same viewport.
*/

import { html } from "lit";
import * as THREE from "three";
import * as OBC from "@thatopen/components";
import * as OBF from "@thatopen/components-front";
import * as FRAGS from "@thatopen/fragments";
import * as BUI from "@thatopen/ui";
import { PlatformClient, UIManager } from "@thatopen/services";
import type { App } from "../app/index";

/* MD
  ### ✅ Prerequisites

  `<top-viewer-toolbar>` must be mounted as a descendant of `<top-viewer>` —
  it consumes the `componentsContext`/`worldContext` that `<top-viewer>`
  provides, and the standalone buttons it's built from consume the same
  contexts. `UIManager` must be in the setup call so both custom elements are
  registered. Nothing else is required — no manager to `init`, no extra
  config.
*/

const client = PlatformClient.fromPlatformContext();

const { components } = (await client.setup(
  { OBC, OBF, BUI, THREE, FRAGS },
  { uuid: UIManager.uuid },
)) as { components: OBC.Components };

components.get(UIManager).init();

/* MD
  ### 🖥️ Default toolbar (batteries included)

  Add it as a plain child of `<top-viewer>` — no `slot` needed, it docks
  into `"bottom"` on its own:

  ```html
  <top-viewer>
    <top-viewer-toolbar></top-viewer-toolbar>
  </top-viewer>
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
  viewer: () => html`
    <top-viewer>
      <top-viewer-toolbar></top-viewer-toolbar>
    </top-viewer>
  `,
};

app.layouts = {
  main: {
    label: "Main",
    icon: "solar:3d-square-bold",
    template: `"viewer" 1fr / 1fr`,
  },
};

app.layout = "main";

const container = document.getElementById("that-open-app") ?? document.body;
container.appendChild(app);
document.body.style.margin = "0";

/* MD
  ### 🤖 What the default toolbar manages automatically

  **Target mode** — a toggle between "Selected" and "Unselected", which every
  visibility button below operates on. Empty selection while targeting
  "Selected" means the target is empty (actions no-op); targeting
  "Unselected" with an empty selection means the target is the whole model.

  **Visibility actions** (each reversible via Show/Reset) — Hide, Show,
  Isolate, Ghost (semi-transparent), Focus, and a global Reset that restores
  full visibility and opacity regardless of target mode.

  **Inspect tab** — Select (default tool), Clip, and six measurement modes
  (length, area, angle, edge, face, volume), all sharing one active-tool
  manager so switching tools un-highlights whichever was active before.

  **Projection + walkthrough** — a Perspective⇄Orthographic toggle and a
  first-person walkthrough toggle, each reflecting live state.

  **Active-tool HUD** — a floating overlay over the 3D viewport itself
  showing context for whichever tool is currently active (e.g. clip plane
  controls, measurement readouts).

  All of the above are per-`components` singletons — any other UI in your
  app that resolves the same tool (e.g. via `components.get(...)`) shares
  the exact same state, not a second, independent instance.

  ### 🧱 Composing a custom layout with `headless`

  Set the `headless` attribute to skip the default bar's own assembly, while
  everything else — providing context to descendants, the active-tool HUD —
  keeps running. Slot your own buttons as light-DOM children: they consume
  the same context the default bar's buttons do, wherever you place them.

  ```html
  <top-viewer>
    <top-viewer-toolbar headless>
      <!-- your own content goes here as light-DOM children -->
    </top-viewer-toolbar>
  </top-viewer>
  ```

  Mixing standalone buttons with a plain, app-owned `bim-button` in the same
  bar — built with lit's `render`/`html` into a plain container element
  (never `document.createElement` for the `bim-*` tags themselves, see the
  gotcha below), then appended as the toolbar's light-DOM content:

  ```ts
  const headlessBar = document.createElement("top-viewer-toolbar");
  headlessBar.toggleAttribute("headless", true);

  const customButtons = document.createElement("bim-toolbar") as unknown as HTMLElement;
  customButtons.setAttribute("style", "pointer-events: auto;");
  render(
    html`
      <bim-toolbar-section label-hidden style="background: transparent;">
        <top-viewer-mode-toggle-button></top-viewer-mode-toggle-button>
        <top-viewer-hide-button></top-viewer-hide-button>
        <top-viewer-select-button></top-viewer-select-button>
      </bim-toolbar-section>
      <bim-toolbar-section label-hidden style="background: transparent;">
        <bim-button
          icon="mdi:fit-to-page-outline"
          @click=${() => myOwnFitToViewLogic()}
        ><bim-tooltip placement="top">Zoom to fit</bim-tooltip></bim-button>
      </bim-toolbar-section>
    `,
    customButtons,
  );
  headlessBar.appendChild(customButtons);
  // headlessBar can now be appended anywhere inside <top-viewer>.
  ```

  ### 📐 Docking a vertical toolbar

  The host centers its own content via flexbox, controllable through CSS
  custom properties — including flipping to a vertical stack for a
  sidebar-style dock:

  ```html
  <top-viewer-toolbar
    headless
    slot="right"
    style="--top-viewer-toolbar-direction: column;"
  >
    ...
  </top-viewer-toolbar>
  ```

  - `--top-viewer-toolbar-direction` — `row` (default) or `column`.
  - `--top-viewer-toolbar-justify` — alignment along the main axis (default
    `center`).
  - `--top-viewer-toolbar-align` — alignment along the cross axis (default
    `center`).

  Pair `--top-viewer-toolbar-direction: column` with `bim-toolbar`'s own
  `vertical` attribute on the content you render inside, so the buttons
  themselves stack the same way the bar does.

  ### ⚠️ Gotchas

  - **Never `document.createElement` a `bim-*` element.** `bim-button`,
    `bim-toolbar`, `bim-toolbar-section`, and every other `@thatopen/ui`
    component set attributes on themselves in their own constructor, which
    Custom Elements v1 forbids for elements created imperatively —
    `document.createElement("bim-button")` throws `NotSupportedError`.
    Render them with lit's `render(html\`...\`, container)` instead, exactly
    like the `customButtons` bar above — never build them by hand.
  - **`bim-button` sizes itself** — square when it's icon-only, a consistent
    height when it has a label. Don't set `width`/`height`/`min-width`
    inline on it; that only fights its own layout and produces buttons that
    look inconsistent next to the rest of the bar.
  - **Centering/alignment belongs on the toolbar's host**, via the CSS custom
    properties above — not on the content you slot into it. Setting
    `justify-self` (or similar) on your own buttons instead of using
    `--top-viewer-toolbar-justify` only works by accident, if at all.
  - **A standalone button works from anywhere in the DOM**, as long as it
    ends up a descendant of a `<top-viewer-toolbar>` inside a `<top-viewer>`
    — context requests bubble through shadow-DOM boundaries. It does *not*
    need to be a direct child of the bar it visually sits in.

  ### 🧩 Standalone buttons reference

  Every button the default bar uses is independently importable/usable as
  its own custom element:

  | Element | Does |
  |---|---|
  | `<top-viewer-mode-toggle-button>` | Toggles target: Selected ⇄ Unselected |
  | `<top-viewer-hide-button>` | Hides the target set |
  | `<top-viewer-show-button>` | Un-hides the target set |
  | `<top-viewer-isolate-button>` | Shows only the target set |
  | `<top-viewer-ghost-button>` | Renders the target set semi-transparent |
  | `<top-viewer-focus-button>` | Frames the camera on the target set |
  | `<top-viewer-reset-button>` | Restores full visibility + opacity (global) |
  | `<top-viewer-select-button>` | Activates the default Select tool |
  | `<top-viewer-clip-button>` | Activates the Clip tool |
  | `<top-viewer-measure-length-button>` | Activates length measurement |
  | `<top-viewer-measure-area-button>` | Activates area measurement |
  | `<top-viewer-measure-angle-button>` | Activates angle measurement |
  | `<top-viewer-measure-edge-button>` | Activates edge measurement |
  | `<top-viewer-measure-face-button>` | Activates face measurement |
  | `<top-viewer-measure-volume-button>` | Activates volume measurement |
  | `<top-viewer-projection-toggle-button>` | Toggles Perspective ⇄ Orthographic |
  | `<top-viewer-walkthrough-button>` | Toggles first-person walkthrough |

  Each one self-wires from context — drop it anywhere under `<top-viewer>`
  and it works, with no props to pass in.
*/
