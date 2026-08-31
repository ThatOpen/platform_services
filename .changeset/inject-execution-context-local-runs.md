---
"@thatopen/services": minor
---

Inject the `executionContext` global (`projectId`, `executionId`, `toolId`, `toolVersion`) into `thatopen run`/local-server executions, matching what the platform injects at real execution time. Components reading `executionContext` locally no longer crash with "executionContext is not defined".
