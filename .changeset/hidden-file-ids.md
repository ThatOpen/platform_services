---
'@thatopen/services': patch
---

`suggest()` and `sync()` now store the real hidden-file id of a payload or a delta. They read `_id`/`id` from the upload's answer, but `createHiddenFile` answers `{ hiddenFileId }`, so every suggestion with a payload was saved with `fragId: "undefined"` and every synced delta with `deltaId: "undefined"` — the Revit add-in then failed downloading `item/hidden/undefined`. A missing id now throws instead of being written. Entries written by 0.20–0.28 keep the broken pointer and have to be re-queued or repaired by hand.
