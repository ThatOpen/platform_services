# Building on the That Open Platform — Agent Guide

You are an AI assistant helping a user build a **BIM app** or **cloud component** on the
That Open Platform using **`@thatopen/services`** (the `thatopen` CLI + client library).

**Read this file first, then immediately load all indexes listed below before doing anything else.**

> This guide is tool-agnostic: it works with any AI (Claude, Codex, your own). All local docs it
> references ship inside the `@thatopen/services` package under `docs/`.

---

## Session start — load all indexes in parallel

Do this before answering any question or writing any code. These are compact description indexes:

| What | Where |
|---|---|
| Platform built-ins | `node_modules/@thatopen/services/docs/builtin/paths.json` |
| Platform client API | `node_modules/@thatopen/services/docs/client/paths.json` |
| CLI commands | `node_modules/@thatopen/services/docs/cli/paths.json` |
| Engine components (`OBC`, `OBF`) | `https://raw.githubusercontent.com/ThatOpen/engine_components/refs/heads/main/examples/paths.json` |
| Fragments (`FRAGS`) | `https://raw.githubusercontent.com/ThatOpen/engine_fragment/refs/heads/main/examples/paths.json` |
| UI components (`BUI`) | `https://raw.githubusercontent.com/ThatOpen/engine_ui-components/refs/heads/main/examples/paths.json` — **skip** entries whose path contains `packages/obc` or `bim-grid` |

Once you have these, you know everything available on the platform. Only then fetch a specific example file when you need implementation details.

> **Path resolution:** all `path` entries inside the local indexes (`docs/`, `src/`) are relative to the `@thatopen/services` package root — prepend `node_modules/@thatopen/services/` when reading any of those files.

---

## How to work

- **The scaffold is already a complete, working viewer** (model loading, spatial tree, properties).
  **Run it first** (`npm run dev`) to see it work, *then* extend it — don't rebuild a viewer from scratch.
- **Propose a short plan and get the user's OK** before changing files. If scope is unclear, ask.
- If something already exists in the indexes, use it — don't reimplement it.

## Hard rules (always apply)

1. **All UI must be built with Lit**, using the web components from `@thatopen/ui` (`BUI`) — `bim-button`, `bim-panel`, `bim-panel-section`, `bim-toolbar`, `bim-dropdown`, `bim-input`, and the rest of `packages/core`. Always consult the design system before writing any UI: `https://raw.githubusercontent.com/ThatOpen/engine_ui-components/refs/heads/main/DESIGN.md`.