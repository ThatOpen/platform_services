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
// (Used inside methods only, so the cycle with history.ts, which imports this module, is harmless.)
import { ProjectHistory } from './history';

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

/**
 * Formats whose native file IS its own definitive view (the PDF rule): when
 * {@link ProjectDocuments.fromFile} converts one, the same fileId is written
 * as `native` and as `views[0]`. Deliberately NOT here: 'ifc' — its proper 3D
 * view is the processed frag, so a converted IFC without one shows "Process"
 * instead of opening a worse view.
 */
export const SELF_VIEWING_FORMATS = [
  'pdf',
  'txt',
  'md',
  'json',
  'csv',
  'tsv',
  'frag',
];

/** One listed document: the folder, and what its descriptor says. */
export interface DocumentInfo {
  /** The document folder's item id — the id interfaces know the document by. */
  folderId: string;
  descriptor: DocumentDescriptor;
}


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
   * Every document of the project: the folders that carry a descriptor.
   * Plain folders and loose files simply do not appear. One folder listing
   * for the project plus one file listing and one descriptor download per
   * folder, fetched in parallel — the storage offers nothing cheaper yet.
   */
  async list(): Promise<DocumentInfo[]> {
    // ONE listing of the project's files finds every descriptor, and each
    // says its folder. Listing each folder's files instead was one request
    // per folder, and the panels of one Coordinator load asked several
    // times: past the platform's 100 a minute with ~30 documents (429s, 13-10).
    const files = await this.client.listFiles({ projectId: this.projectId });
    const descriptors = files.filter(
      (item) => String((item as { name?: unknown }).name ?? '') === DOCUMENT_FILE,
    );
    const found = await Promise.all(
      descriptors.map(async (item) => {
        const where = item as { folderId?: unknown; parentFolderId?: unknown };
        const folderId = String(where.folderId ?? where.parentFolderId ?? '');
        if (!folderId) return null;
        const descriptor = await this.#readDescriptor(idOf(item as never));
        return descriptor ? { folderId, descriptor } : null;
      }),
    );
    return found.filter((d): d is DocumentInfo => d !== null);
  }

  /**
   * Converts a loose file into a document: creates the document folder next
   * to the file, moves the file inside (moving preserves its id), and writes
   * the descriptor with the file as `native` — and as `views[0]` too when its
   * format views itself ({@link SELF_VIEWING_FORMATS}; override per call with
   * `selfView`).
   *
   * A file that carries a processed derivative (the old `derivedFileId` link
   * in its version metadata — an IFC's frag, a LAS's potree) brings it along:
   * the derivative moves into the same folder and becomes a view, so the
   * document is born ready to visualize and the link concept retires.
   */
  async fromFile(
    fileId: string,
    options?: { name?: string; selfView?: boolean; author?: string },
  ): Promise<DocumentInfo> {
    const item = await this.client.getFile(fileId);
    const fileName = String(item.name ?? '');
    const format = formatOf(fileName, item.fileExtension);
    const name =
      options?.name ?? fileName.replace(/\.[^.]+$/, '') ?? fileName;

    const folder = await this.client.createFolder(
      name,
      item.folderId ? String(item.folderId) : undefined,
      this.projectId,
    );
    const folderId = idOf(folder as never);
    await this.client.updateFile(fileId, { parentFolderId: folderId });

    const views: DocumentView[] = [];
    const derivedId = await this.#derivedFileId(item);
    if (derivedId) {
      try {
        const derived = await this.client.getFile(derivedId);
        await this.client.updateFile(derivedId, { parentFolderId: folderId });
        views.push({
          fileId: derivedId,
          format: formatOf(String(derived.name ?? ''), derived.fileExtension),
        });
      } catch {
        // A dangling link names a file that no longer exists; the document is
        // still valid, just not visualizable until somebody processes it.
      }
    }
    const selfViews = options?.selfView ?? SELF_VIEWING_FORMATS.includes(format);
    if (selfViews) views.push({ fileId, format });

    const descriptor: DocumentDescriptor = {
      schema: DOCUMENT_SCHEMA,
      name,
      native: { fileId, format },
      views,
    };
    await this.setDescriptor(folderId, descriptor);
    // 🔴 THE HISTORY IS EXPLICIT AND STARTS HERE (Antonio, 18-10): a document made from a file is
    // born with one step, «uploaded to the platform», naming the file. Not derived later from the
    // file's versions: what happened is written when it happens.
    await this.recordUpload(folderId, { fileId, name: fileName, format }, options?.author ?? String(item.createdBy ?? ''));
    return { folderId, descriptor };
  }

  /**
   * Writes the step «uploaded to the platform» in a document's history: the first step of a
   * document made from a file ({@link fromFile} does it), and the step of each new version of the
   * file uploaded later. `author` is who uploaded it (a name, or the platform user id).
   */
  async recordUpload(
    folderId: string,
    file: { fileId: string; name: string; format?: string; versionTag?: string },
    author: string,
  ): Promise<void> {
    const doc = new ProjectHistory(this.client, this.projectId).document(folderId);
    const first = (await doc.timeline()).length === 0;
    await doc.sync({
      author: author || 'unknown',
      source: 'platform',
      kind: 'upload',
      message: first ? 'Uploaded to the platform' : 'New version uploaded',
      file: { ...file, format: file.format ?? formatOf(file.name, undefined) },
      changes: [],
    });
  }

  /**
   * The document's descriptor, read and validated, or null when the folder
   * has none yet (an old folder, or a plain folder that is not a document).
   */
  async descriptor(folderId: string): Promise<DocumentDescriptor | null> {
    const file = await this.#descriptorFile(folderId);
    if (!file) return null;
    return this.#readDescriptor(file.id);
  }

  async #readDescriptor(fileId: string): Promise<DocumentDescriptor | null> {
    const response = await this.client.downloadFile(fileId);
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
        versionTag: await this.client.nextVersionTag(existing.id),
      });
      return;
    }
    await this.client.createFile({
      file: blob,
      name: DOCUMENT_FILE,
      versionTag: 'v1',
      parentFolderId: folderId,
      projectId: this.projectId,
    });
  }

  /**
   * The document's DRAFTS: each user's working copy, kept so that closing the
   * browser never loses work. A draft is not a version — it never enters the
   * history and never shows in the CDE. See {@link DocumentDrafts}.
   */
  drafts(folderId: string): DocumentDrafts {
    return new DocumentDrafts(this.client, () => this.#descriptorFile(folderId));
  }

  /**
   * The legacy `derivedFileId` link, read from the newest version metadata
   * that carries one. Only `fromFile` looks at it, to migrate the link into
   * the folder-document shape; nothing writes it any more.
   */
  async #derivedFileId(item: {
    versions?: { tag: string; createdAt?: unknown }[];
    _id?: unknown;
    id?: unknown;
    name?: unknown;
    folderId?: unknown;
  }): Promise<string | undefined> {
    // DEV's getFile answers with no versions at all (Platform measured it, 17-10: every IFC uploaded
    // there became a document with no view). The project's listing carries them: read them there.
    let known = item.versions ?? [];
    let listed: Record<string, unknown>[] | undefined;
    if (known.length === 0) {
      listed = (await this.client.listFiles({ projectId: this.projectId }).catch(() => [])) as Record<string, unknown>[];
      const self = listed.find((one) => idOf(one as never) === idOf(item as never));
      known = (self?.versions as typeof known | undefined) ?? [];
    }
    const found = await this.#derivedFromVersions(item, known);
    if (found) return found;
    // No link at all: the processor writes the derivative beside it, with the same name. A frag of
    // that name, newer than nothing else claiming it, is the IFC's.
    const base = String(item.name ?? '').replace(/\.[^.]+$/, '').toLowerCase();
    if (!base) return undefined;
    listed ??= (await this.client.listFiles({ projectId: this.projectId }).catch(() => [])) as Record<string, unknown>[];
    const twin = listed.find((one) => {
      const name = String(one.name ?? '').toLowerCase();
      return name === `${base}.frag` && !one.archived && idOf(one as never) !== idOf(item as never);
    });
    return twin ? idOf(twin as never) : undefined;
  }

  async #derivedFromVersions(
    item: { _id?: unknown; id?: unknown },
    known: { tag: string; createdAt?: unknown }[],
  ): Promise<string | undefined> {
    const versions = [...known].sort((a, b) =>
      String(b.createdAt ?? '').localeCompare(String(a.createdAt ?? '')),
    );
    for (const version of versions) {
      try {
        const metadata = await this.client.getFileVersionMetadata(
          idOf(item),
          version.tag,
        );
        const derived = (metadata as Record<string, unknown>)?.derivedFileId;
        if (typeof derived === 'string' && derived) return derived;
      } catch {
        // A version without metadata answers an error on some backends.
      }
    }
    return undefined;
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

/** One user's draft of a document, as listed — no download involved. */
export interface DraftInfo {
  userId: string;
  /** When the server stored it: read from the hidden file's own id, not a client clock. */
  savedAt: Date;
}

/** One user's draft, downloaded. */
export interface Draft<Meta = Record<string, unknown>> extends DraftInfo {
  blob: Blob;
  /** Whatever the app put next to the bytes: base version, app, app version… */
  meta: Meta;
}

const DRAFT_TAG = 'draft:';
const DRAFT_MAGIC = 'TODRAFT1';

/**
 * A document's drafts: one working copy per user, stored as a HIDDEN file under
 * the document's `document.json`. Hidden files are what make this possible —
 * a visible file cannot be overwritten without becoming a new version, and a
 * draft written every few seconds must not fill the history or the CDE.
 *
 * Hidden files cannot be edited, so `put` uploads the new draft FIRST and then
 * deletes that user's previous ones: a failure in between leaves two, and
 * reads take the newest, never none. Every project member can read every draft;
 * each app decides whose to offer.
 */
export class DocumentDrafts {
  constructor(
    private readonly client: EngineServicesClient,
    private readonly holder: () => Promise<{ id: string } | undefined>,
  ) {}

  /** Every user's latest draft, without downloading any. Newest first. */
  async list(): Promise<DraftInfo[]> {
    const holder = await this.holder();
    if (!holder) return [];
    const latest = new Map<string, DraftInfo>();
    for (const entry of await this.#entries(holder.id)) {
      const known = latest.get(entry.userId);
      if (!known || entry.savedAt > known.savedAt)
        latest.set(entry.userId, { userId: entry.userId, savedAt: entry.savedAt });
    }
    return [...latest.values()].sort((a, b) => +b.savedAt - +a.savedAt);
  }

  /**
   * One user's draft, downloaded — or, without `userId`, the newest of anyone.
   * Null when there is none.
   */
  async get<Meta = Record<string, unknown>>(options?: {
    userId?: string;
  }): Promise<Draft<Meta> | null> {
    const holder = await this.holder();
    if (!holder) return null;
    const entries = (await this.#entries(holder.id))
      .filter((e) => !options?.userId || e.userId === options.userId)
      .sort((a, b) => +b.savedAt - +a.savedAt);
    const newest = entries[0];
    if (!newest) return null;
    const response = await this.client.downloadHiddenFile(newest.hiddenId);
    const { meta, blob } = await unwrapDraft(await response.blob());
    return { userId: newest.userId, savedAt: newest.savedAt, meta: meta as Meta, blob };
  }

  /**
   * Stores this user's draft, replacing their previous one: only the latest is
   * kept. Needs the document to have a descriptor (convert loose files first
   * with `fromFile`).
   */
  async put(
    blob: Blob,
    options: { userId: string; meta?: Record<string, unknown> },
  ): Promise<DraftInfo> {
    const holder = await this.holder();
    if (!holder) {
      throw new Error('This folder is not a document (no document.json): drafts need one.');
    }
    const tag = draftTag(options.userId);
    const previous = (await this.#entries(holder.id)).filter((e) => e.userId === options.userId);
    const created = await this.client.createHiddenFile(
      await wrapDraft(blob, options.meta ?? {}),
      holder.id,
      tag,
    );
    const hiddenId = (created as { hiddenFileId?: string }).hiddenFileId;
    if (!hiddenId) throw new Error('The draft upload answered without a hiddenFileId.');
    await this.#deleteAll(previous.map((e) => e.hiddenId));
    return { userId: options.userId, savedAt: savedAtOf(hiddenId) };
  }

  /** Deletes every draft of this user (on an explicit save, typically). */
  async delete(options: { userId: string }): Promise<void> {
    const holder = await this.holder();
    if (!holder) return;
    const mine = (await this.#entries(holder.id)).filter((e) => e.userId === options.userId);
    await this.#deleteAll(mine.map((e) => e.hiddenId));
  }

  async #entries(holderId: string) {
    const hidden = await this.client.getHiddenFilesByParent(holderId);
    return hidden
      .filter((h) => typeof h.tag === 'string' && h.tag.startsWith(DRAFT_TAG))
      .map((h) => {
        const hiddenId = String(h._id);
        return {
          hiddenId,
          userId: (h.tag as string).slice(DRAFT_TAG.length),
          savedAt: savedAtOf(hiddenId),
        };
      });
  }

  async #deleteAll(hiddenIds: string[]) {
    for (const id of hiddenIds) {
      try {
        await this.client.deleteHiddenFile(id);
      } catch {
        // A stale draft left behind is harmless: reads take the newest.
      }
    }
  }
}

/** The tag a user's draft carries: `draft:` + their id, within the 50-char tag limit. */
function draftTag(userId: string): string {
  const tag = `${DRAFT_TAG}${userId}`;
  if (!/^[A-Za-z0-9][A-Za-z0-9:._-]{0,49}$/.test(tag)) {
    throw new Error(`A draft cannot be tagged for user "${userId}": ids must be letters, digits or :._- and short.`);
  }
  return tag;
}

/** A Mongo ObjectId's first 4 bytes are its creation time, in seconds. */
function savedAtOf(objectId: string): Date {
  const seconds = parseInt(objectId.slice(0, 8), 16);
  return new Date(Number.isFinite(seconds) ? seconds * 1000 : 0);
}

/** `TODRAFT1` + 4-byte little-endian meta length + meta JSON + the app's bytes. */
async function wrapDraft(blob: Blob, meta: Record<string, unknown>): Promise<Blob> {
  const metaBytes = new TextEncoder().encode(JSON.stringify(meta));
  const length = new Uint8Array(4);
  new DataView(length.buffer).setUint32(0, metaBytes.length, true);
  return new Blob([new TextEncoder().encode(DRAFT_MAGIC), length, metaBytes, blob]);
}

async function unwrapDraft(blob: Blob): Promise<{ meta: unknown; blob: Blob }> {
  const head = new Uint8Array(await blob.slice(0, DRAFT_MAGIC.length + 4).arrayBuffer());
  if (new TextDecoder().decode(head.slice(0, DRAFT_MAGIC.length)) !== DRAFT_MAGIC) {
    return { meta: {}, blob };
  }
  const length = new DataView(head.buffer).getUint32(DRAFT_MAGIC.length, true);
  const start = DRAFT_MAGIC.length + 4;
  const metaText = await blob.slice(start, start + length).text();
  let meta: unknown = {};
  try {
    meta = JSON.parse(metaText);
  } catch {
    // Unreadable meta costs the meta, never the bytes.
  }
  return { meta, blob: blob.slice(start + length) };
}

/** The lowercase, dot-less format a file's name declares. */
function formatOf(fileName: string, extension?: string): string {
  const fromExt = (extension ?? '').replace(/^\./, '').toLowerCase();
  if (fromExt) return fromExt;
  const dot = fileName.lastIndexOf('.');
  return dot > 0 ? fileName.slice(dot + 1).toLowerCase() : '';
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
