---
"@thatopen/services": minor
---

Recipes are applied from the native application, in one go, with no proposals. Breaking:

- `RecipeContext.targetDoc` → `target: { source, docId?, version? }`, plus `made`, `progress` and `kit`.
- `RecipeRunOutcome` and `RecipePlan` are gone with the proposal flow.
- The manifest's `rules` say `{ reads, writes }` (was `proposes`), and `ruleTallies` say `{ read, written }`.

New:

- `recipes.catalog()` lists the built-in recipes and the project's own.
- `provideImporter(ext, importer)`: IFC to Revit converts a raw IFC with it, as its first step.
- `provideShapes(ext, reader)`: doors, windows, furniture and the rest become families made from the file's own shapes.
- `UpToDate` is thrown when a run has nothing to write.
- `client.nextVersionTag` gives `v1`, `v2`… instead of timestamp tags.
- History: a 'restore' version, the upload as its first step, and `streamId` (a version's delta as a streamed bundle).
- IFC to Revit:
  - walls with their IFC layers, square ends and unfilled openings;
  - curtain walls, stairs, roofs, ceilings and rooms;
  - prism families with a length parameter;
  - columns at their own height;
  - shapes taken to the records' height.
