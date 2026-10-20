# That Open Platform — Writing a recipe (guide for AI assistants)

You are an AI assistant. A user wants a **recipe**: something that brings data of their project into a
native application — "put a column at every point of this layer", "build the walls of this IFC as
Revit walls", "make a Revit room for every space of this spreadsheet". This guide is everything you
need to write one, test it without Revit, and save it in their project. Follow it in order.

> The user applies recipes from inside the application. In Revit: **That Open > Select recipe**
> (pick the recipe, its source and its settings) and **That Open > Apply recipe** (it runs and the
> changes land in ONE transaction; Ctrl+Z undoes it whole; applying again writes only what changed).
> When they publish, the model's history says which recipe, which version of it, and which version
> of the source made each change. You write the recipe; the plugin does all of that.

---

## 1. What a recipe is

A recipe is a **manifest** (what a person reads in Revit) and a **`run(context)` function** that
returns **changes**: a list of elements to add, set or remove in the target document, in that
application's own vocabulary (Revit categories, family and type names, levels by name, feet).

It does not touch Revit. It only says what Revit should end up with. The plugin applies the list.

Two kinds of recipe exist and both appear in the catalog:

- **Built-in** — shipped in `@thatopen/services` (`src/core/builtin-recipes/`). Always available, never
  replaced. **Read them before writing your own: they are your examples.**
  - `ifc-to-revit` / `frag-to-revit` (`records-to-revit.ts`): a whole building — levels, walls,
    curtain walls, floors, roofs, ceilings, stairs, columns — from the platform's records.
  - `rhino-to-revit` (`rhino-to-revit.ts`): one Revit instance per placed object of a Rhino layer.
