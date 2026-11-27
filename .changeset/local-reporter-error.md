---
'@thatopen/services': patch
---

`thatopen run` and `thatopen local-server`: `executionReporter.error()` exists locally, as documented and as in the cloud. Error lines print as `[error]` and carry `level: "error"` in local-server messages.
