# That Open Flow

A modular system for **collaboration, interoperability and automation** on top of That Open
Platform.

> Work the way you want, not the way a format tells you to.

Everything below follows from taking that literally. Most systems in this space achieve
interoperability by agreeing on one data model and asking everybody to move into it. This one does
the opposite: applications stay sovereign over their own data, and what is shared is a way of
recording change.

---

## 1. Any file, and each one collaborates its own way

The platform holds **native files** — `.rvt`, `.3dm`, whatever an application actually saves.
Nothing is converted on the way in.

Each **file** has its own collaboration system. Note: a file, not a format. Two Rhino models in two
projects can be collaborated on in two different ways, by the same person, on the same day, because
what suits a five-person structural team does not suit somebody sketching alone.

There is exactly one rule:

> **Collaboration is based on a history, and every history follows the same contract.**

That is the whole of the shared surface. Everything above it is free.

Two consequences, and they are the point of the design:

1. **Applications with incompatible needs coexist.** Revit needs a very specific collaboration
   system, because Revit worksharing is a specific thing: a central file, element-level ownership,
   a merge engine. Rhino needs none of that. Neither has to pretend to be the other.
2. **A project chooses.** Ownership claimed up front, or nothing locked at all, or something in
   between. The history contract does not care which, and the platform reads all of them the same
   way.

### The contract

A history is a list of commits. Each commit says:

| Field | Meaning |
|---|---|
| `guid` | What the commit IS. Identity. Never reused. |
| `parents` | The commits it was built on. Absent on a root. First is the line it continues. |
| `author`, `timestamp` | Who and when. |
| `changes` | Which items changed, and how: `create`, `update`, `delete`. |
| `counts` | Derived totals, so a reader need not walk the changes to summarise. |
| `version` | Where it landed in the CDE, when there IS such a place. Data, never identity. |

Two rules about reading it, and they are what let an application unlike Revit take part at all:

- **Order comes from the graph, not from a number.** Follow `parents`; break ties by timestamp.
  Asking "which came first" of an integer forces every application to invent a sequence, and only
  something like Revit's central — which serialises everybody through one line — can honestly
  produce one.
- **`version` is never a name.** It is where the commit was stored, not what it is. An application
  with no version counter simply omits it.

`parents` is a **list** because a history that can only be a line is a different thing from a graph.
A fork is two commits naming the same parent; a merge is one commit naming two. Revit will never
write more than one — its central is a single line and it merges inside itself — and the list exists
precisely for the applications that are not Revit.

---

## 2. What a history buys

**Traceability.** Who changed what, when. The history of a single element, across every commit that
touched it.

**Work is not lost.** The platform stores the native files as content-addressed blocks, and blocks
are only ever added. Every state the model has ever been in is still there, and a commit's map of
which blocks made up which file is stored with it, so a past state can be rebuilt.

**One timeline, or many.** Each file has its own history. The platform can show them together,
filtered and searched as one.

---

## 3. Native data, out in the open

Every application on the platform publishes its data openly: readable **without opening the
proprietary application**.

This is what makes everything in the next section possible. A translator, a script or a model runs
with Revit closed and Rhino closed; if the only way to know what is in a model were to open the
application that wrote it, none of it could exist.

The constraint that follows is worth stating, because it decides where fixes go: **anything reading
a model cannot ask its application a question.** Every fact it needs has to be in what that model
already published. When something turns out to be missing, the fix goes in the EXPORT, never in a
back channel to a running application.

---

## 4. Recipes

The other half is bringing things INTO a native application — as a **recipe**.

A recipe reads something of the project (an IFC, a Rhino layer, a `.frag`, anything the platform
holds) and returns the changes that make the target model match it: adds, edits and removals, in
the target application's own vocabulary. Three things define it:

**It is chosen and applied from inside the application that receives it.** In Revit: **That Open >
Select recipe** (the recipe, its source document from a list, its settings) and **That Open > Apply
recipe**. The plugin runs the recipe and writes its changes at once, in **one** Revit transaction:
Ctrl+Z undoes it whole, and closing without saving or going back in the history reverts it like any
other edit. Nothing is queued, uploaded or waiting for anybody.

**It remembers what it made.** Applying again writes only what changed in the source since the last
apply; with no change it says "Nothing imported". What each recipe made is kept in the model's own
That Open data on the platform (`revitflow_recipes.json`, next to its history).

**It addresses published data.** Its changes are a patch over the fields an application already
publishes, in the terms that application already uses.

### Why the person in the application applies it

