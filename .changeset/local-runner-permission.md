---
'@thatopen/services': patch
---

CLI: `thatopen run` and `thatopen local-server` now run the component under Node's permission model with a minimal environment, as the cloud worker does, and write the temporary engine script with mode 600.
