---
'@thatopen/services': minor
---

The history and recipes APIs, at services level. `client.history(projectId)` reads and writes a project's connected documents (Revit, AutoCAD…): version timelines ordered by the parent graph, deltas, full models, and change requests (suggestions) with their lifecycle. The flow storage underneath (`bimterop` folders, `revitflow_history.json`, `revitflow_ops.json`, hidden deltas) is fully encapsulated: this surface is the only supported way in, so the layout and the future platform-level API can change without touching callers. Appends take an `expectedLatestGuid` and refuse with `StaleHistoryError` when the head moved; the remaining write race is documented and owned by the agreed platform-level phase 2.

`client.recipes` is the registry and runner for recipes: scripts that write suggestions in a native application's own language, defined by a manifest (`to`, `inputs`, `runtime`, `settingsSchema`, a self-documenting rules table) plus one `run` function. Running a recipe only queues a suggestion, so trying one is always safe.
