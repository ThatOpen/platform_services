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
}
