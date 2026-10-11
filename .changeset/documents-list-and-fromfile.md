---
'@thatopen/services': minor
---

Documents gain `list()` and `fromFile()`. `list()` answers every document of the project (folderId + validated descriptor) in one call for the app, parallelized inside. `fromFile(fileId, { name?, selfView? })` converts a loose file into a document: creates the folder next to the file, moves it in (moving preserves the id), and writes the descriptor — the file as `native`, and as `views[0]` when its format views itself (`SELF_VIEWING_FORMATS`: pdf/txt/md/json/csv/tsv/frag — deliberately not ifc, whose proper view is the processed frag). A file carrying the legacy `derivedFileId` link brings the derivative into the folder as a view, migrating the retired link concept into the folder-document shape.
