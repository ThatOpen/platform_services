---
'@thatopen/services': minor
---

Streamed models are read from hidden files: `DocumentView` gains `hiddenId` (the view is a hidden file of `fileId`'s item, read by pieces with `getHiddenFileSignedUrl` / `getHiddenFileSignedUrlsBatch`) and `versionTag` (the version of `fileId` it was made from; a different current version means the view is stale). A streamed model's bundle is the view `{ fileId: <.frag item>, format: 'tostrm', hiddenId, versionTag }`, and `tostrm` reads as a `'bim'` document. `client.getFileSignedUrl`, published in 0.30.0 for a backend route that was never deployed, is removed: stream from hidden files.
