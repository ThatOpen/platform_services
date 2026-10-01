---
'@thatopen/services': minor
---

Hidden files can be tagged. `createHiddenFile` and `createHiddenFilesBatch` take an optional `tag` (one tag applies to every file in a batch), `getHiddenFilesByParent` takes an optional `tag` filter (a tagged listing comes back in creation order), and `HiddenFileEntity` gains the optional `tag` field. Existing calls are unchanged.
