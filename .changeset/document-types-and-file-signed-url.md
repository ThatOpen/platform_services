---
'@thatopen/services': minor
---

Document types: every document says what it is — `'bim' | 'drawings' | 'reality' | 'generic'` (`DocumentType`) — so each app's documents menu lists only what it works with. `DocumentDescriptor.type` is written by whoever makes the document (`fromFile(id, { type })`, `documents.setType(folderId, type)`); `documentTypeOf(descriptor)` answers it, reading a document made before types from its formats (rvt/ifc/frag/3dm → bim, dwg/dxf → drawings, las/laz/e57/potree/splat → reality, anything else → generic). `documents.list({ types })` filters by it, and `DOCUMENT_TYPES[type]` gives the label and icon every app shows.

`client.getFileSignedUrl(fileId, { versionTag?, expiresIn? })`: a short-lived presigned URL for a regular file's content, fetched by HTTP Range straight from storage. It needs the backend route `GET /item/:itemId/signed-url`, not deployed yet: until then, stream from hidden files with `getHiddenFileSignedUrl`.
