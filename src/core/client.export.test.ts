import { describe, it, expect, beforeEach, afterEach, vi, type Mock } from 'vitest';
import { EngineServicesClient } from './client';

// A project's documents as one flat table, for BI (APOGEA 21-10).
const API = 'https://api.example.com';

describe('exportProjectDocuments', () => {
  let fetchMock: Mock;
  beforeEach(() => {
    fetchMock = vi.fn();
    globalThis.fetch = fetchMock as unknown as typeof fetch;
  });
  afterEach(() => vi.restoreAllMocks());

  it('asks for the JSON table by default', async () => {
    const table = { columns: ['fileId'], value: [{ fileId: 'a' }] };
    fetchMock.mockResolvedValue({
      ok: true, status: 200, statusText: 'OK',
      text: async () => JSON.stringify(table), json: async () => table,
    });
    const client = new EngineServicesClient('token', API);
    await expect(client.exportProjectDocuments('p1')).resolves.toEqual(table);
    const url = new URL(fetchMock.mock.calls[0][0] as string);
    expect(url.pathname).toBe('/api/item/export');
    expect(url.searchParams.get('projectId')).toBe('p1');
    expect(url.searchParams.get('format')).toBeNull();
  });

  it('answers the CSV as text, without the BOM', async () => {
    fetchMock.mockResolvedValue({
      ok: true, status: 200, statusText: 'OK',
      blob: async () => new Blob(['﻿fileId\r\na']),
      headers: new Headers({ 'content-type': 'text/csv' }),
    });
    const client = new EngineServicesClient('token', API);
    await expect(client.exportProjectDocuments('p1', { format: 'csv' })).resolves.toBe('fileId\r\na');
    expect(new URL(fetchMock.mock.calls[0][0] as string).searchParams.get('format')).toBe('csv');
  });
});
