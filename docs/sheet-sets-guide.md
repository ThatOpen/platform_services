# That Open Drafter — Making a set of sheets of your own

Drafter's **Make a set of sheets** (the button in the header of **Sheets**) offers two sets:

- **The whole set** — a cover with the building in 3D, its site plan, a plan of every storey and of the
  roof (dimensioned and tagged), four elevations and two sections, each on sheets of its type, numbered
  from A001.
- **Floor plans** — a plan of every storey and of the roof, one to a sheet.

A set of your own is **your own sheet types**. A set is not drawn by hand, sheet by sheet: it is made of
a few *sheet types*, each of which says once how your studio draws one kind of sheet. Make yours, and
**The whole set** makes them in place of the standard ones.

---

## 1. What a sheet type says

| Field | What it says | Unsaid |
|---|---|---|
| **name** | Its name: «Architectural plan». | — |
| **format** | The paper format of its sheets, by name. | The document's first. |
| **title block** | The title block its sheets wear, by the name of its type. | The document's. |
| **holds** | What its views look at: `plan` (one a storey), `elevation`, `section`, `detail`, `site` (the site from above), `threeD` (the building in 3D, for a cover). | `plan` |
| **views per sheet** | How many views one sheet takes; more start the next sheet. | 1 |
| **scale** | The denominator of its views' scale: 50 for 1:50. | The largest standard scale the paper takes them at. |
| **view style** | The view style its views are drawn in, by name. | The drawing standard's for what they look at. |
| **view title** | The title its views wear under themselves, by name. | «View title»: their name and scale over a rule. |
| **annotates** | What is put on its views when a sheet is made: `dimensions`, `tags` (rooms, doors, windows), `elevationMarks`, `sectionMarks`, `levels`. | Nothing. |

Every document starts with these, which you can change or copy:

| Sheet type | Holds | Views per sheet | Annotates |
|---|---|---|---|
| Cover | threeD | 1 | — |
| Site plan | site | 1 | — |
| Architectural plan | plan | 1 | dimensions, tags, elevation and section marks |
| Elevations | elevation | 2 | levels |
| Sections | section | 2 | levels |
| Construction detail | detail (1:20) | 1 | — |

## 2. Make yours

1. Open **Types**, and under **Sheet type** add one (or duplicate a standard one).
2. Give it a name of your own («Plan 1:50 A1»), and say its fields as above: pick the format, the title
   block and the view style from their lists.
3. Do the same for each kind of sheet your studio delivers.

## 3. Make the set

Press **Make a set of sheets → The whole set**. For each kind of view (cover, site, plans, elevations,
sections, details) it takes **your** sheet types of that kind, and only where you have none, the
standard one. So a document with your «Plan 1:50 A1» makes every storey on it, and the standard
elevations and sections beside them, until you make yours too.

The set reads the building open in **Models**: one plan for each storey (reference levels left out) and
for the roof, and four elevations and two sections where the model has no marks yet.

## 4. Keep it for the next project

Sheet types are types of the drawing set, kept with it. Start your next drawing set from one that has
them, and its set comes out as your last.

---

*For AI assistants:* the same is done through Drafter's commands, as its buttons run them —
`type.define { of: "sheetType", named }`, then `type.set { named, field, value: [ ... ] }` for each field
above (the field names are the first column, in camelCase: `titleBlock`, `views`, `viewStyle`,
`viewTitle`, `annotates`). The set itself is `Modeling.sheetMaking.makeSet(canvas, { types })`, with
`types` the names of the sheet types to make, in any order.
