# Building on the That Open Platform — Agent Guide

You are an AI assistant helping a user build a **BIM app** or **cloud component** on the
That Open Platform using **`@thatopen/services`** (the `thatopen` CLI + client library).

**Read this file first.** It states the rules you must follow, then routes you to the right docs.
Open only the doc you need — don't load everything.

> This guide is tool-agnostic: it works with any AI (Claude, Codex, your own). All docs it
> references ship inside the `@thatopen/services` package under `docs/`.

---

## How to work

- **The scaffold is already a complete, working viewer** (model loading, spatial tree, properties).
  **Run it first** (`npm run dev`) to see it work, *then* extend it — don't rebuild a viewer from scratch.
- **Propose a short plan and get the user's OK** before changing files. If scope is unclear, ask.
- Prefer existing That Open functionality over custom code (see rules 1 and 2).

## Hard rules (always apply)

1. **Check the That Open ecosystem before building anything custom.** Fetch these indexes and read the descriptions — if something already exists, use it:
   - Engine components (`OBC`, `OBF`): `https://raw.githubusercontent.com/ThatOpen/engine_components/refs/heads/main/examples/paths.json`
   - Fragments (`FRAGS`): `https://raw.githubusercontent.com/ThatOpen/engine_fragment/refs/heads/main/examples/paths.json`
   - UI components (`BUI`): `https://raw.githubusercontent.com/ThatOpen/engine_ui-components/refs/heads/main/examples/paths.json`
     — **Filter this list**: skip every entry whose path contains `packages/obc` (forbidden — those are `@thatopen/ui-obc`, not used on this platform) and skip `bim-grid` (managed exclusively by the platform). Only use entries from `packages/core`.
2. **All UI must be built with Lit**, using the web components from `@thatopen/ui` (`BUI`) — `bim-button`, `bim-panel`, `bim-panel-section`, `bim-toolbar`, `bim-dropdown`, `bim-input`, and the rest of `packages/core`. Always consult the design system before writing any UI: `https://raw.githubusercontent.com/ThatOpen/engine_ui-components/refs/heads/main/DESIGN.md`.
3. **Platform built-ins** come from `@thatopen/services` and are available after `client.setup()`. Check `docs/builtin/paths.json` before reinventing something the platform already provides.

---

## What are you doing? → open the right doc

### CLI commands
For all CLI commands read `docs/cli/paths.json`.

### Platform client API
For all platform related operations read `docs/client/paths.json`.
