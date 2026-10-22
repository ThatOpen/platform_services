---
'@thatopen/services': patch
---

`createFile` and `updateFile` (when a name is given) upload a bare `Blob` under the item's name, so the item gets its `fileExtension` instead of an empty one.
