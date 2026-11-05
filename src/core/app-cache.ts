/**
 * WHAT THIS APP SAW LAST TIME, to open on at once and correct afterwards
 * (Antonio, 5-11).
 *
 * In the platform, the page around the app keeps it (the app's frame has no
 * storage of its own) and hands it over with the token, before the bundle runs:
 * `window.__THATOPEN_CONTEXT__.cache`. Writing sends it back to the page for the
 * next time. Outside the platform (a standalone page, a sandbox, a test) it is
 * kept in memory, so the same code works there and simply starts empty.
 *
 * Keys: `documents`, `files` and `projectData` are the project's listings, filled
 * by this client whenever a fresh answer arrives (`{ projectId, value, at }`).
 * An app's own keys start with `app:` and are kept apart per app by the page.
 */
export interface CachedAnswer<T> {
  projectId: string;
  value: T;
  /** When the answer arrived, in ms since the epoch. */
  at: number;
}

type PlatformCache = {
  cache?: Record<string, unknown>;
  cacheSet?: (key: string, value: unknown) => void;
  cacheDelete?: (key: string) => void;
};

const platform = (): PlatformCache | null => {
  if (typeof window === 'undefined') return null;
  const context = window.__THATOPEN_CONTEXT__ as PlatformCache | undefined;
  return context && typeof context.cacheSet === 'function' ? context : null;
};

export class AppCache {
  #memory = new Map<string, unknown>();

  /** What was kept under `key`, or undefined. */
  get<T = unknown>(key: string): T | undefined {
    const page = platform();
    if (page) return page.cache?.[key] as T | undefined;
    return this.#memory.get(key) as T | undefined;
  }

  /** Kept for the next time this app opens in this project (structured-cloneable values, bytes too). */
  set(key: string, value: unknown): void {
    const page = platform();
    if (page) page.cacheSet!(key, value);
    else this.#memory.set(key, value);
  }

  delete(key: string): void {
    const page = platform();
    if (page) page.cacheDelete?.(key);
    else this.#memory.delete(key);
  }

  /** One of the project's listings as it was last answered, if it is this project's. */
  answer<T>(
    key: 'documents' | 'files' | 'projectData',
    projectId: string,
  ): CachedAnswer<T> | undefined {
    const kept = this.get<CachedAnswer<T>>(key);
    return kept && kept.projectId === projectId ? kept : undefined;
  }

  /** @internal The client keeping a fresh listing. */
  keepAnswer(
    key: 'documents' | 'files' | 'projectData',
    projectId: string,
    value: unknown,
  ): void {
    try {
      this.set(key, {
        projectId,
        value,
        at: Date.now(),
      } satisfies CachedAnswer<unknown>);
    } catch {
      // A cache that cannot keep this is a miss next time, nothing worse.
    }
  }
}
