# That Open — Revit Collaboration Quickstart (for AI assistants)

You are an AI assistant. A user pointed you at this guide so you can set up or join **real-time
Revit collaboration** through the That Open platform, and bring other things of the project (an IFC,
a Rhino model…) into their model with **recipes**. Follow the steps **in order**. Ask the user for anything you don't already have.
**You may run the setup commands yourself** — install the CLI, install the add-in, launch Revit —
*except* where a step says only the user can.

Needs add-in **1.3.0 or later**. `thatopen revit status` prints `addinVersion`; if it is older,
Step 2 updates it. Several things below did not exist or behaved differently before that.

## What this does

Two halves, and they are independent. A team can use the first without ever touching the second.

**Collaboration.** Several people work on **one shared Revit central** using Revit's own
worksharing. The central lives on the platform. Everyone has their own local; syncing sends their
changes up and brings the team's down. Syncs are **queued**, so the central never diverges.

**Recipes.** Something of the project made *outside* this Revit model — an IFC, a Rhino model, a
`.frag` — is brought in by a recipe, chosen and applied from inside Revit by the person working
there. Its changes land in one Revit transaction: an ordinary Revit edit that undoes in one step and
syncs like any other. Nobody else writes into the model.

Recipes are **open on purpose**. Three ship built in (`ifc-to-revit`, `frag-to-revit`,
`rhino-to-revit`), and a project can add its own, usually written with an AI starting from a
built-in: **[Writing a recipe](https://raw.githubusercontent.com/ThatOpen/platform_services/main/docs/recipes-guide.md)**.

## Rules (follow throughout)

- **Never** print, echo, store, or commit the user's access token.
- **Ask, don't assume.** Missing a project id, file path, or central name? Ask first.
- Prefer the **`thatopen` CLI** for platform actions. For the things it does not cover — reading
  who holds what, and where elements are — talk to the **add-in's local API** as described in
  *Talking to the add-in directly* below. Do not call the platform's own HTTP API by hand.
- You may **install software and launch Revit** on the user's machine. Say what you are about to
  run, briefly, before you run it.
- After each command, **check the output** before moving on. A command that answered is not the
  same as a command that did what you wanted.
- **Whatever you find already set up on this machine is somebody's previous session, not this
  user's choice.** A saved login, an environment, a joined project, a model already open in Revit:
  none of it is an answer to a question you have not asked. Report what you found and ask. This is
  the single most likely way to get the whole thing wrong while every command succeeds.

---

## Step 0 — Ask what the user wants to do

**Only if they have not already told you.** "I want to start a new collaborative project in Revit
and here is my file" is (A), said plainly. Reading it back as a four-way menu costs the user a
whole turn to answer something they just said, and that is the single most common way this guide
wastes somebody's time. Work out which one it is, say which one you took it to be in one line, and
carry on. Ask only for what is genuinely missing.

> "What would you like to do?
> (A) **Share** a Revit model with my team for the first time.
> (B) **Connect** to a shared central a teammate already uploaded.
> (C) I **already have my local open** in Revit — just sync it.
> (D) **Bring something into my model** — an IFC, a Rhino model — with a recipe."

Then collect what that choice needs. Ask now; you will need it below.

- **(A) Share:** the **absolute path** to the `.rvt`, a short lowercase **name** for the shared
  central (e.g. `tower-central`), and the platform **Project ID**. The file may or may not already
  be a workshared central — Step 3 checks. Either way **the user's original file is never
  modified**; a copy is uploaded.

  **Sharing a new central means a new project. Always send them to make one, every time:**

  > "A shared central lives inside a platform project, so let's make one for it. Open
  > **https://platform.thatopen.com/dashboard/projects**, create a project, then paste me either its
  > id or just the URL of the page you land on — I can take the id out of the URL."

  Take the **URL** if that is easier for them; the id is the segment after `/projects/`. Asking
  somebody to copy a hex string off a settings page is a worse experience than asking for the
  address bar, and it is the same information.

  **You cannot do this part for them.** The CLI has no command to list projects and none to create
  one, so there is no menu to offer and nothing to pick from — which also means: do not guess an id,
  and do not reuse one you saw in `status`. Every command after this needs it, and a wrong one fails
  with a 403 that reads like a permissions problem rather than a typo.

- **(B) Connect:** identify the existing central by **one** of:
  - the **project folder id** of the central — the `revit-<name>` folder inside the project's
    `bimterop` folder in the dashboard, or
  - the **local path**, if they already have it: `C:\ThatOpenShared\<project>\<name>\<file>.rvt`.

- **(C):** nothing extra, but Revit must have their local open.
- **(D):** Revit must have their model open, and what they want to bring in must already be a
  document of the same project (a file uploaded to the project through the CDE, which makes it a document).

Do **not** ask for the access token yet. That is Step 1.

---

## Step 1 — CLI and login

1. **CLI:**
   ```
   npm install -g @thatopen/services@latest
   ```
   Check `thatopen --version` prints something. Needs Node.js 18+; if `node -v` fails, ask the user
   to install Node.js first.

2. **Token.** Ask for it, and say exactly where to get it:

   > "To log in I need a That Open Platform **access token**. You create it yourself:
   > **https://platform.thatopen.com/dashboard/data → API Tokens → create → copy**, then paste it
   > here."

   ```
   thatopen login --token <TOKEN>
   ```

   That command is already right: **it logs in to production, which is where everybody is.** Do not
   ask the user to choose an environment — there is a dev platform, it is for the people building
   That Open Platform, and they will say so without being asked.

   **Log in even if the machine is already logged in.** A saved login is whoever used this machine
   last. Never print the token back.

   [Logging in to That Open Platform](https://raw.githubusercontent.com/ThatOpen/platform_services/main/docs/platform-token.md) is the short page for when this does not
   go smoothly: what to do if the machine turns out to be pointed at dev, and why `Unauthorized` and
   `403` mean different things.

**Log in before Step 2**, not after: installing the add-in downloads a private package and needs
these credentials.

---

## Step 2 — The add-in

```
thatopen revit status
```

- Prints `"loaded": true` → the add-in is running. Check `addinVersion` is **1.3.0 or later**; if
  not, update it with the same command as below. Then go to Step 3.

> **`status` also reports a `project`, a `doc` and a `central`. Do not use any of them.** They are
> whatever this machine did last, which on a colleague's laptop or a shared machine is somebody
> else's work. Say what you found and ask:
>
> > "This machine is still connected to project `<id>`, document `<doc>`. Do you want to keep
> > working on that one, connect to a different project, or share a new model?"
>
> Publishing into the wrong project succeeds, looks completely normal, and puts somebody's model
> somewhere their team cannot see it.
- Errors *"The That Open Revit add-in is not running"* → work through (a), then (b).

**(a) Is Revit 2027 open?** If not, launch it:
```
powershell -Command "Start-Process 'C:\Program Files\Autodesk\Revit 2027\Revit.exe'"
```
A cold start takes a while. Re-run `thatopen revit status`.

**(b) Revit is open but status still errors → install the add-in.** Revit must be **closed** for
this, because it holds its add-in files open while it runs. Ask the user to close it, then:
```
thatopen revit install
```
This fetches the current package from the registry and runs the installer that ships inside it.
`--version <v>` pins a specific one; the default is the latest.

Then **launch Revit again**. On the first start after an install, Revit shows an **unsigned add-in**
prompt. **Only the user can answer it — ask them to choose "Always Load".** There is no way around
it from a script, and it comes back after every update until the add-in is signed.

Re-run `thatopen revit status` every ten seconds or so until `"loaded": true`.

---

## Step 3 — Do the action

### (A) Share a model — one command

```
thatopen revit share --file "<FILE>" --project <PROJECT>
```

That is the whole of it. `share` installs the add-in if nothing is listening, starts Revit and
waits for it, checks whether the file is already a central, publishes it, and opens the user's own
local. It prints each of the five steps as it reaches them, so a long silence is always a step you
can name.

- **`--doc <name>`** is optional. Left out, it comes from the file name, kebab-cased.
- **`--project`** takes the dashboard URL as happily as the id.
- **The original file is never modified.** Everything happens on a copy, which is why `share` does
  not need to ask before converting: there is nothing to lose. Say so rather than asking.
- **It joins at the end on purpose.** Sharing a model and then carrying on in the original file is
  the one reliable way to end up outside your own team.

Steps 1 and 2 (CLI, login, add-in) still have to have happened: `share` installs the add-in but it
cannot log in for somebody.

If you need the pieces separately — a central that already exists, a different convert decision,
scripting around it — they are still there: `thatopen revit inspect --file`, then
`thatopen revit publish-central --project --doc --file [--convert]`, then `thatopen revit join`.

### (B) Connect to a central — `join`

```
thatopen revit join --folder-id <FOLDER_ID>
thatopen revit join --path "C:\ThatOpenShared\<project>\<name>\<file>.rvt"
```
`--project <PROJECT> --doc <DOC>` also works when the user knows both. This downloads the central,
creates the user's local, and opens it.

### (C) Already have a local open — `sync`

```
thatopen revit sync
```

### (D) Bring something in with a recipe

Go to **Step 6**.

---

## Step 4 — Work, then sync

Tell the user to **model normally**. To send their changes and pull the team's, they use **Revit's
own Synchronize with Central** on the Collaborate tab, exactly as on any worksharing job. The add-in
listens for it: it takes a turn in the team queue and brings the central up to date *before* Revit
merges, then publishes the result. A corner notice reports each step and ends with
`Synced.  vN → vM.`

There is no "sync to team" button, on purpose. Two buttons that must mean the same thing are a
question nobody should have to answer twice a day.

For a script or an agent, the same round trip is `thatopen revit sync`.

---

## Step 5 — Worksets, so two people don't edit the same thing

**Claiming one is Revit's own dialog:** Collaborate → Worksets, tick *Editable* on the row you want.
Same dialog, same rules and same messages as any Revit job. Ownership reaches everybody within
seconds, because the add-in replicates the worksharing files the central keeps beside it and each
Revit re-reads them by itself.

Only **one person at a time** owns a workset, and **Revit** enforces it: a teammate who tries to
take what you hold is told who holds it. That also means only *you* can give yours back — there is
no API that relinquishes on somebody else's behalf, so "ask them to release it" is the real answer
rather than a workaround.

**Release** by relinquishing in Revit, or simply by syncing, which relinquishes as part of the
dialog's terms.

From a script:
```
thatopen revit worksets                      # who holds what
thatopen revit take   --workset "<NAME>"
thatopen revit untake --workset "<NAME>"
```

> Editing an element makes you its **borrower** automatically, element by element. Taking a workset
> makes you its **owner**. Revit only blocks editing worksets owned by **somebody else**; free ones
> are borrowed on demand.

---

## Step 6 — Recipes: bring something into the model

A recipe brings something of the project — an IFC, a Rhino model, a `.frag` — into this Revit model
as native Revit elements. It is chosen and applied **from inside Revit**, by the person whose model
it is, in one go. There is nothing to send, approve or wait for.

**The source has to be in the project first.** An IFC uploaded to the project, a Rhino model
published from Rhino (**[Rhino → Revit, start to finish](https://raw.githubusercontent.com/ThatOpen/platform_services/main/docs/rhino-interop-quickstart.md)**
covers that side). The recipe reads it from the platform, at the version it is on.

Tell the user the two commands on the **That Open** ribbon:

1. **That Open > Select recipe.** Pick the recipe — the built-ins (`ifc-to-revit`, `frag-to-revit`,
   `rhino-to-revit`) and any the project made itself, marked "this project" with their version —
   then its **source** from the list of the project's documents it can read, then its settings.
   "More…" shows what the recipe does and what it leaves out. The choice is remembered with the
   model, so this is done once.
2. **That Open > Apply recipe.** The recipe runs inside the add-in and its changes are written at
   once, in **one** Revit transaction. **Ctrl+Z undoes it whole**; closing without saving, or going
   back in the history, reverts it like any other edit.

**Applying again writes only what changed** in the source since the last apply. With no change it
says **"Nothing imported"** — that is the answer, not an error. What each recipe made is remembered
in the model's own That Open data on the platform, so this works from any machine with that model.

The change is in the local only; the user still syncs (Step 4) to publish it. That commit is
marked as a recipe's: the history panel shows it with a recipe mark and a title such as
«IFC to Revit: 6 level(s), 47 wall(s)…», «from racbasicsampleproject.ifc v1» — which recipe, and
which version of which source, made it.

**Expect this one, it is not a bug:** elements a recipe adds land on the document's **active**
workset, so whoever applies has to be able to edit *that* one — often `Workset1`, which nobody
thinks of as theirs.

**Verify with coordinates, not with the word "applied".** After applying, `POST /where` with
`{ "uids": [ … ] }` gives each element's position in metres. If the title says four columns, check
that four columns are where the source put them. "Applied" and "applied to three of the four" read
identically in a notice and differently in a model.

If the user wants a recipe that does not exist yet — *"a column at every point of this layer"*,
*"a room for every space of this spreadsheet"* — that is
**[Writing a recipe](https://raw.githubusercontent.com/ThatOpen/platform_services/main/docs/recipes-guide.md)**:
written with you, tested without Revit, saved in the project, and then listed in Select recipe.
If they want their own application to take part — be a source, or apply recipes itself —
**[Writing a flow plugin](https://raw.githubusercontent.com/ThatOpen/platform_services/main/docs/flow-plugin-guide.md)** is the byte
contract, and **[the architecture notes](https://raw.githubusercontent.com/ThatOpen/platform_services/main/docs/flow-architecture.md)** say why it is shaped that way.

---

## Step 7 — Offer them a viewer that shows the progress

**Offer this as soon as the central exists — right after Step 3, before they start working.** Not
at the end. Every sync from that moment on becomes a commit they can watch arrive, and setting it up
costs the same on day one as on day thirty. Left to the end it sounds like an extra; offered at the
start it is the thing that makes the rest visible.

Every sync is a commit, and the platform keeps the lot: who changed what, when, and the geometry as
it was at each version. Nothing in Revit shows that back, and it is the first thing people ask —
*what has changed since Friday?*

Say it plainly and wait:

> "Everything you sync is stored as a history. Would you like a viewer that shows it — pick any
> version and see what was created, modified and deleted, coloured in 3D?"

If they say yes, that is an **app**, and building one is
**[the platform AI quick start](https://raw.githubusercontent.com/ThatOpen/platform_services/main/docs/ai-quickstart.md)** — scaffold with the `app` template and follow
it.

**Do not ask them how to add the panel.** Add a **new layout** called `History`, and leave the
scaffold's own layouts alone. It is a two-line change, it keeps the app they were given intact, and
it is the answer every time — asking hands somebody a UI decision about a screen they have not seen
yet.

```ts
app.elements = {
  ...app.elements,
  history: () => html`<top-git-history></top-git-history>`,
};
```

**For the layout, copy one of the scaffold's own panel layouts and swap its panel for `history`** —
same side, same width, same shape. Do not choose a side and do not pick a width: the app already
answered both, and the answer is written in `app.layouts` right there in `main.ts`.

A panel that opens on the opposite side from every other one, at a different size, is the first
thing anybody notices, and it reads as bolted on however good the contents are.

For the layout's `icon`, use **`at-icons:git-branch`** — That Open's own icon set, and the branch
mark is what the panel actually shows.

What makes it a history viewer rather than an empty viewer is a built-in component that already
exists, so nobody writes this part:

- **`GitHistoryManager`** — the headless half. It reads `revitflow_history.json` and the per-commit
  `revitflow_frag_<N>.frag` files the add-in writes under `bimterop/revit-<docId>/`, loads the
  model, and colours a commit's elements: **green created, blue modified, red deleted**. It has an
  `isolateChanges` mode that ghosts everything else, which is the one people keep on.
- **`top-git-history`** — the panel, registered by `UIManager`. It only asks the manager for things
  and listens; all the viewer work is on the manager.

Two things to say honestly when you offer it. The history only goes back as far as the team's first
sync through this add-in — it is not read out of the `.rvt`. And a commit's colours come from what
the add-in recorded at sync time, so a change somebody made and never synced is not in it, the same
way it is not in anybody else's model.

---

## Talking to the add-in directly

The add-in serves a small HTTP API on **127.0.0.1**, and it is the same surface the CLI drives: a
person clicking and a script deciding are the same operation. Use it for what the CLI does not
cover. Do not use it to skip a CLI command that exists.

**Find it.** The port and the token change every launch, so read them rather than configuring them:

```
%APPDATA%\ThatOpen\revit-addin.json   →  { "port": …, "token": "…", "pid": … }
```

Send the token as the header **`X-RevitFlow-Token`**, POST JSON, read JSON back. The endpoints this
guide uses are `status`, `where` and `worksets`.

Three things that will otherwise mislead you:

- **`worksets` has `revitOwner` and `tocOwner`, and no field called `owner`.** Reading `owner`
  returns nothing for every row, which looks exactly like "nobody owns anything" and is a lie.
  `revitOwner` is Revit's answer, and Revit's answer is the one that decides.
- **The add-in serves one request at a time.** A machine in the middle of a sync answers nothing,
  and from outside that is indistinguishable from a crash. Diagnose from
  `%APPDATA%\ThatOpen\revitflow.log`, which keeps being written throughout. Never conclude anything
  from a timeout alone.
- **A modal dialog in Revit stops everything.** The add-in does its work when Revit is idle, and a
  dialog waiting for a click means Revit never is. If a call hangs, ask the user to look at Revit's
  window before assuming something is broken.

---

## Troubleshooting

- **`thatopen login` fails with "Unauthorized"** → the token is invalid, expired, or from the other
  environment. Production tokens use no `--api-url`; dev tokens use
  `--api-url https://dev.platform.thatopen.com`. Ask for a fresh one from the same environment.
- **HTTP 403 on `item/folder?projectId=…`** → login worked, but that account has no access to that
  Project ID. Confirm the id and the environment with the user.
- **"add-in not running" while Revit is open** → it is not installed. Step 2(b).
- **`thatopen revit install` refuses** → Revit is still open. Close it.
- **`take` answers `taken: false` with `deniedBy`** → somebody else holds that workset. Expected,
  not an error. Ask them to release and sync, or take another.
- **`take` answers `offline: true`** → the platform is unreachable. The take is **refused, not
  queued**, and deliberately: the platform is what arbitrates the race, so with it gone nobody can
  know whether a colleague already holds it. Nothing was changed. Retry when `status` says
  `online: true`.
- **`locks` answers `offline: true` instead of a list** → the same outage. That is **not** an empty
  list; claims still stand. `worksets` still answers from Revit with `registry: false`, and that
  half needs no network at all — use it to see what the user themselves holds.
- **A teammate can still edit "my" workset** → ownership has not reached them yet. You must sync
  after taking it, and they must sync afterwards.
- **Apply recipe is refused on a workset nobody seems to own** → it is probably the **active**
  workset, where the recipe's new elements land. See Step 6.
- **Apply recipe says "Nothing imported"** → the source has not changed since the last apply.
  Expected. Publish or upload a new version of the source first.
- **Everything hangs and nothing new is in the log** → a Revit dialog is waiting for a click.

---

## Rules recap (for the AI)

- Ask for every value you do not have. Never guess a project id, a file path or a central name.
- Never echo or store the token.
- You may install the CLI and the add-in and launch Revit. Only the "Always Load" prompt needs the
  user — and so does applying a recipe, which is an edit of their model made from their Revit.
- CLI first; the add-in's local API for reading ownership and positions; never the platform's own
  HTTP API by hand.
- Read each answer before the next step, and prefer a measured value to a status word: coordinates
  over "applied", `revitOwner` over "it should be fine".
