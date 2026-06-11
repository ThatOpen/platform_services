---
description: "Toggle or explicitly set the engine library mode between stable public packages (@thatopen/*) and private beta packages (@thatopen-platform/*-beta). Updates package.json and .thatopen, then runs npm install. Source code never changes — aliases handle resolution."
---

## thatopen swap

Switches the project between stable and beta engine libraries. Without flags, it toggles from the current state. Updates `package.json` dependencies and sets `beta` in `.thatopen` so `thatopen serve`, `thatopen local-server`, and `vite build` all pick up the change automatically.

Source code stays unchanged — `@thatopen/components` imports resolve to the correct package via esbuild/vite aliases based on the `beta` flag in `.thatopen`.

**Usage:**
```bash
thatopen swap           # toggle: stable → beta or beta → stable
thatopen swap --beta    # force beta
thatopen swap --stable  # force stable
```

**Flags:**

- `--beta` — Switch to beta libraries (`@thatopen-platform/*-beta`).
- `--stable` — Switch back to stable public libraries (`@thatopen/*`).

**Examples:**
```bash
thatopen swap
thatopen swap --beta
thatopen swap --stable
```

> Beta packages are private and the access must be explicitly granted by That Open Company.
