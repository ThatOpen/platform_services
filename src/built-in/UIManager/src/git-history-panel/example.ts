/* MD
  ## git-history-panel
  ---
  `top-git-history` is a GitKraken-style commit timeline for the **revit-flow**
  feature. It lists the commits pushed by the Revit add-in (newest first) and,
  when you click a commit, drives the shared 3D viewer to color that commit's
  changed elements — created green, modified blue, deleted red — on the loaded
  baseline model.

  All viewer mutation lives in the headless `GitHistoryManager`; the panel is
  intent-only. Mounting it is a single line of markup once `UIManager` and
  `GitHistoryManager` are in the setup call.
*/

import { html } from "lit";
import * as THREE from "three";
import * as OBC from "@thatopen/components";
import * as OBF from "@thatopen/components-front";
import * as FRAGS from "@thatopen/fragments";
import * as BUI from "@thatopen/ui";
import { PlatformClient, UIManager, GitHistoryManager } from "@thatopen/services";
import type { App } from "../app/index";


const client = PlatformClient.fromPlatformContext();

const { components } = (await client.setup(
  { OBC, OBF, BUI, THREE, FRAGS },
  { uuid: UIManager.uuid },
  { uuid: GitHistoryManager.uuid },
)) as { components: OBC.Components };

components.get(UIManager).init();

// The panel self-wires init(client) on connect, but calling it here keeps the
// timeline populated before the panel mounts.
await components.get(GitHistoryManager).init(client);

const app = document.createElement("top-app") as unknown as App;

app.setup = (waitUntil) => {
  waitUntil(
    (async () => {
      const fragments = components.get(OBC.FragmentsManager);
      const workerUrl = await FRAGS.FragmentsModels.getWorker();
      fragments.init(await FRAGS.toClassicWorker(workerUrl), { classicWorker: true });
    })(),
    "Fragments Core",
  );
  return { components, client };
};

app.elements = {
  viewer: () => html`<top-viewer><top-viewer-tools></top-viewer-tools></top-viewer>`,
  history: () => html`<top-git-history></top-git-history>`,
};

app.layouts = {
  main: {
    label: "Main",
    icon: "solar:branching-paths-up-bold",
    template: `"viewer history" 1fr / 1fr 24rem`,
  },
};

app.layout = "main";

const container = document.getElementById("that-open-app") ?? document.body;
container.appendChild(app);
document.body.style.margin = "0";
