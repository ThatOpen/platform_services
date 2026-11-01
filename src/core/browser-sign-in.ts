/**
 * What `signInWithBrowser` leaves: enough to call the platform now, and to keep
 * doing so after the access token expires.
 */
export interface BrowserSession {
  apiUrl: string;
  accessToken: string;
  /** When the access token stops working, in milliseconds since the epoch. */
  expiresAt: number;
  installId: string;
  refreshToken: string;
}

export interface SignInWithBrowserOptions {
  /** The platform to sign in to. */
  apiUrl: string;
  /**
   * Shown to the person with the code, so they can tell it is theirs: what is
   * asking and where. For example `That Open CLI` and the machine's name.
   */
  application: string;
  machine: string;
  /** This package's version. The platform refuses a version it no longer supports. */
  version: string;
  /**
   * Called once with the address to open and the code it should show. The
   * person compares that code and confirms it there.
   */
  onVerification: (verification: BrowserVerification) => void | Promise<void>;
  /** Stops waiting for the person. */
  signal?: AbortSignal;
}

export interface BrowserVerification {
  url: string;
  userCode: string;
  /** Where to type the code, for somebody who cannot follow `url`. */
  manualUrl: string;
}

/** What this package connects to the platform as. */
export const SERVICES_SDK_CONNECTOR_ID = 'services-sdk';

const post = async <T>(url: string, body: unknown): Promise<T> => {
  const response = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!response.ok) {
    const text = await response.text().catch(() => '');
    let message = text;
    try {
      message = (JSON.parse(text) as { message?: string }).message ?? text;
    } catch {
      /* Not JSON: the text is the best there is. */
    }
    throw new Error(message || `The platform answered ${response.status}`);
  }
  return (await response.json()) as T;
};

const wait = (ms: number, signal?: AbortSignal) =>
  new Promise<void>((resolve, reject) => {
    const timer = setTimeout(resolve, ms);
    signal?.addEventListener(
      'abort',
      () => {
        clearTimeout(timer);
        reject(new Error('Sign-in cancelled'));
      },
      { once: true },
    );
  });

const deviceUrl = (apiUrl: string, path: string) =>
  `${apiUrl.replace(/\/$/, '')}/api/connectors/device/${path}`;

/**
 * Signs in through the browser, as the Revit plugin does (RFC 8628): the
 * platform gives a code, the person confirms it in their browser, and this waits
 * for the answer. No token is ever pasted.
 */
export async function signInWithBrowser(
  options: SignInWithBrowserOptions,
): Promise<BrowserSession> {
  const { apiUrl, application, machine, version, onVerification, signal } =
    options;

  const start = await post<{
    device_code: string;
    user_code: string;
    verification_uri: string;
    verification_uri_complete: string;
    expires_in: number;
    interval: number;
  }>(deviceUrl(apiUrl, 'start'), {
    application,
    machine,
    connectorId: SERVICES_SDK_CONNECTOR_ID,
  });

  await onVerification({
    url: start.verification_uri_complete,
    userCode: start.user_code,
    manualUrl: start.verification_uri,
  });

  const deadline = Date.now() + start.expires_in * 1000;
  while (Date.now() < deadline) {
    await wait(start.interval * 1000, signal);
    const claim = await post<
      | { status: 'pending' }
      | {
          status: 'confirmed';
          installId: string;
          refreshToken: string;
          accessToken: string;
          expiresIn: number;
        }
    >(deviceUrl(apiUrl, 'claim'), {
      deviceCode: start.device_code,
      connectorId: SERVICES_SDK_CONNECTOR_ID,
      pluginVersion: version,
    });
    if (claim.status === 'confirmed') {
      return {
        apiUrl,
        accessToken: claim.accessToken,
        expiresAt: Date.now() + claim.expiresIn * 1000,
        installId: claim.installId,
        refreshToken: claim.refreshToken,
      };
    }
  }
  throw new Error('The code expired before it was confirmed. Try again.');
}

/**
 * A new access token for a session. The refresh token rotates, so the session
 * returned replaces the one given: keep this one, wherever it is stored.
 */
export async function refreshBrowserSession(
  session: BrowserSession,
): Promise<BrowserSession> {
  const next = await post<{
    refreshToken: string;
    accessToken: string;
    expiresIn: number;
  }>(deviceUrl(session.apiUrl, 'refresh'), {
    installId: session.installId,
    refreshToken: session.refreshToken,
  });
  return {
    ...session,
    accessToken: next.accessToken,
    expiresAt: Date.now() + next.expiresIn * 1000,
    refreshToken: next.refreshToken,
  };
}
