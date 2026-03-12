/** Callbacks the platform can pass to embedded apps via the context object. */
export interface AppEventOrchestrator {
  /** Called when the app has finished loading (components initialised). */
  appLoaded?: () => void;
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
}
