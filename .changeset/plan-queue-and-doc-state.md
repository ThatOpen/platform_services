---
'@thatopen/services': minor
---

Second field batch for history and recipes. `history.docs()` now says what each document IS: `modelName` filled from the folder's visible model, and `empty: true` for a connected-but-never-synced shell (listed, not hidden — apps dim or skip it). `recipes.plan()` returns a `RecipePlan` and the new `recipes.queue(plan, { author })` queues EXACTLY what was planned — same opId, same payload, no second execution; `run()` stays as the one-shot shortcut. `ExistingLookup` gains `where` (attribute-equals-value against the names the native app publishes, no normalization; use stable machine fields like Revit's `CategoryId: '-2001330'`, never localized display names).
