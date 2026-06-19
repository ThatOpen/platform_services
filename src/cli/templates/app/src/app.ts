import { PlatformClient, ProjectData } from "@thatopen/services";

// ─── A2 migration shim ───────────────────────────────────────────────────────
// Pre-A2 the platform `AppManager` built-in held the platform `client` +
// `projectData`, reached via `components.get(AppManager)`. Juan removed
// AppManager (consolidated into UIManager / top-app). top-app now owns that
// state and exposes it via lit contexts — but a few non-lit call sites
// (CloudRunner, data-table-panel, app-info-section) just need `.client` /
// `.projectData` synchronously. This tiny module holds them, set once from
// main.ts, and keeps `getAppManager(...)` returning the same `{ client,
// projectData }` shape those call sites expect.

let _client: PlatformClient | undefined;
let _projectData: ProjectData | undefined;

/** Called once from main.ts after the platform client (and projectData) exist. */
export const setAppContext = (
  client: PlatformClient,
  projectData?: ProjectData,
) => {
  _client = client;
  _projectData = projectData;
};

/**
 * Back-compat accessor mirroring the old `components.get(AppManager)` surface
 * the remaining call sites use (`.client` / `.projectData`). The `components`
 * arg is ignored — kept only for signature compatibility with existing callers.
 */
export const getAppManager = (_components?: unknown) => ({
  get client() {
    return _client;
  },
  get projectData() {
    return _projectData;
  },
});
