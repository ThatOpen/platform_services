---
description: "Build and run a cloud component locally as a child process, mirroring the backend execution environment. Accepts execution parameters as JSON via --params, validates them against declarations.json, and streams progress output to the terminal."
---

## thatopen run

Builds and executes a cloud component locally, replicating what the platform's cloud engine does. Useful for testing component logic and parameters before publishing.

Execution output (`MESSAGE`, `PROGRESS`, `SUCCESS`, `FAIL`) is streamed to the terminal with elapsed time.

The component runs under Node's permission model, as in the cloud: it can read its project folder and `node_modules`, but cannot write files, start child processes or worker threads, and it gets none of your shell's environment variables. On a Node version without the permission model, a warning is printed and these restrictions do not apply.

**Usage:**
```bash
thatopen run [flags]
```

**Flags:**

- `--params <json>` — Execution parameters as a JSON string. Default: `'{}'`. Validated against `declarations.json` if present (warns, does not fail).
- `--skip-build` — Skip the build step and run the existing `dist/bundle.js`.

**Examples:**
```bash
thatopen run
thatopen run --params '{"fileId": "abc123"}'
thatopen run --skip-build
```
