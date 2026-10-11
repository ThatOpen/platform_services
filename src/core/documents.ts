/**
 * Documents: the platform's unit of content.
 *
 * EVERY DOCUMENT IS A FOLDER. A "file" a person sees in the CDE — a PDF, a
 * Revit model, a point cloud — is stored as a folder holding one or more
 * actual files, plus a small descriptor (`document.json`) that says which file
 * is the document's NATIVE form and which files are its VIEWS (the
 * representations a viewer can render). The folder is an internal storage
 * detail: interfaces present the document as a single row and apply move,
 * rename, delete and permissions to the whole folder.
 *
 * READY TO VISUALIZE is the only rule a viewer needs: a document is viewable
 * when its descriptor lists a view in a format the viewer can render. There
 * is no "derived file" or "linked file" concept — a format that cannot be
 * rendered directly gets PROCESSED, and the processor's last act is
 * {@link ProjectDocuments.addView}. A document whose native format views
 * itself (a PDF, an IFC a viewer renders directly) lists the SAME fileId as
 * both `native` and a view; nothing is deduced from extensions.
 *
 * Plain files still exist: anything uploaded outside this shape simply has no
 * descriptor ({@link ProjectDocuments.descriptor} returns null) and is more
 * limited — interfaces may offer to convert it into a document.
 */
import type { EngineServicesClient } from './client';

/** One renderable representation of a document. */
export interface DocumentView {
  /** The view file's item id — ids survive renames, names do not. */
  fileId: string;
  /** Lowercase format name: 'frag', 'ifc', 'potree', 'pdf'… */
  format: string;
}

/** The wire shape of `document.json`, schema `thatopen/document@1`. */
export interface DocumentDescriptor {
  schema: typeof DOCUMENT_SCHEMA;
  /** The document's own name — what a row shows. Not any file's name. */
  name: string;
  /**
   * The native form, when the document has one (a .rvt, a .3dm). A document
   * born on the platform (a loose .frag) may not.
   */
  native?: { fileId: string; format: string };
  /** The renderable representations, in no particular order. */
  views: DocumentView[];
}

export const DOCUMENT_SCHEMA = 'thatopen/document@1';
export const DOCUMENT_FILE = 'document.json';

const versionTag = () => `v-${Date.now()}`;

function idOf(item: { _id?: unknown; id?: unknown }): string {
  return String(item._id ?? item.id ?? '');
}

/**
 * Documents of one project. Get it from {@link EngineServicesClient.documents}.
 * Every method takes the document's FOLDER id — the id interfaces know the
 * document by.
 */
export class ProjectDocuments {
  constructor(
    private readonly client: EngineServicesClient,
    readonly projectId: string,
  ) {}

  /**
   * The document's descriptor, read and validated, or null when the folder
   * has none yet (an old folder, or a plain folder that is not a document).
   */
  async descriptor(folderId: string): Promise<DocumentDescriptor | null> {
    const file = await this.#descriptorFile(folderId);
    if (!file) return null;
    const response = await this.client.downloadFile(file.id);
    const text = await response.text();
    if (!text.trim()) return null;
    let parsed: unknown;
    try {
      parsed = JSON.parse(text);
    } catch {
      return null;
    }
    return normalize(parsed);
  }

  /**
   * The first view whose format appears in `formats` — searched in the ORDER
   * OF THE LIST, so the caller's preference wins (ask `['frag', 'ifc']` and a
   * document carrying both answers the frag). Null when none matches: that is
   * where an interface offers "Process".
   */
  async view(
    folderId: string,
    formats: string[],
  ): Promise<DocumentView | null> {
    const descriptor = await this.descriptor(folderId);
    if (!descriptor) return null;
    for (const format of formats) {
      const match = descriptor.views.find((v) => v.format === format);
      if (match) return match;
    }
    return null;
  }

  /**
   * Registers a renderable representation — a processor's last act. One view
   * per format: an existing view of the same format is replaced (a re-run
   * processor updates, it does not accumulate). The descriptor must exist;
   * create it first with {@link setDescriptor}.
   */
  async addView(folderId: string, view: DocumentView): Promise<void> {
    const descriptor = await this.descriptor(folderId);
    if (!descriptor) {
      throw new Error(
        'This folder has no document descriptor yet: call setDescriptor first.',
      );
    }
    descriptor.views = [
      ...descriptor.views.filter((v) => v.format !== view.format),
      view,
    ];
    await this.setDescriptor(folderId, descriptor);
  }

  /** Writes the descriptor, creating or replacing `document.json`. */
  async setDescriptor(
    folderId: string,
    descriptor: Omit<DocumentDescriptor, 'schema'> &
      Partial<Pick<DocumentDescriptor, 'schema'>>,
  ): Promise<void> {
    const value: DocumentDescriptor = {
      ...descriptor,
      schema: DOCUMENT_SCHEMA,
      views: descriptor.views ?? [],
    };
    const blob = new Blob([JSON.stringify(value)], {
      type: 'application/json',
    });
    const existing = await this.#descriptorFile(folderId);
    if (existing) {
      await this.client.updateFile(existing.id, {
        file: blob,
        versionTag: versionTag(),
      });
      return;
    }
    await this.client.createFile({
      file: blob,
      name: DOCUMENT_FILE,
      versionTag: versionTag(),
      parentFolderId: folderId,
      projectId: this.projectId,
    });
  }

  async #descriptorFile(
    folderId: string,
  ): Promise<{ id: string } | undefined> {
    const items = await this.client.listFiles({ folderId });
    const found = items.find(
      (item) => String((item as { name?: unknown }).name ?? '') === DOCUMENT_FILE,
    );
    return found ? { id: idOf(found as never) } : undefined;
  }
}

/** Accepts only a shape that really is a descriptor; null otherwise. */
function normalize(parsed: unknown): DocumentDescriptor | null {
  if (!parsed || typeof parsed !== 'object') return null;
  const raw = parsed as Record<string, unknown>;
  if (raw.schema !== DOCUMENT_SCHEMA) return null;
  if (typeof raw.name !== 'string') return null;
  const views = Array.isArray(raw.views)
    ? raw.views.filter(
        (v): v is DocumentView =>
          !!v &&
          typeof v === 'object' &&
          typeof (v as DocumentView).fileId === 'string' &&
          typeof (v as DocumentView).format === 'string',
      )
    : [];
  const native = raw.native as DocumentDescriptor['native'];
  const hasNative =
    !!native &&
    typeof native === 'object' &&
    typeof native.fileId === 'string' &&
    typeof native.format === 'string';
  return {
    schema: DOCUMENT_SCHEMA,
    name: raw.name,
    ...(hasNative ? { native: { fileId: native.fileId, format: native.format } } : {}),
    views,
  };
}
