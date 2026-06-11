---
description: "Build and upload the project to the platform. Automatically detects app vs cloud component from the local .thatopen config. On first publish, saves the assigned item ID back to .thatopen so subsequent runs update the same item instead of creating a new one."
---

## thatopen publish

Builds the project and uploads it to the platform. Works for both apps and cloud components — the project type is read from `.thatopen` (`itemType: APP | COMPONENT`).

First publish creates the item and auto-saves its ID to `.thatopen`. Subsequent publishes update that same item.

**Usage:**
```bash
thatopen publish [flags]
```

**Flags:**

- `--name <name>` — Item name on the platform. Defaults to `name` in `package.json`.
- `--version-tag <tag>` — Version tag. Defaults to `version` in `package.json`.
- `--app-id <id>` — Target an existing app by ID (overrides `.thatopen`).
- `--component-id <id>` — Target an existing cloud component by ID (overrides `.thatopen`).
- `--skip-build` — Skip the build step and upload the existing `dist/bundle.js`.
- `--icon <path>` — Path to an icon file (PNG, WebP, or ICO, max 512 KB). Saved to `.thatopen` for future publishes.

**Examples:**
```bash
thatopen publish
thatopen publish --version-tag 2.0.0
thatopen publish --skip-build
thatopen publish --icon assets/icon.png
```
