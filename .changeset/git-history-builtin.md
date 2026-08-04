---
"@thatopen/services": minor
---

Export the `GitHistoryManager` built-in, so an app can use the revit-flow history.

The component and its panel (`top-git-history`) are published and the platform serves them by
UUID, but nothing in this package named them: `import { GitHistoryManager } from
"@thatopen/services"` did not compile, which is the first line of any app that wants to show a
model's history. Verified against the published tarball — `UIManager` was in it and
`GitHistoryManager` appeared in no file at all.

It reads the history the Revit add-in publishes per sync and colours a commit's changed elements
in the shared viewer: green created, blue modified, red deleted.
