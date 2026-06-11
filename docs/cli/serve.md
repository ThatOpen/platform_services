---
description: "Start a local dev server for a browser app. Uses esbuild in watch mode and serves the IIFE bundle on port 4000 with SSE live reload. To preview, open the project on the platform and click the debug button — the platform fetches the bundle from localhost."
---

## thatopen serve

Builds the app in watch mode and serves the IIFE bundle locally. On every save, esbuild rebuilds and the platform reloads the bundle automatically via SSE.

Does **not** open a browser tab — the app runs inside the platform iframe. Open your project on the platform, then click the debug button to connect it to the local server.

**Usage:**
```bash
thatopen serve [flags]
```

**Flags:**

- `--port <port>` — Port to serve the bundle on. Default: `4000`.

**Endpoints served:**

- `GET /bundle.js` — The compiled IIFE bundle.
- `GET /bundle.js.map` — Source map.
- `GET /events` — SSE stream for live reload.

**Example:**
```bash
thatopen serve
thatopen serve --port 4321
```
