import * as BUI from "@thatopen/ui";
import type { PlatformClient } from "@thatopen/services";

/**
 * Reality captures as 3D Tiles (`.3tz`, point clouds or gaussian splats), in the document viewer beside the platform's own
 * viewers (`<top-file-viewer>.extraViewers`). They draw in a view of their own, over the scene: their library has no WebGPU, so
 * the viewer is built on its own copy of three's plain build (`src/webgl/`) and loaded the first time a `.3tz` is opened.
 */
export function threeTZViewer(client: PlatformClient) {
  const host = document.createElement("div");
  host.style.cssText = "position: absolute; inset: 0;";
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let viewer: any = null;
  return {
    extensions: ["3tz"],
    factory: () => BUI.html`${host}`,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    load: async (files: any[]) => {
      if (!viewer) {
        const { realityCaptureViewer } = await import("../webgl/reality-capture-viewer");
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        viewer = realityCaptureViewer(undefined as any, client as any);
      }
      await viewer.loadThreeTZ(String(files[0]._id), host);
    },
    remove: () => viewer?.clear(),
  };
}
