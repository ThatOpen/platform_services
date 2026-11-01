import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { refreshBrowserSession, signInWithBrowser } from './browser-sign-in';

const answers = (...bodies: unknown[]) => {
  const fetchMock = vi.fn();
  for (const body of bodies) {
    fetchMock.mockResolvedValueOnce({
      ok: true,
      json: async () => body,
    });
  }
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
};

const started = {
  device_code: 'device',
  user_code: 'HQ4F-72BD',
  verification_uri: 'https://platform/dashboard/connect/device',
  verification_uri_complete:
    'https://platform/dashboard/connect/device?userCode=HQ4F-72BD',
  expires_in: 600,
  interval: 5,
};

const options = (onVerification = vi.fn()) => ({
  apiUrl: 'https://platform/',
  application: 'That Open CLI',
  machine: 'laptop',
  version: '1.0.0',
  onVerification,
});

const bodyOf = (call: unknown[]) =>
  JSON.parse((call[1] as { body: string }).body);

describe('signInWithBrowser', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it('shows the code, waits for the person and returns the session', async () => {
    const fetchMock = answers(
      started,
      { status: 'pending' },
      {
        status: 'confirmed',
        installId: 'install',
        refreshToken: 'refresh',
        accessToken: 'access',
        expiresIn: 900,
      },
    );
    const onVerification = vi.fn();

    const signingIn = signInWithBrowser(options(onVerification));
    await vi.advanceTimersByTimeAsync(10_000);
    const session = await signingIn;

    expect(onVerification).toHaveBeenCalledWith({
      url: started.verification_uri_complete,
      userCode: 'HQ4F-72BD',
      manualUrl: started.verification_uri,
    });
    expect(session).toMatchObject({
      accessToken: 'access',
      installId: 'install',
      refreshToken: 'refresh',
    });
    expect(fetchMock.mock.calls[0][0]).toBe(
      'https://platform/api/connectors/device/start',
    );
    expect(bodyOf(fetchMock.mock.calls[0]).connectorId).toBe('services-sdk');
    expect(bodyOf(fetchMock.mock.calls[1])).toEqual({
      deviceCode: 'device',
      connectorId: 'services-sdk',
      pluginVersion: '1.0.0',
    });
  });

  it('gives up when the code expires', async () => {
    const fetchMock = answers({ ...started, expires_in: 4 });
    fetchMock.mockResolvedValue({
      ok: true,
      json: async () => ({ status: 'pending' }),
    });

    const signingIn = signInWithBrowser(options());
    const expectation = expect(signingIn).rejects.toThrow(/expired/);
    await vi.advanceTimersByTimeAsync(10_000);
    await expectation;
  });

  it('says what the platform said when it refuses', async () => {
    const fetchMock = answers(started);
    fetchMock.mockResolvedValueOnce({
      ok: false,
      status: 403,
      text: async () => JSON.stringify({ message: 'Update to 1.1.0' }),
    });

    const signingIn = signInWithBrowser(options());
    const expectation = expect(signingIn).rejects.toThrow('Update to 1.1.0');
    await vi.advanceTimersByTimeAsync(5_000);
    await expectation;
  });

  it('stops waiting when asked to', async () => {
    answers(started);
    const controller = new AbortController();

    const signingIn = signInWithBrowser({
      ...options(),
      signal: controller.signal,
    });
    const expectation = expect(signingIn).rejects.toThrow('cancelled');
    await vi.advanceTimersByTimeAsync(0);
    controller.abort();
    await expectation;
  });
});

describe('refreshBrowserSession', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('returns the rotated refresh token with the new access token', async () => {
    answers({ refreshToken: 'next', accessToken: 'fresh', expiresIn: 900 });

    const next = await refreshBrowserSession({
      apiUrl: 'https://platform',
      accessToken: 'old',
      expiresAt: 0,
      installId: 'install',
      refreshToken: 'first',
    });

    expect(next).toMatchObject({
      accessToken: 'fresh',
      refreshToken: 'next',
      installId: 'install',
    });
    expect(next.expiresAt).toBeGreaterThan(Date.now());
  });
});