Nobody writes into somebody else's model, and that is settled by where the recipe runs rather than
by any request travelling between people. The person who applies a
recipe is the person working in that model, in that application, with its undo, its worksets and
its sync — so the change is theirs from the first moment, and an ordinary edit of their model.

When they sync, the commit says where the change came from: `kind: "recipe"` and an `origin` naming
the recipe, its version, a title, and the exact source document and version it read. The platform's
history panel shows such commits with a recipe mark and that title («IFC to Revit: 6 level(s), 47
wall(s)…», «from racbasicsampleproject.ifc v1»).

Built-in recipes ship in `@thatopen/services` (`ifc-to-revit`, `frag-to-revit`, `rhino-to-revit`)
and are always available; a project can add its own, usually written by a person with an AI
starting from a built-in:
[Writing a recipe](https://raw.githubusercontent.com/ThatOpen/platform_services/main/docs/recipes-guide.md).

---

## 5. Two layers, in this order

```
        interoperability      recipes, applied in the native tool by whoever works there
   ─────────────────────────
         collaboration        who owns what, and what counts as a commit
```

**Collaboration comes first.** It answers two questions for a file: who may change what, and what a
change becomes once made.

**Interoperability sits on top.** A recipe's changes are applied by somebody in the native tool,
and that is an ordinary change: it takes the same locks, respects the same ownership, and produces a
normal commit — one marked as a recipe's.

That ordering is why interoperability needed almost no new machinery. It borrows the layer below
rather than building a parallel one.

> **Writing a recipe requires nothing but the platform. Applying one requires being a participant
> in that file's collaboration layer.**

| Direction | What a tool must implement |
|---|---|
| Something → tool (bring it in) | Run a recipe and apply the changes it returns. Nothing else. |
| Tool → everyone (be a source) | Publish its own data. Nothing else. |
| Model → tool (see the result) | Read a `.frag`. Nothing else. |
| Tool → tool (edit what it receives) | A full collaboration layer for that tool. |

Most integrations are the first three rows, and none raises a single question about ownership or
merging.

What a recipe can actually ask for is a separate and longer question, and an open one: host
resolution, shared coordinates, type versus instance parameters, orientation, free NURBS and breps,
family authoring. The rule for all of it is the part that is settled: a change that cannot be
honoured is **refused with a reason, never approximated**. A plugin author meeting one of these will
get a refusal naming it rather than a silently wrong element.

---

## 6. A plugin knows only its own application

> **No plugin ever mentions another application. It publishes its own data raw, and reads a
> `.frag`. Everything that translates between two applications lives in the platform.**

The Revit plugin has no idea Rhino exists: it receives verbs over the Revit data it already
publishes. The Rhino plugin must have no idea Revit exists either — it exports what Rhino has, as
Rhino has it, and stops. The thing that reads a Rhino model and says what it means in a Revit one is
a third thing — a recipe — and it lives in the platform: built into `@thatopen/services`, or saved
in the project. The Revit plugin runs it and applies what it returns, without knowing what it read.

The reason is arithmetic. Put translation in the plugins and every new tool has to learn about every
existing one: N tools, N² translators, each needing an update when either end changes. Put it in the
platform and a new tool implements two things that mention nobody — "publish my data" and "read a
`.frag`" — while translators are written per pair, by whoever needs that pair, without touching
either plugin.

So the shape of the whole system is: **plugins export and import their own application's data,
deterministically, and nothing else. The platform is where the glue lives.**

### Which is why the change format knows nothing either

What a recipe returns is a set of changes over data an application already publishes, so it says
three things and no more: **what kind of change, which item, which fields.**

```
add     no id yet, attributes describe it, transform says where it goes
set     names an item by its published id, writes the attributes given
remove  names an item by its published id
```

The field names are not ours. `Family`, `Type`, `CategoryId` are what Revit calls its own fields in
what Revit publishes, and a translator copies them without needing to know what any of them mean.
The plugin that receives them is the only thing that does.

This was got wrong once and is easy to get wrong again. The first version defined `flow:family`,
`flow:type`, `flow:categoryId` and friends in the shared protocol, as though a family and a type
were concepts of the interoperability layer. They are not, and putting them there taught the
protocol about one application, which is what this whole section exists to prevent.

What IS reserved is the `flow:` **namespace**, and an applier skips all of it rather than the names
it happens to know — so an author can record something for its own later use without the applier
being taught what it means, and without it being mistaken for a parameter of the thing being
changed. Today that namespace holds `flow:op` (the verb), `flow:source` (where the change came
from, in the recipe's own terms) and `flow:print` (a fingerprint of what was asked for, so the next
apply can tell an unchanged source from a changed one).

Identity is the item's guid and placement is the item's transform, both of which the `.frag` already
carries. Nothing addresses anything by position: an item is named by its id or not at all. That is
not a convention to be careful about, it is the only thing the format can express, which is why a
re-exported model can never make a change point somewhere else.

---

## 7. No element is ever tied to another element

The rule most likely to be undone by accident:

> **A recipe's changes are generic changes over a model. They never establish a shared identity
> between an element in one application and an element in another — not 1:1, not N:N, not at all.**

Each application owns its ids and nothing else knows what they mean. A Revit `UniqueId` identifies
something in that Revit model. A Rhino object GUID identifies something in that `.3dm`. Neither is
ever translated into the other, and nothing is ever written into the source.

What IS recorded is much weaker, deliberately: **a recipe's own memory of what it made in one
model.** Every `add` carries a `source` key in the recipe's own terms (the source file's id plus
the thing's own id there), and when the plugin applies the changes it keeps, for that recipe in
that model, which key became which native id, with the fingerprint (`flow:print`) of what was asked
for. It lives in the target model's own That Open data (`revitflow_recipes.json`, next to its
history), and the plugin hands it back to the recipe on the next run as `made`, filtered to what
still exists in the model.

