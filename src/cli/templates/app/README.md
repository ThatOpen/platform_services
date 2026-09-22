# ThatOpen BIM App

This is a BIM (Building Information Modeling) app built for the That Open Platform.
It runs in the browser inside the platform's iframe and has access to a 3D viewer,
UI components, and the platform API.

> IMPORTANT for AI assistants: the authoritative, always-current reference for the
> platform rules, the built-in components, and how to wire each one is shipped
> inside the installed package. Read these before writing code:
>
> - `node_modules/@thatopen/services/resources/AGENTS.md` — platform rules + the
>   full navigation table.
> - `node_modules/@thatopen/services/docs/builtin/paths.json` — the index of every
>   built-in component, with a one-line description and the path to its example.
> - `node_modules/@thatopen/services/src/built-in/<Component>/example.ts` — a
>   complete, copy-adaptable integration example per component.
>
> This README explains the app's shape and the general pattern. For the exact API
> of any built-in, trust `paths.json` + the example files over any list here.

## How this app works

- **Entry point**: `src/main.ts` — runs as an IIFE when the platform loads the app.
- **Build output**: `dist/bundle.js` — a single IIFE file.
- **Platform context**: the platform injects the app's context (project id, access
  token, API url). `PlatformClient.fromPlatformContext()` reads it for you.

## Commands

```bash
npm run dev        # Start the dev server (esbuild watch + serve on :4000)
npm run build      # Build dist/bundle.js
npm run login      # Authenticate with the platform (saves token locally)
npm run publish    # Publish to the platform
```

### Local development

Apps run inside the That Open Platform within a project, not as standalone websites.
To develop locally:

1. Run `npm run dev` — watches source with esbuild and serves the bundle on port 4000.
2. Open your project on the platform and click the debug button.
3. Live reload is enabled — save a file to rebuild automatically.

**Important**: use `npm run dev` (it runs `thatopen serve` under the hood). Do NOT run
`vite` / `vite build --watch` directly for development — `thatopen serve` applies the
correct build settings (including the beta engine-library aliases for beta projects).

## Key libraries

| Package | Import as | Purpose |
|---------|-----------|---------|
| `@thatopen/components` | `OBC` | BIM engine — components, fragments, worlds |
| `@thatopen/components-front` | `OBF` | Front-end BIM components (Highlighter, measurements, …) |
| `@thatopen/fragments` | `FRAGS` | Fragment geometry format |
| `@thatopen/ui` | `BUI` | UI web components (`<bim-panel>`, `<bim-grid>`, …) |
| `three` | `THREE` | 3D rendering engine |
| `@markerjs/markerjs3` | `MARKERJS` | Screenshot annotation |
| `@thatopen/services` | (named exports) | Platform API client (`PlatformClient`) + built-in components |

```ts
import * as OBC from "@thatopen/components";
import * as OBF from "@thatopen/components-front";
import * as FRAGS from "@thatopen/fragments";
import * as BUI from "@thatopen/ui";
import * as THREE from "three";
import * as MARKERJS from "@markerjs/markerjs3";
import { PlatformClient, UIManager } from "@thatopen/services";
```

## Architecture

The app boots on the **`UIManager`** built-in. `UIManager` registers the platform's
web components — the app shell and viewport plus every panel — as custom elements you
place with plain HTML/`BUI.html`:

- `<top-app>` — the app shell: a CSS-grid layout system with a sidebar (activity bar)
  for switching named layouts.
- `<top-viewer>` — the 3D viewport (pre-configured world: scene, camera, renderer,
  fragments), with its own tools baked in.
- `<top-viewer-toolbar>` — the bottom viewer toolbar (visibility/inspect, clip, measure).
- Side panels — `<top-model-tree>`, `<top-properties-panel>`, `<top-models-list>`,
  `<top-data-table-panel>`, `<top-objects-panel>`, `<top-settings-panel>`, … — each
  self-wires from the contexts `<top-app>` provides (no `components` plumbing needed).

The scaffolded `src/main.ts` already sets this up. The shape is:

```ts
const client = PlatformClient.fromPlatformContext();

// 1. Register the platform web components. UIManager MUST be in setup — it
//    defines <top-app>, <top-viewer>, the panels, etc. before the DOM renders.
const { components } = await client.setup<OBC.Components>(
  { OBC, OBF, BUI, THREE, FRAGS, MARKERJS },
  { uuid: UIManager.uuid },
);
components.get(UIManager).init();

// 2. Build the shell: <top-app> with named element slots + named layouts.
const app = document.createElement("top-app") as any;
app.elements = {
  viewer: () => BUI.html`<top-viewer></top-viewer>`,
  tree: () => BUI.html`<top-model-tree></top-model-tree>`,
  // …more panels…
};
app.layouts = {
  Explorer: { icon: "mdi:file-tree", template: `"tree viewer" 1fr / 22rem 1fr` },
  // …more layouts…
};
app.layout = "Explorer";
app.sidebar = true;
document.getElementById("that-open-app")?.appendChild(app);
```

