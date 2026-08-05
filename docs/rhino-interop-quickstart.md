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

1. Rhino **publishes** its model to the platform as a `.frag`. That is all the plug-in does. It
   mentions Revit nowhere.
2. A **converter** — code in the user's own app, not in either plug-in — reads that `.frag` and
   decides what it means in Revit's vocabulary.
3. The converter **queues a proposal**. It changes nothing.
4. Somebody **in Revit accepts it**. Applying is a decision, and the decision belongs to the person
   whose model it is.
5. They **sync**, and it becomes a commit like any other.

**No element is ever tied to an element.** The only thing linking a Rhino object to a Revit column
is the converter's own note of what it asked for. Anybody proposing to store a link between the two
models is proposing the thing this architecture exists to avoid.

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
somebody else's wall and then proposing that as a change.

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
opinion about buildings, and that opinion belongs in the converter. Rhino's own commands do the job:

```
POST /script   { "script": "_-Layer _New \"flow:columns\" _Current \"flow:columns\" _Enter" }
POST /script   { "script": "_-Point -5544,-1413,0" }
POST /script   { "script": "_-Box -5769,-1638,0 -5319,-1188,0 3500" }
```

Verified: that produces a point at the given coordinate and a 450×450×3500 extrusion centred on it.
`_-Box` takes two opposite corners of the base and then a height, so a 450 square centred on
`(x, y)` runs from `(x−225, y−225)` to `(x+225, y+225)`.

**Place BOTH, and understand why.** The converter reads **points** on a layer and turns each into a
Revit column. It does not read solids. But a point is invisible at building scale, so a Rhino file of
"the new columns" looks like an empty file — impossible to work with and impossible to show anybody.
So the point is the data, and the box is the picture. Put them on sibling layers (`flow:columns` and
`flow:columns (view)`) so the converter's layer holds nothing but points.

Nothing downstream reads the box. If somebody later rewrites the converter to read solids, the point
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

Nothing above is about columns. It is: make a layer, put geometry on it, and let the converter say
what it means. The same shape covers whatever the user actually wants —

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

Two rules carry over to anything you draw here. The geometry the converter reads goes on **its own
layer, holding nothing else**, because the converter selects by layer and cannot tell your helper
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

Points count as items without geometry. That is correct: they are the data the converter reads, not
something to draw.

## 5. The converter

This is the part that is **not** in either plug-in, and should not be. It reads the published
`.frag`, decides what it means, and queues a proposal.

The worked example is `RhinoColumnsConverter`: points on a named layer become Revit columns of a
given family and type. It is written to be read and then rewritten — the next person wants walls
from curves, or louvres from blocks — but four steps survive any rewrite:

1. read the source model's own data, in the source's own units
2. ask what this converter already made, which comes from the queue and nowhere else
3. decide: new ones are added, known ones updated, vanished ones removed
4. queue one operation

It persists nothing of its own. Run it on another machine, or as a cloud component, and it behaves
identically, because everything it remembers it reads back from what it wrote to the platform.

The byte contract is **[Writing a flow plugin](https://raw.githubusercontent.com/ThatOpen/platform_services/main/docs/flow-plugin-guide.md)**, and the reasoning
behind the shape is **[the architecture notes](https://raw.githubusercontent.com/ThatOpen/platform_services/main/docs/flow-architecture.md)**.

## 6. Accept it in Revit

The Revit add-in's local API, `%APPDATA%\ThatOpen\revit-addin.json`, header `X-RevitFlow-Token`.

**List what is waiting:**
```
POST /ops
```

**Check one before offering it:**
```
POST /op-check   { "opId": "op-…" }
```

It answers with the version the proposal was authored against and the version the model is on now.
A proposal does not go stale — it says "move this BY two feet", not "put it at this coordinate" — but
show the user both numbers and let them decide.

**Apply it, once they have said yes:**
```
POST /apply-ops   { "opId": "op-…" }
```

Everything in the proposal happens in **one** Revit transaction: one undo, one entry in the history.
There is also a **Proposals** button on the ribbon, which shows the queue and lets a person accept or
refuse. Prefer it when there is somebody at the machine — accepting somebody else's change is a
decision, and a decision wants the thing being decided in front of you.

The change is in their local only. They still sync.

## 7. Sync, and look at it

Revit's own Synchronize with Central. The add-in rides it: the work reaches the team and the commit
lands in the history, with the new columns in it, viewable in the app like any other change.

## Traps, all of them paid for

- **Rhino must be closed to install or update the plug-in.** It holds its own files, and a partial
  copy leaves a plug-in that is neither version.
- **`script` deadlocks on any command that asks a question.** Use the endpoints.
- **Units are the document's**, everywhere. Ask `POST /status` rather than assuming metres.
- **The converter reads points, not solids.** Somebody modelling a beautiful steel section will
  convert nothing at all, with no error to explain it.
- **Do not publish what you imported.** If the item count is in the hundreds, reference geometry is
  going back up.
- **Group before concluding anything about the model.** The first rows of a listing are a sample,
  and on this project the sample was the exception twice running.
