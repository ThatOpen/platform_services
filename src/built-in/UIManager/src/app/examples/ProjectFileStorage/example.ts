/* MD
  ## Persisting project-scoped data with projectStorageContext
  ---
  Most non-trivial apps built on top-app eventually need to persist some of
  their own data inside the project — user preferences, cached results,
  domain state that isn't a 3D model or a regular CDE file. The naive
  approach is for each panel/manager to talk to the CDE client directly:
  resolve or create a folder under `__project_data`, resolve or create the
  file, decide between uploading a new file and versioning an existing one.
  That's the same handful of steps every single consumer ends up
  re-implementing.

  top-app centralizes exactly that plumbing behind `projectStorageContext`, a
  `@lit/context` value any descendant can `@consume`. It provides a small,
  stable service object — not reactive state, since `save`/`flush` are
  actions, not values to observe:

  ```ts
  interface ProjectStorage {
    save(path: string, blob: Blob): void;   // debounced (~2s), per path
    flush(): Promise<void>;                 // cancel debounces, save everything NOW, await it
  }
  ```

  `path` is resolved under `__project_data/`. Calling `save` schedules a
  debounced upload — top-app creates whichever folders in the path don't
  exist yet, creates the file the first time, and versions it (no explicit
  `versionTag` needed — the backend assigns the next one) every time after.
  Saves are debounced *per path*, so unrelated consumers saving around the
  same time don't reset each other's timers, and a small floating indicator
  (bottom-right, so it doesn't rely on the sidebar, which is optional and can
  be hidden) reflects both phases distinctly: just the icon, no background/
  border, while a save is debouncing (nothing to tell the user yet — it's
  still waiting to see if more changes come in), and the full "Saving..."
  pill once an upload is actually in flight. Each consumer only ever decides
  *what* to save and *where* — never the CDE mechanics, nor the indicator.

  Use `flush()` whenever you're about to do something that would conflict
  with a save still in flight — e.g. triggering a cloud job that reads the
  same file you just edited. It cancels any pending debounce, starts the
  upload right away, and its returned promise resolves only once that
  upload has actually finished.

  By the end, you'll have a tiny "project notes" panel that autosaves free
  text to `__project_data/notes/notes.json`, plus a "Save now" button that
  demonstrates `flush()`.
*/

import { html, LitElement } from "lit";
import { customElement, state } from "lit/decorators.js";
import { consume } from "@lit/context";
import * as THREE from "three";
import * as OBC from "@thatopen/components";
import * as OBF from "@thatopen/components-front";
import * as FRAGS from "@thatopen/fragments";
import * as BUI from "@thatopen/ui";
import { PlatformClient, UIManager } from "@thatopen/services";
import type { App } from "../../index";
import { projectStorageContext, type ProjectStorage } from "../../src/context";

// The path is always relative to `__project_data/` — top-app creates
// whichever folders in it don't exist yet.
const NOTES_PATH = "notes/notes.json";

function notesBlob(text: string): Blob {
  return new Blob([JSON.stringify({ text, savedAt: new Date().toISOString() })], {
    type: "application/json",
  });
}

@customElement("notes-panel")
class NotesPanel extends LitElement {
  @consume({ context: projectStorageContext })
  private _storage?: ProjectStorage;

  @state() private _text = "";
  @state() private _flushing = false;

  render() {
    return html`
      <bim-panel label="Project Notes">
        <bim-panel-section label="Notes" icon="tabler:notes">
          <bim-text-input
            vertical
            type="area"
            label="Note"
            placeholder="Type something — autosaves as you go"
            .value=${this._text}
            @input=${(e: Event) => {
              this._text = (e.target as HTMLInputElement).value ?? "";
              // Debounced — top-app coalesces rapid edits into one upload.
              this._storage?.save(NOTES_PATH, notesBlob(this._text));
            }}
          ></bim-text-input>
          <bim-button
            label="Save now"
            icon="tabler:cloud-upload"
            .loading=${this._flushing}
            @click=${async () => {
              // Same blob, but flush() cancels the debounce and waits for
              // the upload to actually finish before this resolves.
              this._storage?.save(NOTES_PATH, notesBlob(this._text));
              this._flushing = true;
              await this._storage?.flush();
              this._flushing = false;
            }}
          ></bim-button>
        </bim-panel-section>
      </bim-panel>
    `;
  }
}

// ---- app wiring ----

const client = PlatformClient.fromPlatformContext();
const { components } = (await client.setup(
  { OBC, OBF, BUI, THREE, FRAGS },
  { uuid: UIManager.uuid },
)) as { components: OBC.Components };
components.get(UIManager).init();

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
  panel: () => html`<notes-panel></notes-panel>`,
};

app.base = "viewer";
app.layouts = {
  main: { label: "Main", icon: "solar:home-bold", template: `"panel" 1fr / 22rem` },
};
app.layout = "main";

const container = document.getElementById("that-open-app") ?? document.body;
container.appendChild(app);
document.body.style.margin = "0";
