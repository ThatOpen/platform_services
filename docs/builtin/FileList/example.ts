import * as OBC from "@thatopen/components";
import * as BUI from "@thatopen/ui";
import type { EngineServicesClient, Item } from "thatopen-services";

import appManagerDef from "../AppManager/index";
import fileListDef from "./index";

const AppManager = appManagerDef.componentDefinition;
const FileList = fileListDef.componentDefinition;

// ── A tiny in-memory fake client for the example ──────────────────────
// Real apps should pass their `EngineServicesClient` instance here — this
// stub just implements the subset of the API the FileList component uses.

let nextId = 1;
const mkFile = (name: string, ext?: string): Item => ({
  _id: `file-${nextId++}`,
  name,
  fileExtension: ext,
  itemType: "FILE",
  internalId: `internal-${nextId}`,
  createdAt: new Date(),
  creatingUser: "demo-user",
});

const files: Item[] = [
  mkFile("site-plan", "pdf"),
  mkFile("structural-model", "ifc"),
  mkFile("mep-coordination", "ifc"),
  mkFile("bcf-issues", "bcf"),
];

const fakeClient = {
  async listFiles() {
    // Small delay to show the loading state.
    await new Promise((r) => setTimeout(r, 150));
    return files.filter((f) => !f.archived);
  },
  async downloadFile(id: string) {
    const file = files.find((f) => f._id === id)!;
    const body = `Pretend contents of ${file.name}`;
    return new Response(body, { headers: { "Content-Type": "text/plain" } });
  },
  async updateFile(id: string, data: { name?: string }) {
    const file = files.find((f) => f._id === id)!;
    if (data.name) file.name = data.name;
    return { item: file };
  },
  async archiveFile(id: string) {
    const file = files.find((f) => f._id === id)!;
    file.archived = true;
    return file;
  },
} as unknown as EngineServicesClient;

// ── App type ──────────────────────────────────────────────────────────

type FilesState = { components: OBC.Components };

interface FileListApp {
  icons: ["FILES"];
  grid: BUI.Grid<
    ["Files"],
    [{ name: "files"; state: FilesState }]
  >;
}

// ── Initialise OBC & BUI ──────────────────────────────────────────────

BUI.Manager.init();
const components = new OBC.Components();

const app = components.get(AppManager<FileListApp>);
const fileList = components.get(FileList);

// ── Create a file list instance ───────────────────────────────────────

const { element: fileListElement } = fileList.create({ client: fakeClient });

const filesPanel: BUI.StatefullComponent<FilesState> = (_state) => BUI.html`
  <bim-panel active label="Files" style="display: flex; flex-direction: column;">
    <bim-panel-section label="Project files" style="flex: 1; min-height: 0;">
      ${fileListElement}
    </bim-panel-section>
  </bim-panel>
`;

// ── Init ──────────────────────────────────────────────────────────────

app.init({
  icons: { FILES: "mdi:file-multiple" },
  grid: (grid) => {
    grid.elements = {
      files: { template: filesPanel, initialState: { components } },
    };
    grid.layouts = {
      Files: {
        template: `"files" 1fr / 1fr`,
        icon: app.icons.FILES,
      },
    };
    grid.layout = "Files";
  },
  container: document.getElementById("container")!,
});

components.init();