- **Project recipes** — yours. Saved in the user's project, versioned there, each with a name of its
  own (a built-in's name is refused). Starting from a built-in is the normal way: copy what you need.

## 2. The manifest

```js
const manifest = {
  name: 'columns-from-points',            // lower case, digits, dashes; unique; not a built-in's
  title: 'Columns from points',           // what the Revit list shows
  description: 'One Revit column at every point of a Rhino layer.',   // one sentence
  to: 'revit',                            // the application it writes
  inputs: ['rhino-model'],                // what it reads (free words, for people)
  source: { kind: 'project-file', extensions: ['frag'] },   // what the "Source" list offers
  settingsSchema: {                       // the settings Revit asks for (JSON Schema)
    type: 'object',
    properties: {
      columnType: {
        type: 'object', title: 'Column type',
        // A Revit type of the open model, picked from a list: never typed.
        'x-existing': { of: 'family-type', from: 'target', where: { CategoryId: '-2001330' } },
      },
      onlyStructural: { type: 'boolean', title: 'Only structural points', default: true },
    },
  },
  rules: [                                // what it reads and what it writes, one row per rule
    { reads: 'Points on the layer', writes: 'A column of the chosen type at each' },
  ],
  doc: `## What it does\n\n…`,            // markdown: what "More…" shows in Revit. Write it.
};
```

- `source.kind: 'project-file'` with `extensions` lists the project's documents of those formats.
  The one picked arrives as `context.input`: `{ fileId, name, folderId, version }`.
- Settings Revit can show today: **booleans** (a checkbox) and **`x-existing` family types of the
  target** (a list of the open model's types, filtered by `CategoryId`). Anything else and the
  recipe is not offered in Revit — keep to those two.
- Write `doc` for a person: what it does, what it carries per thing, what it leaves out.

## 3. The code

The code is an **ES module** that exports `run`. It imports nothing: everything it needs is on
`context`, and the tools are on `context.kit`.

```js
export async function run(context) {
  const { kit, input, settings, made, progress } = context;
  // 1. Read the source.
  const { picked, contents } = await kit.readPickedFrag(context, input);
  // 2. What this recipe made before in this model: source key -> Revit id (and its fingerprints).
  const prints = new Map();
  const before = kit.whatItMadeBefore(context, prints);
  // 3. The changes.
  const operation = new kit.OperationBuilder({
    project: context.projectId,
    document: context.target.docId ?? '',
    baseCommit: context.target.version ?? 0,
    author: 'recipe:columns-from-points',
  });
  const s = kit.FEET_PER_METRE;
  const seen = new Set();
  for (const item of contents.items) {
    if (item.attrs.Layer !== 'COLUMNS' || !item.guid) continue;
    const [x, y, z] = item.attrs.Position.split(',').map(Number);   // metres, in this example
    const key = `${picked.fileId}:${item.guid}`;                      // stable across versions
    seen.add(key);
    const attrs = {
      CategoryId: settings.columnType.categoryId,
      Family: settings.columnType.family,
      Type: settings.columnType.type,
    };
    const placement = { position: [x * s, y * s, z * s], source: key };
    const print = kit.printOf({ attrs, placement });
    if (before.has(key)) {
      if (prints.get(key) === print) continue;                       // unchanged: nothing to write
      operation.remove(before.get(key));                             // changed: made again
    }
    operation.add({ ...attrs, 'flow:print': print }, placement);
  }
  // 4. What it made and whose source is gone: removed.
  for (const [key, id] of before) if (key.startsWith(`${picked.fileId}:`) && !seen.has(key)) operation.remove(id);
  if (operation.length === 0) {
    const error = new Error('Nothing to write: the model already has all of it.');
    error.name = 'UpToDate';                                         // not a failure: "up to date"
    throw error;
  }
  return {
    title: `Columns from points: ${operation.length} change(s)`,     // what the history row says
    verb: operation.summary,
    targets: operation.length,
    payload: new Blob([await operation.build(context.opId)]),
    ruleTallies: [{ read: seen.size, written: operation.length }],   // one per manifest rule
  };
}
```

### `context`

| Field | What it is |
|---|---|
| `client`, `projectId` | The platform client and the project. `client.downloadFile(id)` and friends. |
| `target` | `{ source: 'revit', docId, version }`: the model it writes. |
| `input` | The picked source: `{ fileId, name, folderId, version }`. |
| `settings` | What the person chose, keyed as in `settingsSchema`. A family type is `{ categoryId, family, type }`. |
| `made` | What this recipe made before in this model, as the model has it now. Use `kit.whatItMadeBefore`. |
| `opId` | This run's id: pass it to `operation.build`. |
| `progress(says, fraction?)` | A line for Revit's progress notice. |
| `kit` | The tools below. |

### `context.kit`

| Tool | Use |
|---|---|
| `readPickedFrag(context, input)` | Downloads the picked file (that version) and reads it: `{ picked, contents: { metadata, items }, site }`. A raw IFC goes through the platform's IFC converter first, so `items` carry records. |
| `readFrag(bytes)` | Reads any .frag: `{ metadata, items: [{ localId, guid, category, attrs }] }`. |
| `recordsOf(items)` | The platform's semantic records (walls as runs, slabs as extrusions, levels as datums…) out of a converted model: `[{ id, kind, params, item }]`. |
| `innerJson(record, param)`, `levelsOf(records)`, `levelNames(records)`, `stylesOf(records)` | Reading those records (see `records-to-revit.ts` for every kind). |
| `OperationBuilder` | Builds the changes: `add(attrs, { position?, rotationDeg?, source? })`, `set(revitId, attrs, placement?)`, `remove(revitId)`, `length`, `summary`, `build(opId)`. |
| `whatItMadeBefore(context, prints?)` | `Map<sourceKey, revitId>`, and fills `prints` with each one's fingerprint. |
| `printOf(value)` | A short fingerprint of what a change asks for: unchanged print = nothing to write. |
| `siteLocationOf(ifcBytes)` | Where an IFC's site stands (east, north, elevation, angle). |
| `FEET_PER_METRE` | Revit is feet. Records are metres. |

### The rules that make a recipe behave

1. **Every `add` carries a stable `source` key**: the source file's id plus the thing's own id
   (an IFC GlobalId, a Rhino guid), never its position in a list. That is how the next Apply knows
   what it made.
2. **Fingerprint what you add** (`'flow:print': kit.printOf(...)`): same print, nothing to write.
3. **Remove only what you made** (`made`): never anything a person drew.
4. **Nothing to write is `UpToDate`**, not an error.
5. **Feet, Z up, Revit names.** Categories by `CategoryId` (Revit's language-independent id), types
   and levels by their exact names.

## 4. What Revit understands (the change vocabulary)

Every attribute of an `add` or `set` is either one of these fields or **a Revit parameter by name**
(written as the parameter's value).

| Field | Meaning |
|---|---|
| `CategoryId` | Revit's category id: levels `-2000240`, walls `-2000011`, floors `-2000032`, roofs `-2000035`, ceilings `-2000038`, structural foundations `-2001300`, stairs `-2000120`, structural columns `-2001330`. |
| `Family`, `Type` | The family and type, by exact name. A loadable family type that the model lacks makes Revit refuse that element. Wall and floor types missing are made from `Type.Width`. |
| `Type.Width` | A wall or floor type's thickness (feet), to make it when missing. |
| `Name` | A level's name (levels are ensured by name: an existing one is reused). |
| `Elevation` | A level's height (feet). |
| `Level` | The element's level, by name. |
| `Position` / `Rotation` | Via the builder's `position` [x,y,z] (feet) and `rotationDeg` (about Z). For point-placed families. |
| `LocationLine` | A wall's line: `"x1,y1,z1;x2,y2,z2"` (feet). |
| `Height`, `BaseOffset`, `TopLevel`, `TopOffset` | A wall's height, base offset, top level (by name) and offset. |
| `JoinEnds`, `Mitre`, `Yields` | A wall's ends (`start`, `end`) that join, mitre, or stop at the wall they meet. |
| `AttachTop` | A wall's top attached to a roof or floor of the same run, by that change's source key. |
| `Profile` | A floor, ceiling, foundation slab or footprint roof boundary: JSON loops `[[x,y,z, x,y,z, …], …]`, outer first. |
| `HeightOffset` | A floor's top face above its level (feet). |
| `Slopes` | A footprint roof's slope per edge (rise/run, `null` for flat edges), JSON. |
| `Extrusion` | A roof by extrusion: `{"profile":[[x,y,z]…],"along":[x,y],"length":…}`. |
| `Curtain` | A curtain wall's grid: `{"along":[…],"up":[…],"mullion":{…},"panel":{…}}`. |
| `Stairs` | A stair: `{"family","base","height","risers","tread","width","path":[[x,y],[x,y]]}` or a `sketch`. |
| `Frame`, `SharedAt` | `"shared"` when your coordinates are the project's shared ones (an IFC exported in shared coordinates), and where that frame is. |

What it cannot make yet is said in the built-ins' rules tables ("Nothing yet - read and counted"):
hosted doors and windows, footings, ramps.

## 5. Test it without Revit

Run it with the services client and read the changes it would ask for:

```js
import { PlatformClient, compileRecipe, describeChanges } from '@thatopen/services';

