---
'@thatopen/services': minor
---

History and recipes, the first field batch from the Coordination app. `history.docs()` no longer lists folders the backend leaks past the parent filter (any project folder with a dash looked like a document). Suggestion ids are minted BEFORE a recipe runs and arrive in its context (`ctx.opId`), because the `revitflow/op@2` payload carries the opId inside; `doc.suggest` accepts a caller-minted `opId` too. `recipes.plan()` is the dry pass: the recipe's result and rule tallies with nothing queued; `run()` still queues. The manifest gains `title` (human name), `doc` (long markdown) and `source` (what the app offers as input picker: a connected document or a project file). Settings that name an EXISTING thing declare it with `x-existing: { of, from }` so apps render lists people pick from — the `ExistingLookup` type documents the contract; resolving candidates stays in the app until the fragments toolkit ships a shared reader.
