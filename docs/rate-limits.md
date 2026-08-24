# Rate limits, and how to save data without hitting them

The platform API is rate limited. Every app and cloud component shares the same
budget, so **how often you write decides whether your app works**. This page has
the numbers, the failure mode, and the pattern to use instead.

> **The one rule:** never send a request on every change the user makes. No
> autosave-per-keystroke, no write inside a render loop, no polling loop that
> hammers a list endpoint. Keep work-in-progress in the browser and talk to the
> server on an explicit save.

---

## The numbers

Limits are per **rolling 60-second window**, counted per user (JWT), or per API
token owner, or per IP — whichever identifies the caller.

| Endpoint | Client method | Limit |
|---|---|---|
| `POST /api/item` | `createFile`, `createComponent`, `createApp` | **30 / min** |
| `POST /api/item/:id/version` | `updateFile` / `updateComponent` **with a `file`** | **30 / min** |
| `PUT /api/item/:id/version/:tag/metadata` | `updateFileVersionMetadata` | 30 / min |
| `DELETE /api/item/:id/version/:tag/metadata` | `deleteFileVersionMetadata` | 30 / min |
| `PUT /api/item/:id/version/:tag/archive` \| `/recover` | `archiveVersion`, `recoverVersion` | 30 / min |
| `POST /api/item/hidden` \| `/hidden/batch` | `createHiddenFile`, `createHiddenFilesBatch` | 30 / min |
| `POST /api/processor/:id/execute` | `executeComponent` | 20 / min |
| `GET /api/item/folder/:id/download`, `POST /api/item/batch/download` | `downloadFolder` | 10 / min |
| `POST /api/item/batch/versions` \| `/batch/version-metadata` \| `/batch/folders` | `listVersionsBatch`, `getFileVersionMetadataBatch`, `getFoldersBatch` | 60 / min |
| `POST /api/item/hidden/signed-url/batch` | `getHiddenFileSignedUrlsBatch` | 100 / min |
| `GET /api/item/hidden/:id/download` | `downloadHiddenFile` | 3000 / min |
| Everything else | — | 100 / min |

Two things follow from the table:

- **30 writes per minute is one write every two seconds.** An autosave tied to
  user input passes that in a few seconds of typing or dragging.
- **Reads are cheap, but not free.** A viewer that mints one signed URL per tile
  will exhaust 100/min quickly — use `getHiddenFileSignedUrlsBatch`, which signs
  up to `STORAGE_BATCH_MAX` files per request.

## What a rate-limited response looks like

Status `429`, with a `Retry-After` header (seconds) and this body:

```json
{
  "statusCode": 429,
  "message": "Rate limit exceeded: max 30 requests per 60s for this endpoint. Retry after 12s.",
  "code": "RATE_LIMITED",
  "details": { "limit": 30, "windowSeconds": 60, "retryAfter": 12, "scope": "user" }
}
```

The client surfaces it as a `RequestError`:

```ts
import { RequestError } from '@thatopen/services';

try {
  await client.updateFile(fileId, { file: blob, versionTag: tag });
} catch (err) {
  if (err instanceof RequestError && err.status === 429) {
    // err.code === 'RATE_LIMITED'
    // err.retryAfter — seconds to wait, from Retry-After or details.retryAfter
    showToast(`Saving is paused for ${err.retryAfter}s — your work is kept locally.`);
    return;
  }
  throw err;
}
```

**A 429 means the write did not happen.** Nothing was saved. If the user's only
copy of the change was in that request, it is gone — which is the real reason
the local-draft pattern below matters.

## The pattern: local drafts, explicit saves

Keep every intermediate state in the browser. Write to the platform only when
the user asks for it.

```ts
const draftKey = `draft:${fileId}`;

function onChange(state: unknown) {
  localStorage.setItem(draftKey, JSON.stringify({ state, at: Date.now() }));
}

async function onSave(state: unknown) {
  const blob = new Blob([JSON.stringify(state)], { type: 'application/json' });
  await client.updateFile(fileId, { file: blob, versionTag: `v${Date.now()}` });
  localStorage.removeItem(draftKey);
}
```

On load, if a draft exists for the file, offer to restore it. That gives crash
recovery — the thing autosave was really for — at zero requests.

Rules of thumb:

- **Explicit save**, or a timer no faster than **once every 30 seconds**, and
  only when something actually changed.
- **One request per save**, not one per changed object. Batch the whole document.
- **Never save while a save is in flight.** Keep a flag per file, and drop or
  queue the second save. Overlapping writes also create versions that are hard
  to reconcile.
- **Big or binary work-in-progress** belongs in IndexedDB, not `localStorage`
  (about 5 MB per origin).
- There is **no draft-write method in the client on purpose.** Local storage is
  the draft store; the platform stores versions the user chose to keep.

## Retries

The client does not retry by default. When you turn retries on, it backs off
exponentially, adds jitter, and honours `Retry-After`:

```ts
const client = new EngineServicesClient(token, apiUrl, { retries: 3 });
```

Only network failures, `429` and `5xx` are retried. Other `4xx` fail straight
away, because repeating them cannot help. Never write your own immediate retry
loop around a 429 — that is what turns a throttled request into an outage.
