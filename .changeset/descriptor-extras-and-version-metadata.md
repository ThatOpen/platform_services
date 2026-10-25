---
'@thatopen/services': patch
---

A document's descriptor keeps what it says besides its known fields (a PDF's `source`): they were dropped on reading. A new file version with `metadata` no longer fails (the platform takes none with the upload): the metadata is written right after.
