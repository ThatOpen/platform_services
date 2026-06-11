---
description: "Start a local HTTP + Socket.IO server that replicates the platform's cloud execution API on port 4001, with esbuild watch mode. Connect an app to it via EngineServicesClient's localServerUrl option to execute and monitor a local cloud component without publishing."
---

## thatopen local-server

Starts a local server that mimics the platform's cloud execution API. Runs esbuild in watch mode and rebuilds the component on every save.

Connect an app to it by passing `localServerUrl` to `EngineServicesClient`:

```ts
const client = new EngineServicesClient(token, apiUrl, {
  localServerUrl: 'http://localhost:4001'
});
```

**Usage:**
```bash
thatopen local-server [flags]
```

**Flags:**

- `--port <port>` — Port to run the server on. Default: `4001`.
- `--skip-build` — Skip the initial build and use the existing `dist/bundle.js`.

**Endpoints:**

- `POST /api/processor/:componentId/execute`
- `GET  /api/processor/progress/:executionId`
- `POST /api/processor/progress/:executionId/abort`
- `GET  /api/processor/:componentId/progress`

**Example:**
```bash
thatopen local-server
thatopen local-server --port 5000
```
