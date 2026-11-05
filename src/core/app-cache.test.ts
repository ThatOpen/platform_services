import { afterEach, describe, expect, it, vi } from 'vitest';
import { AppCache } from './app-cache';

describe('AppCache', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('keeps in memory outside the platform, and starts empty', () => {
    const cache = new AppCache();
    expect(cache.get('app:lastDocument')).toBeUndefined();
    cache.set('app:lastDocument', { fileId: 'f', versionTag: 'v2' });
    expect(cache.get('app:lastDocument')).toEqual({
      fileId: 'f',
      versionTag: 'v2',
    });
    cache.delete('app:lastDocument');
    expect(cache.get('app:lastDocument')).toBeUndefined();
  });

  it('reads what the platform page handed over, and writes back through it', () => {
    const cacheSet = vi.fn();
    const cacheDelete = vi.fn();
    vi.stubGlobal('window', {
      __THATOPEN_CONTEXT__: { cache: { files: 1 }, cacheSet, cacheDelete },
    });
    const cache = new AppCache();
    expect(cache.get('files')).toBe(1);
    const bytes = new Uint8Array([1, 2, 3]);
    cache.set('app:bytes:f:v2', bytes);
    expect(cacheSet).toHaveBeenCalledWith('app:bytes:f:v2', bytes);
    cache.delete('app:bytes:f:v2');
    expect(cacheDelete).toHaveBeenCalledWith('app:bytes:f:v2');
  });

  it('answers a listing only for its own project', () => {
    const cache = new AppCache();
    cache.keepAnswer('documents', 'p1', { documents: [] });
    expect(cache.answer('documents', 'p1')?.value).toEqual({ documents: [] });
    expect(cache.answer('documents', 'p2')).toBeUndefined();
  });
});
