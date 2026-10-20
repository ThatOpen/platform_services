# Rhino → Revit, start to finish

You are an assistant. Somebody is modelling in Rhino for a project whose model lives in Revit, and
they want what they draw to become real Revit elements. This is the whole path, in the order it
happens, with the numbers from a run that actually worked.

It assumes the collaboration side is already set up — a central published, a project on the
platform. If it is not, that is
**[the Revit collaboration quick start](https://raw.githubusercontent.com/ThatOpen/platform_services/main/docs/revit-collab-quickstart.md)**, and it comes first.

## What is actually happening

Five steps, and it is worth saying them plainly before touching anything, because the shape is what
people get wrong:

1. Rhino **publishes** its model to the project as a `.frag`. That is all the plug-in does. It
   mentions Revit nowhere.
2. In Revit, the person whose model it is chooses the **`rhino-to-revit` recipe**: **That Open >
   Select recipe**, source: that Rhino model; settings: the Rhino layer and the Revit type.
3. **That Open > Update.** The recipe — the platform's code, in neither plug-in — reads the
   `.frag` and says what it means in Revit's vocabulary; the Revit add-in writes it in **one**
   transaction. Ctrl+Z undoes it whole.
4. They **sync**, and it becomes a commit like any other, marked as the recipe's, naming the Rhino
   model and the version it read.
5. Rhino changes, publishes again, and **Update again** writes only the difference: new
   objects become new instances, moved ones move theirs, deleted ones have theirs removed.

> **Known gap, today.** Revit's Select recipe can only offer settings that are booleans or Revit
> family types. `rhino-to-revit` also asks for a **Rhino layer, read from the source**, so Select
> recipe does not offer it yet. Steps 2 and 3 are how this path works once the dialog can show a
> list read from the source; until then, say so plainly rather than improvising another route.

**No element is ever tied to an element.** The only thing linking a Rhino object to a Revit column
is the recipe's own record, in the Revit model's That Open data, of what it made from which object.
Nothing is written into the Rhino model, and no Revit element carries a link. Anybody proposing to
store a link between the two models is proposing the thing this architecture exists to avoid.

## Before anything

Log in: **[Logging in to That Open Platform](https://raw.githubusercontent.com/ThatOpen/platform_services/main/docs/platform-token.md)**. The Rhino plug-in reads
`~/.thatopen/config.json`, the same file the CLI writes. It deliberately does not read the Revit
add-in's session — same machine, but one plug-in reading another's private state is coupling nobody
can undo later.

Install the plug-in. **Rhino has to be closed**; the installer holds its files.

```bash
thatopen rhino install
```

## Driving Rhino without a keyboard

The plug-in runs a local HTTP server, exactly like the Revit add-in. This is what lets you do the
whole job while the user watches, instead of dictating commands for them to type.

The port and the token are written to `%APPDATA%\ThatOpen\rhino-addin.json`:

```json
{ "port": 5620, "token": "…", "pid": 5436 }
```

Every request is a POST with a JSON body and the header `X-RhinoFlow-Token`. **Never print the
token**, and never write it into a script you are about to show.

There is also a `script` endpoint that runs Rhino's own command line. Use it for drawing, which is
what it is good at. **Never use it for a command that asks a question** — the import command wants
the project id the first time it runs, and a scripted command has nobody to answer, so Rhino sits
there with no error and no progress. That is why `import-model` and `publish` take their answers as
parameters instead of being reachable through `script`.

## 1. Bring the team's model into Rhino

```
POST /import-model   { "project": "<projectId>", "document": "<doc>" }
```

```json
{ "ok": true, "model": "rstadvancedsampleproject.frag",
  "layer": "ThatOpen reference — rstadvancedsampleproject",
  "added": 907, "skipped": 0 }
```

It lands on a **locked layer**, with no properties, and it cannot be sent back. Say why if the user
asks, because it looks like a limitation and it is a decision: a `.frag` is a tessellation — what a
Revit wall LOOKS like, not what it IS — so editing one in Rhino and returning it could only produce
a worse version of a model Revit already owns. The lock stops somebody editing a mesh that is really
somebody else's wall and then publishing that as though it were theirs.

If the folder holds more than one model the call comes back with `available` listing them and no
import. Ask which; do not pick the first. Somebody spending an afternoon modelling against the wrong
building is a bad afternoon.

## 2. Find out where things are, before you place anything

Do not invent coordinates. Ask the model:

```
POST /objects   { "limit": 3000 }
```

Each object comes back with `min`, `max`, `center`, its layer, and the user strings the import
stamped on it — including `ThatOpen:Category`, which is Revit's own category name.

**Group before you conclude.** Reading the first few rows of that list is not measuring, and it will
mislead you. Measured on the sample project: the first four columns in the list were 750×750, based
at Z −2500, 2500 tall. They were the basement — four out of seventy. The building's actual column is
**450×450, based at Z 0, 3500 tall**, which is 63 of the 70. Taking the section from the first rows
produced columns that were too fat and buried, twice.

The same query gives you the grid. Sort each row of columns by X, look at the gaps, and the midpoint
of a wide one is a defensible place for a new column — it sits under the beam spanning that bay.

## 3. Place the columns

There is no "make me a column" endpoint, and there should not be. This plug-in moves data and
decides nothing about what any of it means; the moment it grows a command called `columns` it has an
opinion about buildings, and that opinion belongs in the recipe. Rhino's own commands do the job:

```
POST /script   { "script": "_-Layer _New \"flow:columns\" _Current \"flow:columns\" _Enter" }
POST /script   { "script": "_-Point -5544,-1413,0" }
POST /script   { "script": "_-Box -5769,-1638,0 -5319,-1188,0 3500" }
```

Verified: that produces a point at the given coordinate and a 450×450×3500 extrusion centred on it.
`_-Box` takes two opposite corners of the base and then a height, so a 450 square centred on
`(x, y)` runs from `(x−225, y−225)` to `(x+225, y+225)`.

**Place BOTH, and understand why.** `rhino-to-revit` places one Revit instance at each object of the
chosen layer that has a `Position` — a point is exactly that; anything else on the layer with a `Position` becomes an instance too, so keep the layer for the points. But a point
is invisible at building scale, so a Rhino file of "the new columns" looks like an empty file —
impossible to work with and impossible to show anybody. So the point is the data, and the box is the
picture. Put them on sibling layers (`flow:columns` and `flow:columns (view)`) so the recipe's layer
holds nothing but points.

Nothing downstream reads the box. If somebody later writes a recipe that reads solids, the point
layer goes away and everything else still works.

**Sizes and coordinates are in the DOCUMENT's units.** `POST /status` reports them. The sample
project is in millimetres, where a column of `0.45` is an invisible splinter. Converting from metres
behind the user's back would put everything a thousand times too far away.

### The whole thing, worked

Four columns down one bay of the sample project, at the midpoints of a 7315 mm gap that repeats row
after row. This is exactly what was run:

```
_-Layer _New "flow:columns" _Enter
_-Layer _New "flow:columns (view)" _Enter

_-Layer _Current "flow:columns" _Enter
_-Point -5544,-5769,0
_-Point -5544,-1413,0
_-Point -5544,530,0
_-Point -5544,6829,0

_-Layer _Current "flow:columns (view)" _Enter
_-Box -5769,-5994,0 -5319,-5544,0 3500
_-Box -5769,-1638,0 -5319,-1188,0 3500
_-Box -5769,305,0   -5319,755,0   3500
_-Box -5769,6604,0  -5319,7054,0  3500
```

One `POST /script` per line, or several lines in one call. Check `objectsAfter` in the reply: it is
the only thing that tells a command that did nothing from one that worked.

### And then anything else

Nothing above is about columns. It is: make a layer, put geometry on it, and let a recipe say what
it means. The same shape covers whatever the user actually wants —

| want | command |
| --- | --- |
| a point | `_-Point x,y,z` |
| a box | `_-Box x1,y1,z1 x2,y2,z2 <height>` |
| a line | `_-Line x1,y1,z1 x2,y2,z2` |
| a circle | `_-Circle x,y,z <radius>` |
| a layer, made current | `_-Layer _New "name" _Current "name" _Enter` |

The leading `-` is what matters: it is Rhino's command-line form, which takes its arguments inline
instead of opening a dialog. Without it the command puts a window on screen and waits for a person,
and there is no person.

Two rules carry over to anything you draw here. The geometry the recipe reads goes on **its own
layer, holding nothing else**, because the recipe selects by layer and cannot tell your helper
geometry from your data. And the coordinates are always in the **document's units**.

## 4. Publish

```
POST /publish   { "project": "<projectId>", "document": "<doc>", "name": "rhino-columns.frag" }
```

```json
{ "ok": true, "file": "rhino-columns.frag", "items": 8, "withGeometry": 4, "bytes": 10529 }
```

**Check that number.** Eight items is four points and four boxes. The first version of this uploaded
915 items and 3.4 MB, because the 907 reference meshes went back up with everything else — a
tessellated copy of the Revit model, republished under the Rhino model's name. Objects stamped
`ThatOpen:Source` are excluded now, but if you ever see the item count in the hundreds, that is what
happened.

Points count as items without geometry. That is correct: they are the data the recipe reads, not
something to draw.

Once published, the Rhino model is a document of the project, and that is what Revit's Select recipe
lists as a source. Publishing again makes a new version of it; the next Apply reads that one.

## 5. The recipe

This is the part that is **not** in either plug-in, and should not be. It reads the published
`.frag`, decides what it means in Revit, and returns the changes; the Revit add-in applies them.

The one that exists is the built-in **`rhino-to-revit`** (`src/core/builtin-recipes/rhino-to-revit.ts`
in `@thatopen/services`): each placed object of a chosen Rhino layer becomes an instance of a chosen
Revit family type. It is written to be read and then rewritten as a project recipe — the next person
wants walls from curves, or louvres from blocks — and
**[Writing a recipe](https://raw.githubusercontent.com/ThatOpen/platform_services/main/docs/recipes-guide.md)**
is how. Four steps survive any rewrite:

1. read the source model's own data, in the source's own units
2. ask what this recipe already made in this model (`made`, which the add-in hands it)
3. decide: new ones are added, known ones updated, vanished ones removed
4. return the changes, or `UpToDate` when there are none

It persists nothing of its own. What it made is kept by the Revit add-in in the model's That Open
data, so Apply behaves the same from any machine with that model.

The byte contract is **[Writing a flow plugin](https://raw.githubusercontent.com/ThatOpen/platform_services/main/docs/flow-plugin-guide.md)**, and the reasoning
behind the shape is **[the architecture notes](https://raw.githubusercontent.com/ThatOpen/platform_services/main/docs/flow-architecture.md)**.

Everything below is what a run of this cost to find out. None of it is guessable, and all of it
fails quietly when it is wrong.

### What Rhino actually publishes

One item per Rhino object, category `IFCBUILDINGELEMENTPROXY`, carrying these attributes:

| attribute | example | note |
| --- | --- | --- |
| `Layer` | `flow:columns` | |
| `Type` | `Point` | `Point`, `Extrusion`, `Curve`, … |
| `Name` | | the object's name, usually empty |
| `Position` | `"-5544.4,-1413,0"` | a **string**, in the document's units |
| `Rhino:Definition` | | block definition, when there is one |

**The layers are published as items too**, category `IFCBUILDINGSTOREY`, geometry-less, carrying a
single `Name` attribute holding the layer's full path. They have no `Layer` and no `Position`. So a
recipe that matches the layer name loosely, or that assumes every item it sees has a position,
reads a layer as a column. Test both fields, positively:

```ts
if (attrs.Layer !== "flow:columns") continue;
if (attrs.Type !== "Point") continue;   // and this is what separates points from everything else on it
```

`Type` is Rhino's own geometry class name: `Point` for a point, `Extrusion` for a `_-Box`, `Curve`
for a line. It is the only thing distinguishing the data from the helper geometry if somebody ends up
putting both on one layer.

Reading it in a recipe, which imports nothing: the tools are on `context.kit`.

```js
const { picked, contents } = await context.kit.readPickedFrag(context, context.input);
// contents.metadata, and contents.items: [{ localId, guid, category, attrs }]
```

`readPickedFrag` downloads the source document at the version picked in Revit and reads it;
`kit.readFrag(bytes)` does the same for any `.frag` bytes you already have.

### Units, and why the envelope has no units field

**Print both files' metadata BEFORE you write a line of a recipe.** This is an ordering
instruction, not advice. The whole conversion rests on what those two files declare, and it takes
thirty seconds to find out:

```ts
import { readFrag } from '@thatopen/services';
for (const id of [rhinoFileId, revitFileId]) {
  const res = await client.downloadFile(id);
  const { metadata } = await readFrag(new Uint8Array(await res.arrayBuffer()));
  console.log(id, metadata);
}
```

Measured on a live demo, 2026-08-05: a converter was written the other way round, four hundred lines
first and the check afterwards, and the target's metadata turned out to be `{}`. Everything above the
units gate was correct and none of it could run. Read the two files, then write the recipe around
what is actually in them.

A recipe's changes are in the terms of **what the target published**. When Revit's export declares
anything, it says so itself:

```json
"data": { "units": "ft", "axes": "z-up", "note": "Revit's own terms, untouched. Operations are written in these." }
```

Rhino publishes its document units in the same place, `model.metadata()`, under `data.units`. On the
sample project that is `Millimeters`. So the recipe divides by **304.8**, and it is the recipe's
job precisely because it is the only piece that knows both sides. `rhino-to-revit` reads
`data.units` and **refuses** a Rhino model that does not declare one it knows, rather than guess.

**When the target declares nothing.** Models published by add-in versions before 1.2.27 carry empty
metadata on their first commit, so `{}` is a state you will meet on any project created before then.
Revit's internal length unit is always decimal feet, so the factor is not actually in doubt; what is
missing is the file saying so. Take feet, say out loud that you are taking it, and then **prove it
from the data** rather than leaving it as an assumption:

- Read one existing column's `Position` out of the target, and compare it against the same column
  measured in the source. On the sample project: `-30.19028688187479` ft times 304.8 is **-9202 mm**,
  which is exactly the bay edge measured in Rhino.
- Keep a sanity check on every converted point: refuse anything landing more than about ten metres
  from an existing element of the same category. That is what catches a factor-of-1000 error, and it
  works whether or not the file declared anything.

**What you must never do is guess silently.** A wrong factor puts the columns a thousand times too
far away, and nothing about the result says why. Refusing is a worse demo and a better outcome.

### Building the changes

A recipe builds what it returns with `kit.OperationBuilder` — `add(attrs, { position, source })`,
`set(id, attrs, placement)`, `remove(id)`, then `build(opId)` — which writes the geometry-less
`.frag` and its envelope. Nobody assembles those bytes by hand any more. The rules that make a
re-apply write only the difference — a stable `source` key on every add (the Rhino object's guid),
removing only what the recipe made — are in
**[Writing a recipe](https://raw.githubusercontent.com/ThatOpen/platform_services/main/docs/recipes-guide.md)**.

### Do not learn the format from files on the machine

The tempting shortcut is the `.frag` files lying around under `%APPDATA%\ThatOpen` and in
`flow-reconcile`. They are somebody's earlier session. One of them held four points on a layer
called `Columnas`, left over from an older run, and reading it as current would have built a
converter against a layer name nobody was using any more.

The tables above are here so nobody has to do that. If you still want to see real bytes, publish
something small and read it back with `readFrag`, or run the recipe without Revit and read the
changes it would write with `describeChanges` (section 5 of the recipes guide).

## 6. Apply it in Revit

In Revit, with the model open:

1. **That Open > Select recipe.** Recipe: **Rhino to Revit**. Source: the Rhino model published in
   step 4, from the list of the project's documents. Settings: the **Rhino layer** (`flow:columns`)
   and the **Revit type** every point becomes.
2. **That Open > Update.** The recipe runs inside the add-in and the instances are written at
   once, in **one** Revit transaction: Ctrl+Z undoes it whole.

**This is the known gap from the top of this guide.** Select recipe can only offer settings that are
booleans or Revit family types, and `rhino-to-revit`'s layer is a list read from the source, so the
dialog does not offer this recipe yet. Say so to the user if they reach this step; do not work
around it by writing into the model some other way.

Applying again after Rhino publishes a new version writes only the difference; with no change it
says "Nothing imported". The change is in their local only. They still sync.

## 7. Sync, and look at it

Revit's own Synchronize with Central. The add-in rides it: the work reaches the team and the commit
lands in the history, with the new columns in it, viewable in the app like any other change. The
history panel marks it as a recipe's commit, with its title and the Rhino model and version it was
made from.

## Traps, all of them paid for

- **Rhino must be closed to install or update the plug-in.** It holds its own files, and a partial
  copy leaves a plug-in that is neither version.
- **`script` deadlocks on any command that asks a question.** Use the endpoints.
- **Units are the document's**, everywhere. Ask `POST /status` rather than assuming metres.
- **The recipe places points, not solids.** Somebody modelling a beautiful steel section will
  convert nothing at all, with no error to explain it.
- **A Rhino model that does not declare its units is refused.** That is the recipe refusing to
  guess a factor of 1000, not a failure.
- **Select recipe does not offer `rhino-to-revit` yet.** Its layer setting is read from the source,
  and the Revit dialog only shows booleans and family types today. A known gap; say so.
- **Do not publish what you imported.** If the item count is in the hundreds, reference geometry is
  going back up.
- **Group before concluding anything about the model.** The first rows of a listing are a sample,
  and on this project the sample was the exception twice running.
- **Stray `.frag` files on the machine are not the current format.** They are an earlier session.
- **Read the two files' metadata before writing a recipe, not after.** Everything the
  conversion rests on is declared in them, or is not, and finding out costs thirty seconds at the
  start and four hundred lines at the end.
- **Read these guides verbatim.** A fetch that summarises gives you the shape of the thing and none
  of the numbers, and every number here was paid for. Use the raw URL.