A layout `template` is CSS `grid-template` shorthand: `"areas" rows / columns`, where
each area name maps to a key in `app.elements`. Each layout with an `icon` becomes a
sidebar (activity-bar) button.

Built-ins are loaded from the platform at runtime **by uuid** through the `setup`
call. You import each one as a named export from `@thatopen/services` (a ready
`{ uuid }` stub with types), never by a deep/internal path.

## Built-in components

The current, authoritative list lives in
`node_modules/@thatopen/services/docs/builtin/paths.json` (index) with a full example
per component under `node_modules/@thatopen/services/src/built-in/`. At a high level:

- **`UIManager`** — the shell + viewport + all `top-*` panels above (already wired by
  the scaffold).
- **`CDEManager`** — the platform CDE: files, folders, versions, metadata.
- **`ClashesManager`** + `<top-clashes-panel>` — clash detection and the ready-made
  clash review UI (detection matrix, run controls, status filters, markers, highlights).
- **`FileList`** — a simple file list.

Read the matching `example.ts` for each before using it — the examples are the
source of truth for imports, ordering constraints, and wiring.

### Adding a built-in feature (the general pattern)

Every manager-style built-in follows the same three steps. Example — adding clash
detection (see `ClashesManager/example.ts` and `UIManager/src/clashes-panel/example.ts`):

```ts
// 1. Import the built-in as a named export from @thatopen/services.
import { PlatformClient, UIManager, ClashesManager } from "@thatopen/services";

// 2. Register it by uuid in the SAME setup call as UIManager.
const { components } = await client.setup<OBC.Components>(
  { OBC, OBF, BUI, THREE, FRAGS, MARKERJS },
  { uuid: UIManager.uuid },
  { uuid: ClashesManager.uuid },
);

// 3a. Init the manager. Do this BEFORE its panel mounts — the panel reads its
//     initial data in connectedCallback and only subscribes to changes afterward.
await components.get(ClashesManager).init(client);

// 3b. Mount the panel web component in a layout slot (UIManager registered it).
app.elements = {
  // …existing elements…
  clashes: () => BUI.html`<top-clashes-panel></top-clashes-panel>`,
};
app.layouts = {
  // …existing layouts…
  Clashes: { icon: "mdi:vector-intersection", template: `"clashes viewer" 1fr / 22rem 1fr` },
};
```

The panel self-wires to its manager — you do not pass props or wire events by hand.

## Loading a BIM model

```ts
const fragments = components.get(OBC.FragmentsManager);

// From URL
const buffer = await (await fetch("https://example.com/model.frag")).arrayBuffer();
await fragments.core.load(buffer, { modelId: "my-model" });

// From platform storage
const fileBuffer = await (await client.downloadFile(fileId)).arrayBuffer();
await fragments.core.load(fileBuffer, { modelId: "my-model" });
```

(The scaffold's `<top-models-list>` panel already loads models the user picks, so you
usually don't need to do this by hand.)

## PlatformClient API (commonly used in apps)

```ts
const client = PlatformClient.fromPlatformContext();
console.log(client.context.projectId);

// Files / folders
const files = await client.listFiles();
const response = await client.downloadFile(fileId);
await client.createFile({ file: blob, name: "model.ifc", versionTag: "v1" });
await client.createFolder("My Folder");

// Execute cloud components
const { executionId } = await client.executeComponent(componentId, { param: "value" });
client.onExecutionProgress(executionId, (data) => {
  // data.progressUpdate — progress %, data.messageUpdate — status
});

// Test against a local cloud component (thatopen local-server running in that project)
client.localServerUrl = "http://localhost:4001";
```

## The channel: external control + multiplayer

This app ships listening on the platform channel (`src/setups/channel.ts`). Two
things work out of the box:

- **External tools can command it.** An MCP server, a CLI or a plugin
  authenticated with a platform token of the same account can send the commands
  declared in `AppCommands` (`ping`, `get-loaded-models`) and gets typed
  replies back. This is how a desktop LLM drives the running app.
- **Tabs of this app see each other.** Every open tab joins a collaboration
  room shared across accounts (`AppCollabEvents`) — the base for cursors,
  presence and live sync.

To add a command, extend the map and handle it; whatever you return is the reply:

```ts
export type AppCommands = {
  // ...existing commands...
  "select-by-category": { payload: { category: string }; reply: { count: number } };
};

external.on("select-by-category", async ({ category }) => {
  const count = await selectByCategory(category);
  return { count };
});
```

The app never opens a socket: the platform shell owns the connection and relays
it, which is also the security boundary. Joining is opt-in per room — the
scaffold joins at boot; move the `join()` calls behind a button to make it a
user choice. Full walkthrough with a collab example:
`node_modules/@thatopen/services/src/core/examples/channel.ts`.

## Configuration

- `.thatopen` — local config (gitignored). Created by `npm run login`; also holds
  `beta: true` for beta projects and the `appId` after the first publish.
- `vite.config.js` — builds the IIFE `dist/bundle.js`; for beta projects it aliases
  the `@thatopen/*` engine imports to their `@thatopen-platform/*-beta` packages.
