---
'@thatopen/services': minor
---

Fewer platform calls, for every app at once (Antonio, 23-10: DEV allows 100 a minute per person and opening a project went over it).
- A GET identical to one in flight, or answered less than 2 s ago, gets that response instead of going out again. Any write clears the cache.
- `documents` reads each `document.json` once per version, found through the project's listing rather than one listing per folder. `history` uses the same listing.
- `downloadFile` throws on a 429 or a 5xx instead of returning the error's body as if it were the file. Code that reads, edits and writes back must not write after a failed read.
