---
'@thatopen/services': minor
---

Rate limit guidance and a backoff-aware retry policy.

- `docs/rate-limits.md` documents the per-endpoint limits, the `429` body, and the local-draft
  save pattern (keep work in progress in `localStorage` / IndexedDB, write on an explicit save).
- `resources/AGENTS.md` gains a hard rule against autosaving to the platform on every change,
  so assistants stop building write-per-keystroke loops.
- `RequestError.retryAfter` exposes the wait in seconds, read from `Retry-After` or
  `details.retryAfter`.
- Retries now back off exponentially with jitter and honour `Retry-After`. Only network
  failures, `429` and `5xx` are retried — other `4xx` fail immediately instead of being
  repeated. Retries remain off by default.
