# That Open Platform — AI Quick Start (zero to a running app or cloud component)

You are an AI assistant. A user pointed you at this URL so you can scaffold and run something
on the [That Open Platform](https://platform.thatopen.com) from scratch, using
`@thatopen/services` (the `thatopen` CLI + client library). Follow the steps below in order.

> The only secret you need is a **platform API token** — **not** an npm token. The CLI
> derives private beta-registry access from the platform token automatically.

---

> **Not building anything — here to work in Revit?** If what the user actually wants is to share a
> Revit model with their team, join one a colleague uploaded, or review a change some other tool
> proposed to their model, this is the wrong guide and nothing below applies. Go to
> **[the Revit collaboration quickstart](https://raw.githubusercontent.com/ThatOpen/platform_services/main/docs/revit-collab-quickstart.md)** and follow that instead.
> It is the same shape as this one: ask first, then drive the CLI.
>
> Phrases that mean that guide, not this one: *"I want to collaborate on a Revit project"*, *"share
> my central"*, *"join my team's model"*, *"someone sent me a change to approve"*, *"work on the
> same model as my colleague"*.

> **Making another application talk to this one?** If the user wants their own tool — Rhino, Blender,
> a script, an in-house app — to send changes into somebody's model or to show a model it did not
> author, that is a third thing again: **[Writing a flow plugin](https://raw.githubusercontent.com/ThatOpen/platform_services/main/docs/flow-plugin-guide.md)** is the
> byte contract, and **[the architecture notes](https://raw.githubusercontent.com/ThatOpen/platform_services/main/docs/flow-architecture.md)** say why it is shaped that
> way. Start at its section 0, which sorts the work into three sizes; most integrations are the
> smallest one and need no ownership, no history and no collaboration layer.
>
> Phrases that mean those: *"export my model to the platform"*, *"send my geometry to Revit"*,
> *"write a plugin for X"*, *"read a .frag in my app"*.

---

## First — what are you building? (ask if the user hasn't said)

There are two kinds of project. **If the user hasn't told you which they want, ASK them
before scaffolding** — explain it in plain terms and let them pick:

- **App** — something people *open and click around in*, running in the platform's browser
  UI: a 3D BIM viewer, a dashboard, a form, a custom tool. Choose this when the goal is a
  visual interface. Template: `app`.
- **Cloud component** — *server-side logic* with no UI of its own, running in the platform's
  cloud and triggered by an app or an automation to do work on the project's data — e.g.
  convert a file (IFC→fragments, point cloud→tiles), generate a report, run a calculation.
  Choose this when the goal is processing/automation, not a screen. Template: `cloud-component`.

Steps 0–2 are identical for both; they diverge only at `create` (step 3) and how you run them
(step 4). This guide marks **[app]** / **[component]** where they differ.

## 0. Prerequisites (check, don't assume)

- **Node.js ≥ 18** and **npm** — verify with `node -v`.
- A **That Open Platform API token**. The user creates it themselves:
  → **https://platform.thatopen.com/dashboard/data → API Tokens → create → copy.**
  Ask the user to paste it. **Never print it back, never write it into a file, never commit it.**

## 1. Install the CLI

```bash
npm install -g @thatopen/services@latest
```

## 2. Log in (do this BEFORE creating the project)

Get the token from the platform dashboard — **https://platform.thatopen.com/dashboard/data**
→ **API Tokens** → create → copy. Ask the user to paste it, then run:

```bash
thatopen login --token <platform-token>
```

**[Logging in to That Open Platform](https://raw.githubusercontent.com/ThatOpen/platform_services/main/docs/platform-token.md)** is the short version of everything that
goes wrong here: production and dev are separate worlds, `login` does not say which one it saved,
and a machine that is already logged in is somebody's previous session rather than a decision. Read
it if the user is not on a fresh machine, or if anything comes back `Unauthorized` or `403`.

This validates the token and stores it in `~/.thatopen/config.json`. Login **must** come
first: the next step's install pulls the private `@thatopen-platform/*-beta` packages, and
`create` uses your logged-in token to write an authenticated `.npmrc` so that install can
resolve them. No npm account or manual npm token is involved.

## 3. Scaffold a beta project

**[app]**
```bash
thatopen create my-app --beta
cd my-app
```

**[app, showing a Revit model's commit history]** If what they asked for is a viewer of the
revit-flow history, scaffold it directly. Do not build it by hand: the wiring is four additions in
three places and the ORDER of them is load-bearing (see the boot order section below). This ships
it already correct, opening on the History layout.

```bash
thatopen create my-app --beta --history
cd my-app
```

**[component]**
```bash
thatopen create my-component -t cloud-component --beta
cd my-component
```

`--beta` is required for now (the templates use engine APIs that currently live only in the
beta libraries; public support lands with the October release). `create` configures private
beta access from your platform token and runs `npm install` for you. The **app** scaffold is
a complete working viewer; the **cloud-component** scaffold is a `main()` entry point plus a
`declarations.json` (the parameters the component accepts) — read its `README.md`, which
explains the exactly-four globals the cloud engine injects (do NOT import them) and how to
read/write the project's data.

## 4. Run it

**[app]**
```bash
npm run dev
```
Serves the app and opens it inside the platform. **You now have a complete, working viewer** —
model loading, spatial tree, properties, measurement, sectioning, and more.

If it does not open by itself, or the user closes the tab, the app you are serving from this
machine lives at:

```
https://platform.thatopen.com/dashboard/projects/<PROJECT_ID>/apps/local-app
```

Substitute the project id. That is the local app running inside the platform's own UI, against
the project's real data. Send the user there rather than to a bare localhost port, which is the
app without the platform around it.

> **`npx tsc --noEmit` reports errors in a fresh beta scaffold, and they are not real.** You will see
> a handful of `Cannot find module '@thatopen/components'` and friends. A beta project aliases those
> imports to the `@thatopen-platform/*-beta` packages in `vite.config.js`, which bare `tsc` does not
> read — so it is looking for packages this project deliberately does not install.
>
> **In this project, `tsc` is not a signal.** Do not try to fix those errors, do not report them as
> problems you found, and do not use a clean `tsc` as your definition of done. `npm run dev` and
> `npm run build` are the ones that tell you anything; to check that something you added really
> shipped, grep the built bundle for it.

**[component]**
```bash
npm run run        # executes the component locally against the platform (no browser)
```
Runs `main()` in a local emulation of the cloud engine so you can iterate before publishing.

## THE BOOT ORDER. Read this before you write a line of an app.

**This is where apps break, and the error never names the real cause.** An app boots in four
stages, and a built-in that touches models or the 3D scene must be initialised in the LAST one.
Call it where it reads naturally, right after `client.setup`, and you get:

```
Error: FragmentsManager not initialized. Call init() first.
Uncaught (in promise) TypeError: Cannot read properties of undefined (reading 'onHighlight')
Uncaught (in promise) TypeError: Cannot read properties of undefined (reading 'onClear')
```

None of which says "you called this too early". The app renders, the panel mounts, and it sits
there inert.

**Why.** `FragmentsManager` is initialised inside `top-app`'s own `setup` callback, and the 3D
world does not exist until `<top-app>` has been added to the DOM and `top-viewer` has built it.
Both of those happen well after `client.setup` returns. Any manager that reads model files or
colours elements reaches for them the moment it starts.

**The order, and it is not negotiable:**

1. `client.setup(...)` with every built-in you need, then `components.get(UIManager).init()`
2. `app.setup = ...`, which is where `FragmentsManager.init` goes, and append `<top-app>`
3. `await firstWorld(...)`, so the world exists
4. **only now**, `init(client)` on the model-facing managers

Copy this skeleton. It is the boot of an app that works.

```ts
async function main() {
  const client = PlatformClient.fromPlatformContext();

  // 1 ── built-ins registered, UI shell up
  const { components } = await client.setup<OBC.Components>(
    { OBC, OBF, BUI, THREE, FRAGS, MARKERJS },
    { uuid: UIManager.uuid },
    { uuid: GitHistoryManager.uuid },        // and any other built-in you use
  );
  components.get(UIManager).init();

  const viewerEl = document.createElement("top-viewer");
  const app = document.createElement("top-app") as any;

  // 2 ── this callback is what initialises FragmentsManager. Nothing that needs
  //      fragments may run before it has resolved.
  app.setup = (waitUntil: (p: Promise<void>, label?: string) => void) => {
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

  app.elements = { viewer: () => BUI.html`${viewerEl}` };
  app.layouts = { Main: { template: `"viewer" 1fr / 1fr` } };
  app.layout = "Main";
  (document.getElementById("that-open-app") ?? document.body).appendChild(app);

  // 3 ── the world is created asynchronously by top-viewer. Wait for it.
  await firstWorld(components.get(OBC.Worlds));

  // 4 ── ONLY NOW. Everything above had to have happened first.
  await components.get(GitHistoryManager).init(client);

  // ...and from here, the real layouts, panels and elements.
}

/** Resolves with the first world once it exists (top-viewer creates it async). */
function firstWorld(worlds: any): Promise<any> {
  const existing = [...worlds.list.values()][0];
  if (existing) return Promise.resolve(existing);
  return new Promise((resolve) => {
    const handler = ({ value }: any) => {
      worlds.list.onItemSet.remove(handler);
      resolve(value);
    };
    worlds.list.onItemSet.add(handler);
  });
}
```

**Two more traps in the same family:**

- **One stable `top-viewer` node, held in a variable and returned by reference** from every
  `elements.viewer()` call. Creating a fresh element on each render disposes the world and
  builds another one, and everything wired to the old one goes quiet.
- **Registering a built-in is not the same as initialising it.** `client.setup` makes
  `<top-git-history>` resolvable; `init(client)` is what fills it. A panel that mounts and stays
  empty is usually the second one missing, not the first.

## 5. Then build — read the in-project agent guide

The scaffold is real, working code — a complete viewer **[app]** or a runnable `main()`
**[component]** — not a blank page. **Before changing anything**, open and follow:

```
node_modules/@thatopen/services/resources/AGENTS.md
```

(The scaffolded project's own `AGENTS.md` points here too.) It is the canonical guide for
**both** project types: it indexes every platform built-in, the client API, the CLI, and the
engine / UI example sets. Load those indexes before writing code. For an **app**, **all UI
must be built with Lit + `@thatopen/ui` (`BUI`)** — consult the design system first. Run the
scaffold first, then extend it; don't rebuild from scratch.

## 6. Publish (when ready)

```bash
npm run publish
```

Builds, zips (`dist/bundle.zip`), and uploads a new version to the platform — for an **app**
or a **component** (a component also ships its `declarations.json`). Re-run it any time to
push a new version.

Once published, it shows up at **https://platform.thatopen.com/dashboard/data** — an **app**
under **Apps**, a **cloud component** under **Components**. Either way it isn't running
anywhere yet: to actually use it, **add it to one of your projects** from there. (A cloud
component, once added to a project, is then triggered by an app or an automation in it.)

---

## Rules for you, the assistant

- **Platform token only.** Never introduce, request, or store an npm token.
- **Never echo or persist the user's token.** It belongs only in `~/.thatopen/config.json` /
  `.npmrc`, both of which the CLI manages and git-ignores.
- **Do the thing they asked for.** If the request already says what to build, build it. Proposing a
  four-point plan and waiting for approval to do what was just requested costs the user a whole turn
  and buys nothing. Stop and ask only when you are about to change files you did not create, when
  the request can be read two ways that mean different work, or when the next step is destructive.
- The scaffold already works — **extend it, don't replace it.**
