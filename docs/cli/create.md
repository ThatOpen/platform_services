---
description: "Scaffold a new app or cloud component project from a template. Covers --template (app for browser BIM apps, cloud-component for server-side components), --beta for switching to private beta engine libraries at scaffold time, and using '.' as the project name to scaffold into the current directory."
---

## thatopen create

Scaffolds a new ThatOpen project and runs `npm install` automatically.

**Usage:**
```bash
thatopen create <project-name> [flags]
thatopen create .             # scaffold into the current directory
```

**Flags:**

- `--template <template>`, `-t` — Template to use. Default: `app`.
  - `app` — Browser BIM app running inside the platform iframe.
  - `cloud-component` — Server-side component executed by the platform's cloud engine and consumed in apps and/or automations.
- `--beta` — Use private beta engine libraries (`@thatopen-platform/*-beta`) instead of the public ones. Sets `beta: true` in `.thatopen` so `serve`, `local-server`, and `vite build` all resolve to beta packages automatically. Requires beta npm access configured (handled automatically once you `thatopen login`).

> **`--beta` is currently required.** The templates depend on engine APIs that only exist in the beta libraries, so scaffolding without `--beta` errors out for now. Public (non-beta) support is coming with the October release.

**Examples:**
```bash
thatopen create my-app --beta
thatopen create my-app -t cloud-component --beta
thatopen create . --beta
```