That is the whole mechanism by which a recipe knows which of the things it created is which. It is
the recipe's bookkeeping in the model it writes, not a property of either element.

### Why this is enough

Because it answers one question only — "what did THIS recipe make HERE?" — and that is all a
re-apply needs: an unchanged print writes nothing, a changed one is made again, a source key that is
gone is removed. Only what the recipe made is ever removed, never anything a person drew.

So a round trip works — create an object in Rhino, apply the recipe in Revit, then modify the same
object in Rhino and apply again — without either model holding a link to the other. Another recipe
reading the same source keeps its own record, and knows nothing of this one's.

### Why it matters

This is where IFC, Speckle and every "BIM interoperability" format before them got into trouble.
They maintain a canonical cross-application object identity: an entity that claims to be the same
thing in two tools at once. Something then has to keep it alive forever — synchronise it, reconcile
it when it drifts, decide what it means when one tool splits that object in two or merges it with
another. The identity becomes a permanent maintenance surface, and it is the part that rots.

We do not have that entity, so there is nothing to keep alive.

**If a future change starts to look like a cross-application id, a `sourceId` field on an element,
a mapping shared between recipes or models, or a "link" between two models: that is this rule being
undone.** The question to ask is which application's problem it is really solving, and whether it
can live in that application instead — the way a recipe's memory lives in the one model it writes.

---

## 8. Revit: lean on the native system, do not rebuild it

Revit already has worksharing, and it is good. The temptation is to build a collaboration layer on
top of it, because our central is not a live shared file and the native mechanisms therefore do not
reach across machines. The decision is the opposite: **be an efficient copier of a few files, and
let Revit do the collaborating.** A very fast file transport can be made not to break. A layer of
our own logic on top of a partial API breaks in the cases nobody thought of.

What made that decision possible is a set of measurements rather than an opinion. Revit stores
worksharing ownership in small files NEXT TO the central, never inside the `.rvt`:

| what happens | what Revit writes to the central, immediately |
|---|---|
| somebody takes a workset | `worksetperms.dat` |
| somebody borrows elements by editing them | `editingperms.dat`, `editingdeltas.dat` |
| somebody edits what they already hold | nothing |
| somebody saves their local | nothing |

The `.rvt` is never touched by any of it. So **replicating ownership does not move the model**, which
was the objection that would otherwise have killed the idea: nobody's geometry changes under their
feet.

Three more facts decide the design:

- **Revit re-reads those files.** Overwrite them behind a running Revit and it reports the new
  ownership within two to three seconds, with no reload and nothing asked of it. It polls the
  central every five to eight seconds on its own; the read locks are visible in the worksharing log.
- **A borrow is a two-byte write.** `editingperms.dat` is a table of 32-byte records, one per
  element, holding a two-byte owner field: `ffff` for free, otherwise an index into `users.dat`.
  Borrowing 208 elements changed exactly 208 two-byte cells and nothing else — no header, no
  counter, no checksum. Which is what makes a three-way merge of two clients' files correct rather
  than reckless: different elements are different cells, and the only cells both sides can touch are
  the ones where they genuinely both claimed the same element.
