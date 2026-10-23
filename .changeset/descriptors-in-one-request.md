---
'@thatopen/services': minor
---

`documents.list()` asks the platform for every descriptor of the project in one request (`client.listDocumentDescriptors`, `GET /item/documents`) and keeps each by its version. A platform without that route answers 404, and the list reads them one by one as before, without asking that platform again in the page. A 429 or a 5xx is still an error.
