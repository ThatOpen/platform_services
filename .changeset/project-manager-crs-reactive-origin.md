---
"@thatopen/services": minor
---

`ProjectManager`: add a project-wide `crs` singleton (`CrsData`: `epsgCode`, `geoidUndulation`) and make `origin` and `crs` reactive (`onChange`), with dirty tracking (`dirty`, `dirtyEntities`, `onDirtyChange`). Remove the unused `bimCoordinates` sites collection and its `BimSite`/`BimCoordinatesData` types.