- **The whole ownership state is 35 KB compressed**, so it needs no clever transport. It also must
  not go through the block store, which would mint a model version per borrow.

So the shape is: a file watcher publishes ownership when it changes, everyone else pulls and merges
it, and Revit believes what it reads. The platform's own registry stays as the ARBITER for the few
seconds before a replicated file arrives, because that race cannot be closed by transport alone.

**What still has to be our own, and why.** Revit publishes ownership; it does not publish INTENT.
There is no event for taking a workset, none for borrowing an element, and no API to relinquish on
somebody else's behalf (`RelinquishOwnership` takes a document and no user; `Application.Username`
is read-only). So a claim cannot be vetoed before it happens, only observed after — which is why the
platform registry exists, why arbitration is after the fact, and why a conflict is resolved by
telling somebody rather than by preventing them.

**What we must not let happen, and how it is now handled.** A native Sync With Central writes to
that machine's copy of the central and, left alone, tells the platform nothing. If somebody else
publishes first, the next pull overwrites that copy and the work is gone while their local still
believes it was published.

That is why the add-in sits on both of Revit's sync events rather than beside them with a button of
its own. `DocumentSynchronizingWithCentral` fires before Revit touches anything: it takes the turn
in the team queue and brings the central up to date in place, so Revit's own merge runs against the
team's current file. It is cancellable, and every refusal uses it — elements held by somebody else,
a pull the guardrail refused, a queue the person gave up on — so a sync that cannot be published
safely is stopped before Revit writes rather than left half done.
`DocumentSynchronizedWithCentral` then publishes what was written, and nothing else: no second
merge, no second SWC.

Measured while building it: Revit reports the sync finished while it still holds a file in the
central's worksharing folder, so the publish retries with a growing wait. And replacing the central
files from inside the pre-event works with the model open — verified with the central rolled back a
version underneath a live session: 30 files rebuilt in the event, Revit's merge on top of them.

The consequence is that the add-in has no sync button, no take button and no release button. Revit's
own worksharing UI is the interface, and ownership replication is what makes it true for everybody.

## 9. Rhino: deliberately unanswered

revit-flow works because Revit already had worksharing. flow arbitrates on top of it; it did not
have to invent it.

Rhino has none of that. A `.3dm` is one file, with no central, no per-object checkout, and no merge.
So "collaboration in Rhino" is not a thing that exists and gets wired up — it is a thing that would
have to be designed and written. Which is exactly what section 1 says is allowed: the contract is
the history, and how a file is collaborated on underneath is open.

**We are not answering it yet, on purpose.** Bringing a Rhino model into Revit needs no Rhino
collaboration layer at all — Rhino publishes, and the Revit user applies `rhino-to-revit` — and Rhino displaying a Revit model needs only a `.frag` reader. The
question appears when several people want to edit one Rhino model at once, and until somebody
actually wants that, designing it would be guessing.

Two notes from thinking it through, so the thinking is not repeated:

- **Ownership granularity is the easy half, and layers are the natural unit.** A Rhino layer is what
  a workset is in Revit: it is how teams already divide work, every object carries one, and the
  exporter already records it. The lock registry needs no change beyond a different key prefix.
- **Merging is the hard half, and it is the real cost.** Revit reconciles concurrent element edits
  itself. Rhino will not. A central would have to be *reconstructed* by applying per-object deltas
  rather than being a file somebody overwrites — buildable on what already exists (stable object
  GUIDs, regenerable definitions, per-commit deltas), but that is rebuilding worksharing, not
  configuring it.

Worth checking before any of it: whether teams actually put several people on one `.3dm` today, or
divide the work by file. If it is the latter, the merge may never be needed.

---

## 10. Formats

`.frag` is the transport for both layers: models, per-commit deltas, and the changes a recipe
returns (a geometry-less `.frag`, envelope `revitflow/op@2`). It
carries stable per-item global ids (Revit `UniqueId`, Rhino object GUID) in its `guids` vector,
which is what lets anything address an element it did not create.

`.3dm` is readable and writable without a Rhino licence, through McNeel's open-source **openNURBS**
and the **rhino3dm** bindings. That covers the document and its geometry definitions but not the
Rhino kernel, so a converter can run server-side while real modelling operations still need Rhino.

The concrete wire formats — where each file lives on the platform, what the change envelope
contains, how the sync queue and the ownership registry work — are in
[the plugin guide](https://raw.githubusercontent.com/ThatOpen/platform_services/main/docs/flow-plugin-guide.md), which is what to read if you are writing a plugin.
