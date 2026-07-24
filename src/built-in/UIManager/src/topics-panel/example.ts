/* MD
  ## topics-panel
  ---
  Every coordination workflow needs a place to track issues, clashes, and
  action items against a 3D model — who's responsible, what still needs
  review, and where in the model it actually is. Building that from scratch
  means a BCF-compatible data model, a form, comment threads, viewpoint
  capture/navigation, document links, and a persistence layer — all before a
  single issue gets tracked.

  `topics-panel` is a ready-made web component that delivers exactly that. It
  connects to `@thatopen/components`' `BCFTopics` (and `Viewpoints`)
  automatically and manages the entire workflow: the topic list with search,
  full CRUD on topics/comments/viewpoints/documents, camera navigation,
  BCF export/import, and auto-save — without you writing any UI code.

  This tutorial covers the prerequisites before mounting the panel; dropping
  it into a `top-app` layout alongside a 3D viewer; and a breakdown of
  everything the panel handles automatically so you know what you do not need
  to implement yourself.

  By the end, you'll have a fully working topics/issues environment running
  in your application with a single line of markup.
*/

import { html } from "lit";
import * as THREE from "three";
import * as OBC from "@thatopen/components";
import * as OBF from "@thatopen/components-front";
import * as FRAGS from "@thatopen/fragments";
import * as BUI from "@thatopen/ui";
import { PlatformClient, UIManager, TopicsManager } from "@thatopen/services";
import type { App } from "../app/index";


/* MD
  ### ✅ Prerequisites

  Two conditions must be met before the panel mounts:

  1. **`UIManager` must be in the setup call.** It registers all platform web
     components, including `<top-topics-panel>` itself. Without it the
     element is unknown to the browser and renders as an empty box.

  2. **`TopicsManager.init(client)` must have resolved.** It configures
     `BCFTopics` (version, author, assignable users — all from real project
     data) and loads whatever BCF was previously saved for this project. The
     panel mounts into an empty state and never catches up on its own if you
     load a BCF after the fact; it only subscribes to change events, it does
     not poll.

  Both conditions are naturally satisfied when you call `init` before
  appending `top-app` to the document, which is the pattern shown below.
*/

const client = PlatformClient.fromPlatformContext();

// The `{ uuid }` entries tell the platform which built-ins to register for
// this app — one per built-in beyond the "stable" `@thatopen/components`
// globals passed as the first argument.
const { components } = (await client.setup(
  { OBC, OBF, BUI, THREE, FRAGS },
  { uuid: UIManager.uuid },
  { uuid: TopicsManager.uuid },
)) as { components: OBC.Components };

components.get(UIManager).init();

// init must resolve before top-app (and therefore topics-panel) mounts.
await components.get(TopicsManager).init(client);

/* MD
  ### 🖥️ Wiring the panel

  Add `topics-panel` as a named area in `app.elements` and reference it in
  your layout template, next to the 3D viewer — the panel controls the
  camera and element selection directly in the scene when you click a
  viewpoint.
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
  viewer: () => html`<top-viewer><top-viewer-tools></top-viewer-tools></top-viewer>`,
  topics: () => html`<top-topics-panel></top-topics-panel>`,
};

app.layouts = {
  main: {
    label: "Main",
    icon: "solar:3d-square-bold",
    template: `"viewer topics" 1fr / 1fr 30rem`,
  },
};

app.layout = "main";

const container = document.getElementById("that-open-app") ?? document.body;
container.appendChild(app);
document.body.style.margin = "0";

/* MD
  ### 🤖 What's handled automatically

  **`TopicsManager`** resolves `Viewpoints.world` in the background once
  `top-viewer` creates it (which only happens after `top-app` finishes
  mounting), including backfilling it onto viewpoints that were restored
  from the saved BCF before the world existed — `Viewpoint.go()` would
  otherwise silently no-op for every one of them. Nothing to wire yourself.

  **`topics-panel`**, once mounted, takes ownership of the following without
  any further code from you:

  **Full topic CRUD** — create, edit, and delete (behind a confirmation
  modal) topics with title, type, status, priority, assigned-to, due date,
  and stage. The list shows a search bar, a type badge next to each title,
  and switches to an empty state with a "New topic" call-to-action when
  there's nothing yet.

  **Comments** — add, edit, and delete (with confirmation) threaded comments
  on a topic, each optionally linked to a specific viewpoint via a clickable
  tag that jumps the camera there.

  **Viewpoints** — capture the current camera + selection as a new
  viewpoint, browse them in a snapshot carousel, and click one to fly the
  camera and re-apply its selection highlight. Navigation is a no-op (not an
  error) if no models are loaded yet, so a stray click can't fly the camera
  toward nothing.

  **Documents** — link files from the project's CDE storage (searchable tree
  picker), unlink from just this topic or hard-delete everywhere it's
  referenced, and download. Linking is genuinely shared: the same file
  referenced by two topics reuses one document entry instead of duplicating
  it.

  **BCF export/import** — export the selected topics (or, with nothing
  selected, the whole project) to a single `.bcf` file named after the
  project or the lone topic's title. Import merges a `.bcf` into the current
  project instead of replacing it; a topic sharing a GUID with an existing
  one is overwritten (treated as an update from elsewhere, not a conflict).

  **Persistence** — every mutation is auto-saved through `top-app`'s
  `projectStorageContext`, debounced per file so rapid edits collapse into
  one upload. A small "Saving..." indicator (shared with any other built-in
  using the same context, e.g. `clashes-panel`) reflects the real
  debounce-then-upload cycle: just the icon while pending, the full pill
  while actually uploading.

  **Author/assignee names** — emails resolve to real names (with an
  initials avatar) via `top-app`'s `projectDataContext`, which already
  covers the project owner as well as regular collaborators — no separate
  lookup needed.

  **Cross-panel awareness** — the list updates live even when a topic is
  created somewhere else entirely (e.g. `clashes-panel`'s "Create topic from
  clash"), including the empty-state → list transition if this was the
  project's first topic.
*/
