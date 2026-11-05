/** Callbacks the platform can pass to embedded apps via the context object. */
export interface AppEventOrchestrator {
  /** Called when the app has finished loading (components initialised). */
  appLoaded?: () => void;
  /** Called when the app reports an error to the platform. */
  appError?: (code: number, data: Record<string, string>) => void;
}

/** Auth context injected by the That Open Platform into `window.__THATOPEN_CONTEXT__`. */
export interface ThatOpenContext {
  /** This app's unique identifier. */
  appId: string;
  /** The project this app belongs to. */
  projectId: string;
  /** Auth0 JWT for API calls. */
  accessToken: string;
  /** Base URL for the That Open API. */
  apiUrl: string;
  /** Platform-to-app event callbacks. */
  appEventOrchestrator?: AppEventOrchestrator;
  /** What this app saw last time in this project, kept by the platform page (read through `client.cache`). */
  cache?: Record<string, unknown>;
  /** Keeps a value for the next time this app opens here (through `client.cache.set`). */
  cacheSet?: (key: string, value: unknown) => void;
  /** Forgets one (through `client.cache.delete`). */
  cacheDelete?: (key: string) => void;
}
