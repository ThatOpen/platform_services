---
'@thatopen/services': minor
---

Add batch read methods so a page of files, or a model's tiles, can be hydrated in one request instead of one per id.

- `getHiddenFileSignedUrlsBatch(hiddenIds, expiresIn?)` — signs many hidden files at once. This is the call tile-based viewers (splats, point clouds) should use; minting one URL per tile as the camera moves is what pushes a single session past the rate limit.
- `listVersionsBatch(itemIds, { archived? })` — versions for many items. The records carry their metadata, so a list that only needs metadata does not need a second call.
- `getFileVersionMetadataBatch(entries, { withDraft? })` — metadata for many `{ itemId, versionTag }` pairs.
- `getFoldersBatch(folderIds)` — resolves a known set of folder ids.

All four split inputs longer than `STORAGE_BATCH_MAX` (100) into several requests automatically, return entries in request order, and mark an id the caller cannot read with an `error` instead of failing the whole batch.

Requires the matching backend endpoints (`POST /item/hidden/signed-url/batch`, `POST /item/batch/versions`, `POST /item/batch/version-metadata`, `POST /item/batch/folders`).
