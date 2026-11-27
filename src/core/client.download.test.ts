import { describe, it, expect, afterEach, vi } from 'vitest';
import { EngineServicesClient } from './client';

const API = 'https://api.example.com';

const answer = (status: number, redirected = false) =>
  ({
    ok: status >= 200 && status < 300,
    status,
    redirected,
    statusText: '',
  }) as unknown as Response;

/** A large file is asked from storage through the platform's redirect; anything wrong with that, through the API. */
describe('downloadFile', () => {
  const real = globalThis.fetch;
  afterEach(() => {
    globalThis.fetch = real;
  });

  const withFetch = (...answers: (Response | Error)[]) => {
    const fetchMock = vi.fn(async () => {
      const next = answers.shift();
      if (next instanceof Error) throw next;
      return next!;
    });
    globalThis.fetch = fetchMock as unknown as typeof fetch;
    return fetchMock;
  };
  const urlOf = (mock: ReturnType<typeof vi.fn>, call: number) =>
    new URL(String(mock.mock.calls[call][0]));

  it('asks for the redirect to storage, and uses what storage answered', async () => {
    const mock = withFetch(answer(200, true));
    const got = await new EngineServicesClient('t', API).downloadFile('f1', {
      versionTag: 'v2',
    });
    expect(got.status).toBe(200);
    expect(mock).toHaveBeenCalledTimes(1);
    expect(urlOf(mock, 0).searchParams.get('redirect')).toBe('storage');
    expect(urlOf(mock, 0).searchParams.get('versionTag')).toBe('v2');
  });

  it('asks again through the API when the redirect did not end well', async () => {
    const mock = withFetch(answer(400, true), answer(200));
    const got = await new EngineServicesClient('t', API).downloadFile('f1');
    expect(got.status).toBe(200);
    expect(mock).toHaveBeenCalledTimes(2);
    expect(urlOf(mock, 1).searchParams.get('redirect')).toBeNull();
  });

  it('asks again through the API when the redirect was refused on the way', async () => {
    const mock = withFetch(new TypeError('Failed to fetch'), answer(200));
    const got = await new EngineServicesClient('t', API).downloadFile('f1');
    expect(got.status).toBe(200);
    expect(mock).toHaveBeenCalledTimes(2);
  });

  it('answers a 404 from the platform as it is, without asking twice', async () => {
    const mock = withFetch(answer(404));
    const got = await new EngineServicesClient('t', API).downloadFile('f1');
    expect(got.status).toBe(404);
    expect(mock).toHaveBeenCalledTimes(1);
  });
});
