---
'@thatopen/services': minor
---

Fewer platform calls again. A project's listings (`item/folder`, `item?itemType`, `folder/:id/items`) and its `project/:id/data` are shared for 15 s instead of 2, and any write from the page still clears them. A permission check no longer clears the shared reads: it is what sent `project/data` twice in the same millisecond. `history.json` and the other history JSON files are read once per version.
