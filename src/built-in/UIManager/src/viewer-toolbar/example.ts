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
  import { html, render } from "lit";

  const headlessBar = document.createElement("top-viewer-toolbar");
  headlessBar.toggleAttribute("headless", true);

  // A plain container — the `<bim-toolbar>` itself is rendered inside it.
  const toolbarHost = document.createElement("div");
  toolbarHost.style.pointerEvents = "auto";
  render(
    html`
      <bim-toolbar>
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
      </bim-toolbar>
    `,
    toolbarHost,
  );
  headlessBar.appendChild(toolbarHost);
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
    like the `toolbarHost` container above — never build them by hand.
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
  its own custom element. They render icon-only with a tooltip; set the
  optional `label` attribute on any of them to show text next to the icon
  (the tooltip stays as it is):

  ```html
  <top-viewer-hide-button label="Hide"></top-viewer-hide-button>
  ```

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
  | `<top-viewer-clip-button>` | Clipping planes: face-placing mode by default, or axis planes / a mode menu via `modes` (see below) |
  | `<top-viewer-measure-length-button>` | Activates length measurement |
  | `<top-viewer-measure-area-button>` | Activates area measurement |
  | `<top-viewer-measure-angle-button>` | Activates angle measurement |
  | `<top-viewer-measure-edge-button>` | Activates edge measurement |
  | `<top-viewer-measure-face-button>` | Activates face measurement |
  | `<top-viewer-measure-volume-button>` | Activates volume measurement |
  | `<top-viewer-measure-button>` | All measurement modes in one button (a menu by default), or a chosen subset via `modes` (see below) |
  | `<top-viewer-projection-toggle-button>` | Toggles Perspective ⇄ Orthographic |
  | `<top-viewer-walkthrough-button>` | Toggles first-person walkthrough |
  | `<top-viewer-navigation-button>` | Switches between orbit and first-person navigation (a menu by default), or a single chosen mode via `modes` (see below) |

  Each one self-wires from context — drop it anywhere under `<top-viewer>`
  and it works, with no props to pass in.

  ### ✂️ Clip button modes

  Without any attribute, `<top-viewer-clip-button>` enters face-placing mode:
  double-click a face in the model and a clip plane is dropped on it. The
  optional `modes` attribute changes what the button offers — a whitespace-
  (or comma-) separated list of `x`, `y`, `z` and `face` (case-insensitive;
  unknown tokens are ignored, duplicates dropped, the order you write is the
  order shown):

  ```html
  <!-- a menu with four entries: X axis, Y axis, Z axis, Face -->
  <top-viewer-clip-button modes="x y z face"></top-viewer-clip-button>

  <!-- one mode = no menu; a click creates a horizontal cut right away -->
  <top-viewer-clip-button modes="y"></top-viewer-clip-button>

  <!-- default: face-placing mode -->
  <top-viewer-clip-button></top-viewer-clip-button>
  ```

  - **One mode** — the button runs it directly on click. `face` is the
    default face-placing behavior.
  - **Two or more** — clicking opens a menu with one entry per mode ("X
    axis", "Y axis", "Z axis", "Face"); picking one runs it and closes the
    menu.
  - **Axis modes** create a single plane through the center of the bounding
    box of all loaded models (nothing happens if no model is loaded). Axes
    follow the three.js convention — **Y is vertical**, so `y` is a
    horizontal cut. The plane's normal is the *negative* axis — `(-1, 0, 0)`,
    `(0, -1, 0)`, `(0, 0, -1)` — so the plane clips what lies on the
    positive side of the axis (`y` removes everything above the middle of
    the model). Axis planes behave exactly like face-placed ones: same
    section styling, listed in the objects outliner, draggable by their
    gizmo, removable with Delete.
  - The button shows as active only while face-placing mode is on.

  ### 📏 Measure button modes

  `<top-viewer-measure-button>` puts the measurement tools behind a single
  button. Without any attribute it offers all six modes — `length`, `area`,
  `angle`, `edge`, `face`, `volume` — in a menu. The optional `modes`
  attribute picks a subset (whitespace- or comma-separated, case-insensitive;
  unknown tokens are ignored, duplicates dropped, your order is kept):

  ```html
  <!-- default: a menu with all six modes -->
  <top-viewer-measure-button></top-viewer-measure-button>

  <!-- a menu with just these three, in this order -->
  <top-viewer-measure-button modes="length area volume"></top-viewer-measure-button>

  <!-- one mode = no menu; a click starts that measurement right away -->
  <top-viewer-measure-button modes="length"></top-viewer-measure-button>
  ```

  - **One mode** — a click activates it directly, exactly like the matching
    standalone button (`length` and `area` measure freely; `edge` and `face`
    snap to edges and faces).
  - **Two or more** — a click opens a menu with one text-labelled entry per
    mode ("Length", "Area", "Angle", "Edge", "Face", "Volume"); picking one
    activates it and closes the menu.
  - The button shows as active while any of its modes is the active
    measurement mode, and its icon switches to that mode's icon (a ruler
    otherwise). In the menu, the active mode's entry is marked.

  ### 🧭 Navigation button modes

  `<top-viewer-navigation-button>` switches how the camera moves. Without any
  attribute it offers both modes — `orbit` and `first-person` — in a menu.
  The optional `modes` attribute narrows or reorders them (whitespace- or
  comma-separated, case-insensitive; unknown tokens are ignored, duplicates
  dropped, your order is kept):

  ```html
  <!-- default: a menu with "Orbit" and "First person" -->
  <top-viewer-navigation-button></top-viewer-navigation-button>

  <!-- one mode = no menu; a click switches straight to it -->
  <top-viewer-navigation-button modes="orbit"></top-viewer-navigation-button>
  ```

  - `orbit` turns first-person navigation off (nothing happens if it already
    is); `first-person` turns it on (nothing happens if it already is) — the
    same first-person navigation `<top-viewer-walkthrough-button>` toggles.
  - The button's icon always shows the current mode, and the button is active
    while first-person is on. In the menu, the current mode's entry is marked.
*/
