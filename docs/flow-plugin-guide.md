# Writing a flow plugin

The concrete contract. [The architecture notes](https://raw.githubusercontent.com/ThatOpen/platform_services/main/docs/flow-architecture.md) say why any of this is
shaped the way it is; this says what the bytes look like.

> **Plug-ins only.** Since `@thatopen/services` 0.20, apps and scripts do not write this layout by
> hand: `client.history(projectId)` reads and writes documents and version timelines, and
> `client.recipes` lists and runs the recipes that bring project data into a native application —
> see `src/core/examples/history.ts` in the package, and
> [Writing a recipe](https://raw.githubusercontent.com/ThatOpen/platform_services/main/docs/recipes-guide.md)
> for the recipes themselves. The bytes below are the contract for NATIVE PLUG-INS (which carry their own client),
> and the reference for what the API does underneath. Anything else touching these files directly
> will break when the layout moves behind the API, which is the plan.

Nothing here is aspirational. Every rule below is what the Revit and Rhino plugins already do, and
was written from their implementation rather than ahead of it — which is why the awkward parts are
stated as plainly as the tidy ones. Where a rule exists because something broke, it says so.

The most reliable way to check any of it is the same one available to you: publish something and
read it back. The formats are open and the platform's file API is the whole transport.

---

## 0. Which of these do you actually need?

Three different jobs, three different amounts of work. Pick yours before reading further.

| You want to | Implement | Sections |
|---|---|---|
| Let people bring project data into YOUR application | Run a recipe, apply the changes it returns | 1, 2, 5 |
| Show a model your application did not author | Read a `.frag` | 1, 3 |
| Let people collaborate in YOUR application | A history, plus whatever arbitration it needs | 1, 3, 4, 6 |

Applying a recipe needs no ownership registry and no collaboration layer of your own: the changes
are an ordinary edit in your application, made by the person working there. Writing a recipe needs
no plugin at all — that is
[Writing a recipe](https://raw.githubusercontent.com/ThatOpen/platform_services/main/docs/recipes-guide.md).

---

## 1. Where things live


The platform's file API is the whole transport. There is no flow server.

```
project
└── bimterop/                              a folder, created on demand
    └── revit-<documentId>/                one per model
        ├── <modelname>.frag               the model, as of the last full export
        │   └── (hidden children)          per-commit delta .frag, addressed by id
        ├── revitflow_history.json         the commit log
        ├── revitflow_recipes.json         the recipes this model was given, and what each made
        ├── revitflow_btree.json           file -> blocks, current state
        ├── revitflow_btree_<n>.json       file -> blocks, as of version n
        ├── revitflow_bindex.json          block -> which pack holds it
        ├── revitflow_bpack_<n>.zip        the blocks first seen at version n
        ├── revitflow_version.txt          the current version number
        ├── revitflow_manifest.json        version, who, when
        ├── bimterop-locks-anchor          a file whose hidden children are claims
        └── revitflow-queue-anchor         a file whose hidden children are queue tickets
```

**Visible files are named; hidden files are not.** The platform's hidden-file API has no queryable
name: listing by parent and fetching by id both return ids and sizes only. So every hidden file's id
has to be written down somewhere visible when it is created, or it is orphaned for good. That single
fact explains several shapes below — `deltaId` on a commit, and the use of an ordinary file as an
"anchor" whose only job is to be a parent.

**Two things come free with a listing, and they matter.** A hidden file's `_id` is a Mongo ObjectId
whose first four bytes are its creation time, so a set of hidden files is ordered by arrival without
downloading any of them. `owningEntity` is the platform user who created it. The sync queue and the
ownership registry are both built entirely out of those two facts.

---

## 2. The changes a recipe returns


A recipe's `run` answers `{ title, verb, payload, targets, ruleTallies }`, or throws `UpToDate` when
there is nothing to write. `payload` is the changes; the plugin applies them directly, in its own
application. They are never uploaded and never queued: they exist between the run and the apply,
in memory.

`verb` is a label — `add`, `set`, `remove` or `mixed` — and is never read to decide anything,
because one run may add, change and remove at once. `title` is what the history row will say.
`ruleTallies` has one `{ read, written }` per row of the manifest's `rules`.

Recipes build the payload with `OperationBuilder` (`add`, `set`, `remove`, then `build(opId)`), so
nobody writes these bytes by hand; `describeChanges(payload)` reads them back as a list. What
follows is what that payload IS, for a plugin that has to apply it.

### The payload

A `.frag` with **no geometry at all**.

- one geometry-less item per change
- the target's native id in the item's `guid` — the slot the format already has for a global id
- the envelope, as JSON, in `Model.metadata`

A geometry-less item is a real thing the format supports, but writers get it wrong in a way that is
worth stating: only items that actually have vertices and indices may appear in the mesh table, and
an item's bounding box must not be all zeros (a zero-size box reads as absent and the reader stops
with "Dimension not found").

### The envelope

```json
{
  "schema": "revitflow/op@2",
  "opId": "op-9a68aceffc4e",
  "batchId": "batch-...",
  "targetProject": "<project id>",
  "targetDocument": "<document id>",
  "baseCommitGuid": "<commit guid this was authored against>",
  "baseCommit": 18,
  "author": "recipe:columns-from-points",
  "title": "Columns from points: 4 change(s)",
  "summary": "add",
  "transform": { "translate": [0,0,0], "rotate": {"origin":[0,0,0],"axis":[0,0,1],"degrees":90} }
}
```

`schema` is checked exactly. An applier that reads `@1` the `@2` way would not fail, it would
quietly do the wrong thing, so an unknown schema is refused and the recipe has to be updated.

`baseCommitGuid` / `baseCommit` name the commit of the target the changes were computed against.
The plugin applies them right after the run, so that is normally the model as it is; an element a
`set` or `remove` names that is gone all the same is reported rather than skipped quietly.

`transform` is optional and applies to every `set` item, on top of whatever its attributes change.
It exists alongside the per-item transform because the two answer different questions: an item's own
transform says "put it HERE", which is what an `add` needs; this says "move it BY this", which needs
no knowledge of where anything currently is.

**There is no `units` field, deliberately.** The changes edit the data an application published, so
its numbers are in the terms of that data — exactly as a patch over a JSON document writes the
fields as the document holds them. Read a position out of a published model, write it back
unchanged, and nothing moves. Converting from whatever the author's document uses is the
recipe's job, because the recipe is the only thing that knows both sides. An earlier version
made every change set declare its units, which looked careful and was a bug waiting to happen: it let
an author state a unit while writing coordinates in an axis convention the target does not use, a
mistake no declared unit can catch.

### Who wrote it

The envelope's `author` is free text: a recipe writes `recipe:<name>`. It is not who made the
change. The person who applied the recipe is, and they appear where every change of theirs appears:
on the commit their sync writes (section 3), whose `userId` is what the platform's own member
component resolves into a real name and face. Get that wrong and the commit shows up under
somebody else's avatar, which is worse than showing none.

**In a native plug-in there is no call that answers it**, so read the `u` claim out of the API
key's JWT payload (base64url, no signature check, since this only decides which name to display).
That is what the Revit add-in does.

### The verbs

One per item, in the attribute `flow:op`:

```
add     no guid (it does not exist yet), attributes describe it, transform says where it goes
set     names an item by its guid; an attribute present is written, absent is left alone,
        and an EMPTY value clears it
remove  names an item by its guid
```

### The reserved namespace

`flow:` is reserved. An applier skips **the whole namespace**, not the names it happens to know, so
an author can record something for its own later use without the applier being taught what it means
and without it being mistaken for a parameter of the thing being changed.

- `flow:op` — the verb above
- `flow:source` — where this change came from, in the RECIPE's own terms: a stable key, the source
  file's id plus the thing's own id there
- `flow:print` — a fingerprint of what the change asks for; the same print next time means nothing
  to write

`flow:source` is not a link between elements. Nothing is written into the source, and no element
of the target carries it. The plugin keeps it in the target model's record of what that recipe made
(`revitflow_recipes.json`), which is the recipe's own bookkeeping and nobody else's.

**Every other attribute name belongs to the target application.** `Family`, `Type`, `CategoryId`,
`Level`, `Position` are what Revit calls its own fields in what Revit publishes. A recipe copies
them without needing to know what any of them mean; the plugin receiving them is the only thing that
does. Anything not in the receiving plugin's list of structural fields is treated as a parameter of
the element, which is what keeps the change vocabulary and the export vocabulary the same thing
rather than two things that have to be kept in step.

### What the plugin keeps

When it has applied a run, the plugin records in `revitflow_recipes.json`, for that recipe in that
model, which source key became which native id and with which print — the i-th result is what the
i-th change produced. A `remove` forgets the element it took out. On the next run that record goes
back to the recipe as `made` (source key → `{ id, print }`), filtered to what still exists in the
model, and is how an apply writes only what changed in the source.

The applier runs its verbs in passes — adds first, so a `set` can address something the same run
just made — but each change records its own result, so the pass order never reaches the answer.

---

## 3. The history


`revitflow_history.json`, a visible file.

```json
{
  "model": "<stable model guid>",
  "commits": [{
    "guid": "36095fba-1931-4ae2-963a-fed88f26b9b2",
    "parents": ["<guid>", "<guid>"],
    "version": 19,
    "message": "Moved the grid, everything follows",
    "author": "anton",
    "source": "revit",
    "timestamp": "2026-07-31T12:00:00.000Z",
    "changes": [{ "type": "create", "uniqueId": "..." }],
    "counts": { "added": 1, "modified": 0, "removed": 0 },
    "deltaId": "<hidden file id of this commit's delta .frag>",
    "userId": "<platform user id>",
    "full": false,
    "kind": "recipe",
    "origin": {
      "recipe": "ifc-to-revit",
      "title": "IFC to Revit: 6 level(s), 47 wall(s)…",
      "source": { "folderId": "<id>", "fileId": "<id>", "name": "racbasicsampleproject.ifc", "version": "v1" }
    }
  }]
}
```

Rules, restated here because they are the part an implementer gets wrong:

- **`guid` is identity.** Minted by whoever writes the commit, never reused, meaningful outside the
  file it lives in.
- **`parents` is the structure.** Absent on a root. First entry is the line this commit continues;
  more than one means a merge. Order by walking it, breaking ties on `timestamp`.
- **`version` is data, never a name, and nothing may sort by it.** It is where the commit landed in
  the CDE. An application with no such number omits it entirely.
- **`message` is the author's own words, and is optional.** Free text, never parsed, absent when
  nobody said anything. Take it from wherever the application already asks: Revit's Synchronize
  with Central dialog has had a Comment box forever, so the add-in passes that through rather than
  generating a sentence about element counts, which `changes` already says better.
- **`full`** means this commit re-exported the whole model, so the visible `.frag` shows the model
  as of here. Otherwise the commit ships only its delta, in a hidden child named by `deltaId`.
- **`kind`** says what sort of step it was when it was not a plain sync: `upload` (a file brought
  to the platform) or `recipe` (a sync whose changes include a recipe applied in the native
  application). Absent means a sync.
- **`origin`** says, on a `recipe` commit, where the change came from: `{ recipe, recipeVersion?,
  title, source: { folderId, fileId, name, version } }` — the recipe, the version of a project
  recipe (absent for a built-in), what it wrote in a line, and the exact source document and
  version it read. When several recipes were applied since the previous commit, `origins` lists
  them all and the first is `origin`. The platform's history panel shows these commits with a recipe
  mark and their title.

---

## 4. Collaboration in Revit, as one worked example

None of this is required by the contract. It is what a file needs when its application works the way
Revit does, and it is here because it is the hardest case: read it as an example, not as the shape
your application must take.

### The native model


The `.rvt` central and its local are stored as content-addressed 64K blocks. A push walks the folder,
uploads only blocks nobody has seen, and writes the file-to-blocks map. Blocks are only ever added,
so every state the model has been in is still there, and each version's map is kept under its own
name so a past state can be rebuilt.

### Ownership


Revit already arbitrates ownership — against **that machine's copy of the central**. Since the
central here is a snapshot that syncs rather than a live shared file, two people on two machines can
both borrow the same wall and both succeed, and neither finds out until one syncs. So arbitration
has to happen where both machines can see it.

A claim is **state, not an event**: one file per client, holding the keys it currently holds.
Releasing rewrites or deletes it. Reads cost one download per live claim set, roughly per person
working, rather than one per edit anybody has ever made.

The race is arbitrated by **the earliest claim**, and the order comes from the file's own `_id` —
read from the listing, needing no download. Two clients that both find a key free and both write
will therefore agree, on re-reading, about which of them has it.

The two failure orders are opposite on purpose. Acquiring writes the corrected claim before deleting
the old one, so a crash between the two leaves you holding too much (released at the next sync).
Releasing deletes before writing, so a crash leaves you holding too little. Never the reverse: too
little is recoverable, too much locks a colleague out of an element nobody is editing.

### Turn-taking


One sync at a time, first come first served. A ticket **is** a hidden file, and leaving the queue
deletes it, so asking whose turn it is costs one listing and never grows.

It was not always. The first version was an append-only log of enqueue and dequeue documents, so
every reader downloaded every event ever written and paired them up. Measured on one dev document:
100 hidden files, refetched every 800ms while polling, which is where seven and a half seconds of a
sync went with nobody else in the queue. It grew with every sync anybody had ever done, forever.

A ticket older than 180 seconds is stepped over, so a client that dies mid-sync cannot hold the queue
for good.

---

## 5. Applying a recipe in your plugin, end to end

The recipe code is the platform's own, in `@thatopen/services`; a plugin hosts it rather than
reimplementing it. (The Revit add-in runs it in a hidden WebView2 page and applies the result in
C#.) The whole job, for the common case:

1. **Offer the recipes.** `client.recipes.catalog(projectId, { to: '<your app>' })` lists the
   built-ins and the project's own; `client.recipes.choices(name, projectId)` lists the documents
   it can read, each with its current version; the manifest's `settingsSchema` says what to ask.
   In Revit this is **That Open > Select recipe**.
2. **Run it.** `client.recipes.run(name, { projectId, target, input, settings, made, opId,
   recipeVersion, progress })`, with `made` read from your model's record of what that recipe made
   before. It answers `{ title, verb, payload, targets, ruleTallies }`, or throws `UpToDate`: say
   so ("Nothing imported") and stop.
3. **Apply the payload in ONE transaction** of your application, so one undo takes it all back.
   Refuse what you cannot build, with a reason; never approximate.
4. **Record what it made** (source key → native id and print) next to the model's history, and
   which recipe, version and source version this was.
5. **On the next sync, say where it came from**: the commit carries `kind: "recipe"` and `origin`
   (section 3).

That is all. No lock beyond what your application already takes for an edit, no queue, nobody else
to wait for. In Revit, steps 2 to 4 are **That Open > Apply recipe**.

---

## 6. Building a collaboration layer for a new application

The contract is section 3, and nothing else. What you decide for yourself:

- **What a commit contains.** Whatever your application can honestly report as changed.
- **Whether ownership exists at all.** Revit's model is claimed-before-editing arbitrated centrally.
  For an application where teams already divide work by file, no locking may be the right answer.
- **How concurrent edits reconcile.** Revit has a merge engine; most applications do not, and this
  is the expensive half. A central that is *reconstructed* from per-object deltas rather than
  overwritten is buildable on stable object ids and per-commit deltas, but that is rebuilding
  worksharing rather than configuring it.
- **Whether history branches.** The format allows it. Whether your application does is yours to
  decide, and Revit's cannot: its central is a single line.

The one thing not up for grabs: **order comes from the graph, never from a counter.** Write commits
with guids and parents, and every reader on the platform can already show your history alongside
everybody else's.
