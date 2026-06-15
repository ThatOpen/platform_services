---
"@thatopen/services": minor
---

Add `EngineServicesClient.createHiddenFilesBatch()` to upload many hidden files
in a single request, for large 3D-tile sets (point clouds / gaussian splats)
without hitting the per-file upload throttle. Exports the
`CreateHiddenItemsBatchResult` type.