const client = new PlatformClient(TOKEN, 'https://platform.thatopen.com');
const recipe = await compileRecipe(manifest, code);          // refuses code that does not load
const result = await recipe.run({
  client, projectId, target: { source: 'revit' }, made: new Map(), opId: 'test',
  input: { fileId, name: 'columns.frag' }, settings: { columnType: { categoryId: '-2001330', family: 'M_Concrete-Rectangular-Column', type: '300 x 450mm' } },
  progress: () => {},
});
const { changes } = await describeChanges(result.payload);
console.log(result.title, changes.slice(0, 5));
// [{ op: 'add', source: '…', attrs: { CategoryId: '-2001330', Family: '…', Type: '…', Position: '…' } }, …]
```

Check: the count is what the source holds, every `add` has a `source`, the units are feet, the
names are the model's own. Run it a second time with `made` filled from the first (source → an id)
and it must answer `UpToDate`.

(A raw IFC source needs the IFC converter, which the Revit plugin provides. To test an IFC recipe
outside Revit, point it at the IFC's converted .frag instead.)

## 6. Save it in the project

```js
const version = await client.recipes.project.save(projectId, { manifest, code }, {
  author: 'Ana (with Claude)',
  note: 'First version: columns on layer COLUMNS',
});
// 'v1', then 'v2'… every save is a new version, all of them kept
```

Then, in Revit, **That Open > Select recipe** lists it (marked "this project", with its version)
next to the built-ins. Apply runs its latest version; the history says which.

Other calls: `client.recipes.catalog(projectId, { to: 'revit' })` (built-ins and the project's),
`client.recipes.project.versions(projectId, name)`, `client.recipes.project.source(projectId, name, version?)`
(its manifest and code, to change it), `client.recipes.resolve(name, projectId, version?)`.

## 7. Checklist before handing it over

- [ ] A name of its own (not `ifc-to-revit`, `frag-to-revit`, `rhino-to-revit`).
- [ ] `description` in one sentence, `doc` written for a person, `rules` with one row per thing it does.
- [ ] Settings only booleans and `x-existing` family types.
- [ ] Stable `source` keys, fingerprints, removes only what it made, `UpToDate` when nothing changed.
- [ ] Tested with `describeChanges`: the right count, feet, the model's names.
- [ ] Saved with `client.recipes.project.save`, and the user told: Select recipe, then Apply recipe.
