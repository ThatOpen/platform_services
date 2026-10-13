---
'@thatopen/services': minor
---

Document drafts: `client.documents(projectId).drafts(folderId)` keeps each user's working copy of a document so that closing the browser never loses work — without ever creating a version or showing in the CDE. A draft is a hidden file under the document's `document.json`, tagged `draft:<userId>`. `put(blob, { userId, meta })` stores it and replaces that user's previous one (only the latest is kept); `list()` answers `{ userId, savedAt }` per user without downloading anything, `savedAt` being the server's time read from the hidden file's own id; `get({ userId? })` downloads `{ blob, meta, userId, savedAt }` (the newest of anyone without a userId); `delete({ userId })` removes them, typically on an explicit save. `meta` is free JSON the app chooses (base version, app, app version) and travels in a small envelope before the bytes.
