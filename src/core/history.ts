/**
 * The history API: documents and their versions, with the flow storage
 * encapsulated.
 *
 * The vocabulary is deliberately small and BIM-shaped:
 * - A DOC is a connected native document (a Revit model, an AutoCAD drawing).
 * - A VERSION is one step of it: who, when, what changed. A sync of the
 *   native application, a file uploaded to the platform, or a recipe applied
 *   in the native application ({@link FlowOrigin} says which recipe, and
 *   which source at which version, it came from). There are no proposals:
 *   a recipe is applied in the native application at once (19-10).
 *
 * EVERYTHING BELOW THIS SURFACE IS PRIVATE. Today the data lives as plain
 * project files (the `bimterop` folder, `revitflow_history.json`, hidden
 * deltas) written by the flow plugins — see
 * PROTOCOL.md in the flow repo. This module is the ONLY place in consumer
 * code allowed to know that: when the platform grows a first-class history
 * API, or the layout moves into hidden storage, this file changes and its
 * callers do not.
 *
 * KNOWN LIMIT, deliberate: appending re-uploads the whole history file, and
 * the backend has no compare-and-swap, so two writers syncing the same doc at
 * the same instant can lose one version silently. `sync` narrows the window
 * by re-reading right before it writes and refusing when the head moved
 * (StaleHistoryError), but only a server-side append can close it. That is
 * the agreed phase 2.
 */
import type { EngineServicesClient } from './client';
import { ProjectDocuments, type DocumentDescriptor, type DocumentView } from './documents';

/** One element mutation inside a version. Wire-compatible with the plugins. */
export interface FlowChange {
  /** create | update | delete. */
  type: 'create' | 'update' | 'delete' | string;
  /** The native application's own id for the element (Revit UniqueId, AutoCAD handle). */
  uniqueId: string;
}

/** Per-version change tallies. */
export interface FlowCounts {
  added: number;
  modified: number;
  removed: number;
}

/**
 * One sync of a document. Field names are the wire format the plugins write
 * (`revitflow_history.json`); do not rename them.
 */
export interface FlowVersion {
  /** Identity, minted by the writer. */
  guid: string;
  /** The versions this one was built on; absent on a root. First entry is the continued line. */
  parents?: string[] | null;
  /** The CDE's storage version number, when there is one. Data, never identity. */
  version?: number;
  /** What the author said it was for, when they said anything. */
  message?: string;
  author: string;
  /** Which application wrote it: 'revit', 'autocad', 'rhino'… */
  source: string;
  /** ISO UTC. */
  timestamp: string;
  changes: FlowChange[];
  counts: FlowCounts;
  /** Hidden-file id of the delta .frag; absent on the baseline and geometry-less versions. */
  deltaId?: string;
  /** Hidden-file id of the same delta as a STREAMED bundle (TOSTRM1, `format: 'tostrm'`): what the viewer opens,
   * streaming being the default (21-10). Absent where `deltaId` is, and on versions written before it existed. */
  streamId?: string;
  /** Hidden-file id of the per-element geometry fingerprints, when the writer keeps them. */
  geomId?: string;
  /** Platform user id of the committer, when the writer knew it. */
  userId?: string;
  /** This version re-exported the whole model (the visible .frag shows it as of here). */
  full?: boolean;
  compact?: boolean;
  /**
   * What kind of step it was, when it was not a plain sync of a native application: 'upload' is a
   * file brought to the platform (the first step of every document made from a file, Antonio 18-10:
   * «el histórico siempre explícito: al subir un archivo y crear un documento, se crea el histórico
   * con un primer paso que es subir el documento a la plataforma»); 'recipe' is a sync whose
   * changes include a recipe applied in the native application ({@link origin} says which).
   * Absent: a sync.
   */
  kind?: 'upload' | 'sync' | 'recipe' | 'restore' | string;
  /** On a 'restore' (Revit's That Open > History > Restore this version): the version it went back to. */
  restoredFrom?: { guid: string; version: number };
  /** The file the step brought, on an upload: its id, name and the storage version it landed in. */
  file?: FlowFile;
  /** Where the step came from, when a recipe made it: see {@link FlowOrigin}. */
  origin?: FlowOrigin;
  /** Every recipe applied since the previous step, when more than one was (the first is `origin`). */
  origins?: FlowOrigin[];
  /** Position in the timeline, derived from the parent graph when read. Never stored. */
  ordinal?: number;
}

/** A file a version brought to the platform. */
export interface FlowFile {
  fileId: string;
  name: string;
  /** Lowercase format: 'ifc', 'rvt', 'pdf'… */
  format?: string;
  /** The storage version it landed in, when known. */
  versionTag?: string;
}

/**
 * Where a version came from when a recipe made it: the recipe applied and the exact source it
 * read, so the history says which IFC, at which version, the changes were built from. Agreed with
 * the platform, 18-10.
 */
export interface FlowOrigin {
  /** The recipe's name. */
  recipe: string;
  /** The version of a project's own recipe that made it ('v3'); absent for a built-in. */
  recipeVersion?: string;
  source: {
    /** The source document's folder. */
    folderId: string;
    fileId: string;
    /** The source file's name, as it was then. */
    name?: string;
    /** The file's storage version the recipe read. */
    version: string;
  };
  /** What it wrote, in a line: «IFC to Revit: 12 wall(s), 3 floor(s)». */
  title?: string;
  /** The settings it ran with, as the person chose them. */
  settings?: Record<string, unknown>;
  /** The recipe's name for people ("IFC to Revit"). */
  recipeTitle?: string;
}

/** Wire shape of `revitflow_history.json`. */
interface FlowHistoryFile {
  model: string;
  commits: FlowVersion[];
}

/** A connected document, as listed from the project. */
export interface FlowDocInfo {
  /** The native application that owns it: 'revit', 'autocad'… */
  source: string;
  /** The document's own id within that application. */
  docId: string;
  /**
   * The document folder's item id — the id the CDE and the documents API
   * ({@link EngineServicesClient.documents}) know this document by.
   */
  folderId: string;
  /** The visible model file's name, when one exists yet. */
  modelName?: string;
  /**
   * True when the folder exists but holds neither history nor model — a
   * document somebody connected and never synced (a
   * plugin mid-first-publish, or an abandoned start). A legitimate state,
   * listed rather than hidden; apps decide whether to show it dimmed.
   */
  empty?: boolean;
}

/**
 * One person's current hold on a document's elements, read from the lock
 * registry the native plugins arbitrate through. Element keys are the native
 * application's own ids (Revit UniqueIds). Workset-level ownership lives in
 * Revit's own binary worksharing files (the ownership mirror) and is not
 * readable here — what IS here is every element-level claim.
 */
export interface FlowOwner {
  /** The native application's user name, as the plugin claimed with. */
  owner: string;
  /** The element keys this person currently holds, arbitration applied. */
  elements: string[];
}

/**
 * The ordered recipe {@link FlowDoc.modelParts} answers: a baseline plus the
 * steps that bring it to the asked version. See that method for the
 * composition rule.
 */
export interface FlowModelParts {
  baseline: {
    /** The visible model file. */
    fileId: string;
    /** The version whose full export it is. */
    guid: string;
    /**
     * True when the visible file's CURRENT content is this baseline. False
     * when a later publish rewrote it — then download the file at
     * `storageVersion` (when recorded) instead of its head.
     */
    current: boolean;
    /** The CDE storage version the baseline landed in, when the history recorded it. */
    storageVersion?: number;
  };
  /** One per version after the baseline, oldest first. */
  steps: {
    guid: string;
    /** Hidden-file id of the delta .frag; absent on geometry-less versions. */
    deltaId?: string;
    /** Hidden-file id of its streamed bundle (see {@link FlowVersion.streamId}). */
    streamId?: string;
    /** Elements this version removed, by the native app's own stable ids. */
    removedUniqueIds: string[];
  }[];
  /** The version the recipe reaches (the asked one, or the head). */
  at: string;
}

/** What `sync` needs: the change list plus whatever the writer knows. */
export interface SyncInput {
  author: string;
  /** Which application/tool is writing: 'revit', 'rhino', 'recipe'… */
  source: string;
  changes: FlowChange[];
  message?: string;
  /** Delta geometry for this version, uploaded as a hidden file. */
  delta?: Blob;
  /** Re-upload of the whole model; marks the version `full`. */
  model?: Blob;
  /** Platform user id, when known. */
  userId?: string;
  /** What kind of step it is, when not a plain sync ('upload', 'recipe'). */
  kind?: FlowVersion['kind'];
  /** The file an upload brought. */
  file?: FlowFile;
  /** Where it came from, when a recipe made it. */
  origin?: FlowOrigin;
  origins?: FlowOrigin[];
  /**
   * The head you built on. When given and the stored head differs, `sync`
   * refuses with {@link StaleHistoryError} instead of forking silently.
   */
  expectedLatestGuid?: string;
}

/** The head moved while a writer prepared its version. Re-read and retry. */
export class StaleHistoryError extends Error {
  constructor(
    readonly expectedGuid: string,
    readonly actualGuid: string | undefined,
  ) {
    super(
      'The document history advanced while this version was being prepared: ' +
        `expected head ${expectedGuid}, found ${actualGuid ?? 'none'}. ` +
        'Read the timeline again and rebuild on the new head.',
    );
    this.name = 'StaleHistoryError';
  }
}

// ─── The storage layout, stated once ─────────────────────────────────────────
// PROTOCOL.md §1: project → `bimterop` → `<source>-<docId>` → files.
const ROOT_FOLDER = 'bimterop';
const HISTORY_FILE = 'revitflow_history.json';
const LEGACY_MODEL_FILE = 'revitflow_model.frag';
// Internal bookkeeping files that are NOT the model.
const INTERNAL_PREFIX = 'revitflow_';
// The element-lock anchor: a visible file in the doc folder whose HIDDEN
// children are live claims ({ revitflowlock: 1, user, keys[], since }), one
// per client. Arbitration is listing order: the earliest claim naming a key
// holds it. Written by the plugins' LockRegistry; read-only here.
const LOCKS_ANCHOR = 'bimterop-locks-anchor';

interface StoredFile {
  id: string;
  name: string;
}

/**
 * Only the folders whose parent IS `parentId`. Needed on top of the query
 * filter because the backend ignores an unknown `parentFolderId` and answers
 * with every folder of the project.
 */
function childrenOf<T extends { parentId?: unknown }>(
  folders: T[],
  parentId: string,
): T[] {
  return folders.filter((f) => String(f.parentId ?? '') === parentId);
}

/**
 * The id `createHiddenFile` answered with. Refuses rather than stringifying a
 * missing field: a written `"undefined"` is a pointer the native plugins then
 * try to download, and they fail far from the cause.
 */
function hiddenIdOf(created: { hiddenFileId?: unknown }): string {
  const id = created?.hiddenFileId;
  if (typeof id !== 'string' || !id) {
    throw new Error('The hidden-file upload answered without a hiddenFileId.');
  }
  return id;
}

/** Normalizes the `_id`/`id` split the item endpoints disagree on. */
function idOf(item: { _id?: unknown; id?: unknown }): string {
  return String(item._id ?? item.id ?? '');
}

/**
 * The history of one project. Get it from {@link EngineServicesClient.history}.
 */
export class ProjectHistory {
  #rootFolderId?: string;

  constructor(
    private readonly client: EngineServicesClient,
    readonly projectId: string,
  ) {}

  /** The project's connected documents. */
  async docs(): Promise<FlowDocInfo[]> {
    const root = await this.#root();
    if (!root) return [];
    // Filtered as well as queried (in childFolders): the backend ignores an
    // unknown `parentFolderId` filter and answers with EVERY folder of the
    // project, which made any project folder with a dash look like a doc.
    const folders = await this.childFolders(root, true);
    const docs: FlowDocInfo[] = [];
    for (const folder of folders) {
      // An archived document is gone from the project (it can be recovered, but nobody works on it):
      // listed, it stayed a recipe's target (Antonio, 18-10).
      if ((folder as { archived?: unknown }).archived) continue;
      const name = String(folder.name ?? '');
      const dash = name.indexOf('-');
      if (dash <= 0) continue;
      // One listing per doc, so the caller can tell a live document from a
      // never-synced shell without fetching anything else.
      const files = await this.client.listFiles({
        folderId: idOf(folder as never),
      });
      const names = files.map((f) =>
        String((f as { name?: unknown }).name ?? ''),
      );
      const model =
        names.find((n) => n === LEGACY_MODEL_FILE) ??
        names.find(
          (n) => n.endsWith('.frag') && !n.startsWith(INTERNAL_PREFIX),
        );
      const hasAny =
        names.includes(HISTORY_FILE) || !!model;
      docs.push({
        source: name.slice(0, dash),
        docId: name.slice(dash + 1),
        folderId: idOf(folder as never),
        modelName: model,
        ...(hasAny ? {} : { empty: true }),
      });
    }
    return docs;
  }

  /**
   * One document's history. `source` and `docId` as {@link docs} lists them.
   * The same object for the same document, so what it has found once (its
   * folder) it does not ask for again.
   */
  doc(source: string, docId: string): FlowDoc {
    const key = `${source}-${docId}`;
    let doc = this.#docs.get(key);
    if (!doc) {
      doc = new FlowDoc(this.client, this, source, docId);
      this.#docs.set(key, doc);
    }
    return doc;
  }

  /**
   * The history of a document of the platform's own (a folder with its `document.json`, made from
   * an uploaded file), kept in the document's folder itself. Its source is 'platform' and its id
   * the folder's.
   */
  document(folderId: string): FlowDoc {
    const key = `platform-${folderId}`;
    let doc = this.#docs.get(key);
    if (!doc) {
      doc = new FlowDoc(this.client, this, 'platform', folderId, folderId);
      this.#docs.set(key, doc);
    }
    return doc;
  }

  #docs = new Map<string, FlowDoc>();
  #children?: Promise<Awaited<ReturnType<EngineServicesClient['listFolders']>>>;
  #childrenAt = 0;

  /**
   * @internal The documents' folders (the root's children), listed ONCE and
   * shared by every document. Each document listing them for itself was ~150
   * requests on one Coordinator load with ~30 documents, and the platform
   * answers 429 past 100 a minute: the app then showed no Revit document and
   * a queued request never arrived (13-10). Listed again after 30 s, when a
   * folder is made, or when asked `fresh`.
   */
  async childFolders(rootId: string, fresh = false) {
    if (fresh || !this.#children || Date.now() - this.#childrenAt > 30_000) {
      this.#childrenAt = Date.now();
      this.#children = this.client
        .listFolders({ parentFolderId: rootId, projectId: this.projectId })
        .then((folders) => childrenOf(folders, rootId));
      this.#children.catch(() => {
        this.#children = undefined;
      });
    }
    return this.#children;
  }

  /** @internal A folder was made: the next {@link childFolders} lists again. */
  forgetFolders(): void {
    this.#children = undefined;
  }

  /** @internal The `bimterop` folder id, resolved once. */
  async rootFolderId(create = false): Promise<string | undefined> {
    if (this.#rootFolderId) return this.#rootFolderId;
    const found = await this.#root();
    if (found) return found;
    if (!create) return undefined;
    const made = await this.client.createFolder(
      ROOT_FOLDER,
      undefined,
      this.projectId,
    );
    this.#rootFolderId = idOf(made as never);
    return this.#rootFolderId;
  }

  async #root(): Promise<string | undefined> {
    if (this.#rootFolderId) return this.#rootFolderId;
    const folders = await this.client.listFolders({
      projectId: this.projectId,
    });
    const root = folders.find(
      (f) => String(f.name ?? '') === ROOT_FOLDER && !f.parentId,
    );
    if (root) this.#rootFolderId = idOf(root as never);
    return this.#rootFolderId;
  }
}

/**
 * One connected document: its timeline and its model.
 */
export class FlowDoc {
  #folderId?: string;

  constructor(
    private readonly client: EngineServicesClient,
    private readonly project: ProjectHistory,
    readonly source: string,
    readonly docId: string,
    /** The folder, when it is known and not found by name under `bimterop` (a platform document). */
    folderId?: string,
  ) {
    this.#folderId = folderId;
  }

  // ─── Reading ───────────────────────────────────────────────────────────────

  /**
   * The document's versions, oldest first, ordered by the parent graph (not
   * by array position, which concurrent writers do not keep meaningful).
   * Each version gets its `ordinal` filled in.
   */
  async timeline(): Promise<FlowVersion[]> {
    const history = await this.#readHistory();
    return orderByGraph(history?.commits ?? []);
  }

  /** The head of the timeline, or null before the first sync. */
  async latest(): Promise<FlowVersion | null> {
    const timeline = await this.timeline();
    return timeline.length ? timeline[timeline.length - 1] : null;
  }

  /**
   * A version's delta geometry as a .frag. The baseline (`full`) versions have
   * no delta: their geometry IS the model file — use {@link model}.
   */
  async delta(version: FlowVersion): Promise<Blob> {
    if (!version.deltaId) {
      throw new Error(
        `Version ${version.guid} carries no delta: it is a full export — read model() instead.`,
      );
    }
    const response = await this.client.downloadHiddenFile(version.deltaId);
    return await response.blob();
  }

  /**
   * The visible model .frag AS LAST FULLY EXPORTED — the first commit, or the
   * last explicit publish. Ordinary syncs only add hidden deltas, so this is
   * NOT necessarily the head: anything computed on it (a clash run) is as of
   * the last `full: true` version. For the model at a specific version, read
   * {@link modelParts} and compose.
   */
  async model(): Promise<Blob> {
    const file = await this.#modelFile();
    if (!file) {
      throw new Error(
        `Document ${this.source}-${this.docId} has no model file yet.`,
      );
    }
    const response = await this.client.downloadFile(file.id);
    if (!response.ok) throw new Error(`Reading the model answered ${response.status}`);
    return await response.blob();
  }

  /**
   * The ordered recipe for the model AT a version: the baseline full export
   * at-or-before it, then one step per later version up to it — each step's
   * delta .frag (absent on geometry-less versions) and the element uniqueIds
   * it removed. The consumer composes with its geometry engine: load the
   * baseline, then per step replace elements by uniqueId from the delta and
   * drop the removed. Composing is NOT done here: writing a merged .frag
   * takes the fragments engine, which this package deliberately does not
   * carry.
   *
   * UniqueIds are the native application's own stable element ids (a Revit
   * UniqueId survives syncs, machines and full exports), which is what makes
   * replace-by-uniqueId the whole composition rule.
   *
   * When the baseline is NEWER than the asked version (somebody published
   * after it), the visible file no longer shows that moment: `baseline`
   * then carries the older version's `storageVersion` when the history
   * recorded one, so the consumer can download that stored file version
   * instead of the current one.
   */
  async modelParts(options?: { at?: string }): Promise<FlowModelParts> {
    const timeline = await this.timeline();
    if (timeline.length === 0) {
      throw new Error(
        `Document ${this.source}-${this.docId} has no history yet.`,
      );
    }
    const at = options?.at;
    const targetIndex = at
      ? timeline.findIndex((v) => v.guid === at)
      : timeline.length - 1;
    if (targetIndex < 0) {
      throw new Error(`No version ${at} in this document's timeline.`);
    }

    // The newest full export at-or-before the target; the root failing that.
    let baselineIndex = 0;
    for (let i = targetIndex; i >= 0; i--) {
      if (timeline[i].full) {
        baselineIndex = i;
        break;
      }
    }

    const file = await this.#modelFile();
    if (!file) {
      throw new Error(
        `Document ${this.source}-${this.docId} has no model file yet.`,
      );
    }

    const baselineVersion = timeline[baselineIndex];
    // Is the visible file's content the baseline we need? Only when no LATER
    // full export rewrote it.
    const rewrittenAfter = timeline
      .slice(targetIndex + 1)
      .some((v) => v.full);

    const steps = timeline
      .slice(baselineIndex + 1, targetIndex + 1)
      .map((version) => ({
        guid: version.guid,
        ...(version.deltaId ? { deltaId: version.deltaId } : {}),
        ...(version.streamId ? { streamId: version.streamId } : {}),
        removedUniqueIds: version.changes
          .filter((change) => change.type === 'delete')
          .map((change) => change.uniqueId),
      }));

    return {
      baseline: {
        fileId: file.id,
        guid: baselineVersion.guid,
        current: !rewrittenAfter,
        ...(baselineVersion.version !== undefined
          ? { storageVersion: baselineVersion.version }
          : {}),
      },
      steps,
      at: timeline[targetIndex].guid,
    };
  }

  /** The document folder's item id — the id the CDE knows this document by. */
  async folderId(): Promise<string> {
    return await this.#folder(false);
  }

  // ─── The document descriptor ───────────────────────────────────────────────

  /**
   * The document descriptor (`document.json`), or null when the folder does
   * not carry one yet — an old folder from before descriptors existed.
   */
  async descriptor(): Promise<DocumentDescriptor | null> {
    return await this.#documents.descriptor(await this.#folder(false));
  }

  /**
   * The first view whose format appears in `formats`, searched in the order
   * of the list (the caller's preference wins). Falls back to the visible
   * model .frag on a descriptor-less folder, so old documents keep viewing.
   */
  async view(formats: string[]): Promise<DocumentView | null> {
    const folderId = await this.#folder(false);
    const descriptor = await this.#documents.descriptor(folderId);
    if (descriptor) {
      for (const format of formats) {
        const match = descriptor.views.find((v) => v.format === format);
        if (match) return match;
      }
      return null;
    }
    if (!formats.includes('frag')) return null;
    const model = await this.#modelFile();
    return model ? { fileId: model.id, format: 'frag' } : null;
  }

  /**
   * Registers a renderable representation, creating the descriptor when the
   * folder predates them (named after the model file, or the folder itself).
   * One view per format: a same-format view is replaced, not accumulated.
   */
  async addView(view: DocumentView): Promise<void> {
    const folderId = await this.#folder(true);
    const descriptor = await this.#documents.descriptor(folderId);
    if (descriptor) {
      await this.#documents.addView(folderId, view);
      return;
    }
    const model = await this.#modelFile();
    await this.#documents.setDescriptor(folderId, {
      name: model?.name.replace(/\.frag$/, '') ?? this.#folderName,
      views: [view],
    });
  }

  /**
   * Makes sure the folder carries a descriptor, WRITING one when it predates
   * them: the visible model .frag becomes the 'frag' view. The explicit form
   * of what {@link addView} does implicitly — reads like `descriptor()` never
   * write, so migrating an old folder is this deliberate call. Returns the
   * descriptor either way, or null when there is nothing to describe yet (no
   * model file).
   */
  async ensureDescriptor(): Promise<DocumentDescriptor | null> {
    const folderId = await this.#folder(false);
    const existing = await this.#documents.descriptor(folderId);
    if (existing) return existing;
    const model = await this.#modelFile();
    if (!model) return null;
    const descriptor = {
      name: model.name.replace(/\.frag$/, ''),
      views: [{ fileId: model.id, format: 'frag' }],
    };
    await this.#documents.setDescriptor(folderId, descriptor);
    return await this.#documents.descriptor(folderId);
  }

  // ─── Ownership (element locks) ─────────────────────────────────────────────

  /**
   * Who currently holds which elements, read from the lock registry the
   * native plugins arbitrate through. Read-only: claiming and releasing stay
   * with the plugins. Empty when nobody holds anything (or the document has
   * no lock anchor yet). Arbitration is applied: a key contested by two
   * claims counts only for the earliest one, matching the plugins' rule.
   */
  async ownership(): Promise<FlowOwner[]> {
    const anchor = await this.#file(LOCKS_ANCHOR);
    if (!anchor) return [];
    const metas = await this.client.getHiddenFilesByParent(anchor.id);

    // Fetched in parallel, kept in listing order: order IS the arbitration.
    const claims = await Promise.all(
      metas.map(async (meta) => {
        try {
          const id = idOf(meta as never);
          const response = await this.client.downloadHiddenFile(id);
          const parsed = JSON.parse(await response.text()) as Record<
            string,
            unknown
          >;
          if (!parsed || typeof parsed !== 'object') return null;
          if (!('revitflowlock' in parsed)) return null;
          if (!Array.isArray(parsed.keys)) return null;
          return {
            owner: String(parsed.user ?? ''),
            keys: parsed.keys.filter((k): k is string => typeof k === 'string'),
          };
        } catch {
          return null;
        }
      }),
    );

    const taken = new Set<string>();
    const byOwner = new Map<string, string[]>();
    for (const claim of claims) {
      if (!claim) continue;
      for (const key of claim.keys) {
        if (!key || taken.has(key)) continue;
        taken.add(key);
        const list = byOwner.get(claim.owner) ?? [];
        list.push(key);
        byOwner.set(claim.owner, list);
      }
    }
    return [...byOwner.entries()].map(([owner, elements]) => ({
      owner,
      elements,
    }));
  }

  get #documents(): ProjectDocuments {
    return new ProjectDocuments(this.client, this.project.projectId);
  }

  // ─── Writing versions ─────────────────────────────────────────────────────

  /**
   * Appends one version: uploads the geometry it carries, then the updated
   * history. Give `expectedLatestGuid` whenever you built on a head you read,
   * so a concurrent writer surfaces as {@link StaleHistoryError} instead of a
   * silent fork.
   */
  async sync(input: SyncInput): Promise<FlowVersion> {
    const folderId = await this.#folder(true);
    let history = (await this.#readHistory()) ?? {
      model: this.docId,
      commits: [],
    };

    const head = lastByGraph(history.commits);
    if (
      input.expectedLatestGuid !== undefined &&
      head?.guid !== input.expectedLatestGuid
    ) {
      throw new StaleHistoryError(input.expectedLatestGuid, head?.guid);
    }

    const version: FlowVersion = {
      guid: mintGuid(),
      ...(head ? { parents: [head.guid] } : {}),
      author: input.author,
      source: input.source,
      timestamp: new Date().toISOString(),
      ...(input.message ? { message: input.message } : {}),
      ...(input.userId ? { userId: input.userId } : {}),
      ...(input.kind ? { kind: input.kind } : {}),
      ...(input.file ? { file: input.file } : {}),
      ...(input.origin ? { origin: input.origin } : {}),
      ...(input.origins?.length ? { origins: input.origins } : {}),
      changes: input.changes,
      counts: tally(input.changes),
    };

    if (input.model) {
      await this.#writeModel(folderId, input.model);
      version.full = true;
    }
    if (input.delta) {
      const modelFile = await this.#modelFile();
      if (!modelFile) {
        throw new Error(
          'A delta needs the model file to hang from: sync a full model first.',
        );
      }
      const hidden = await this.client.createHiddenFile(
        input.delta,
        modelFile.id,
      );
      version.deltaId = hiddenIdOf(hidden);
    }

    // Re-read right before writing: the smallest window this storage allows.
    const fresh = await this.#readHistory();
    if (fresh) {
      history = fresh;
      const freshHead = lastByGraph(history.commits);
      if (
        input.expectedLatestGuid !== undefined &&
        freshHead?.guid !== input.expectedLatestGuid
      ) {
        throw new StaleHistoryError(input.expectedLatestGuid, freshHead?.guid);
      }
      if (freshHead && !version.parents) version.parents = [freshHead.guid];
    }
    history.commits.push(version);
    await this.#writeJson(folderId, HISTORY_FILE, history);
    return version;
  }

  // ─── The layout, below the surface ────────────────────────────────────────

  get #folderName(): string {
    return `${this.source}-${this.docId}`;
  }

  async #folder(create: boolean): Promise<string> {
    if (this.#folderId) return this.#folderId;
    const rootId = await this.project.rootFolderId(create);
    if (!rootId) {
      throw new Error(
        `Project ${this.project.projectId} has no connected documents yet.`,
      );
    }
    // The project's shared listing (see childFolders), listed again once when
    // this document is not in it: it may have been made since.
    const named = (folders: { name?: unknown }[]) =>
      folders.find((f) => String(f.name ?? '') === this.#folderName);
    const found =
      named(await this.project.childFolders(rootId)) ??
      named(await this.project.childFolders(rootId, true));
    if (found) {
      this.#folderId = idOf(found as never);
      return this.#folderId;
    }
    if (!create) {
      throw new Error(
        `Document ${this.#folderName} does not exist in this project.`,
      );
    }
    const made = await this.client.createFolder(
      this.#folderName,
      rootId,
      this.project.projectId,
    );
    this.project.forgetFolders();
    this.#folderId = idOf(made as never);
    return this.#folderId;
  }

  #filesListed?: Promise<StoredFile[]>;
  #filesAt = 0;

  /**
   * Its files, listed once for the reads that come together: a document's
   * versions, requests and ops each asked for the listing, three requests per
   * document on every Coordinator load (13-10). Kept a few seconds, and
   * forgotten when this document makes a file.
   */
  async #files(): Promise<StoredFile[]> {
    if (!this.#filesListed || Date.now() - this.#filesAt > 5_000) {
      this.#filesAt = Date.now();
      this.#filesListed = (async () => {
        const folderId = await this.#folder(false);
        // (From the project's listing, shared by every reader of the page, not one listing per document: the
        // Coordinator's start listed 16 folders one by one for their histories, Antonio 23-10.)
        const items = (await this.client.listFiles({ projectId: this.project.projectId })).filter((item) => {
          const where = item as { folderId?: unknown; parentFolderId?: unknown };
          return String(where.folderId ?? where.parentFolderId ?? '') === folderId;
        });
        return items.map((item) => ({
          id: idOf(item as never),
          name: String((item as { name?: unknown }).name ?? ''),
        }));
      })();
      this.#filesListed.catch(() => {
        this.#filesListed = undefined;
      });
    }
    return this.#filesListed;
  }

  async #file(name: string): Promise<StoredFile | undefined> {
    try {
      return (await this.#files()).find((f) => f.name === name);
    } catch {
      return undefined;
    }
  }

  async #modelFile(): Promise<StoredFile | undefined> {
    try {
      const files = await this.#files();
      return (
        files.find((f) => f.name === LEGACY_MODEL_FILE) ??
        files.find(
          (f) =>
            f.name.endsWith('.frag') && !f.name.startsWith(INTERNAL_PREFIX),
        )
      );
    } catch {
      return undefined;
    }
  }

  async #readJson<T>(name: string): Promise<T | undefined> {
    const file = await this.#file(name);
    if (!file) return undefined;
    const response = await this.client.downloadFile(file.id);
    // 🔴 A FAILED READ IS AN ERROR, NEVER A FILE (23-10, DEV's rate limit): the 429's own JSON was taken for the
    // history, and the next commit wrote a history that began there, in place of the real one.
    if (!response.ok) throw new Error(`Reading ${name} answered ${response.status}`);
    const text = await response.text();
    if (!text.trim()) return undefined;
    return JSON.parse(text) as T;
  }

  #readHistory(): Promise<FlowHistoryFile | undefined> {
    return this.#readJson<FlowHistoryFile>(HISTORY_FILE);
  }

  async #writeJson(
    folderId: string,
    name: string,
    value: unknown,
  ): Promise<StoredFile> {
    const blob = new Blob([JSON.stringify(value)], {
      type: 'application/json',
    });
    const existing = await this.#file(name);
    if (existing) {
      await this.client.updateFile(existing.id, {
        file: blob,
        versionTag: await this.client.nextVersionTag(existing.id),
      });
      return existing;
    }
    return await this.#createJson(folderId, name, value);
  }

  async #createJson(
    folderId: string,
    name: string,
    value: unknown,
  ): Promise<StoredFile> {
    const blob = new Blob([JSON.stringify(value)], {
      type: 'application/json',
    });
    const created = await this.client.createFile({
      file: blob,
      name,
      versionTag: 'v1',
      parentFolderId: folderId,
      projectId: this.project.projectId,
    });
    this.#filesListed = undefined;
    const item = (created as { item?: { _id?: unknown; id?: unknown } }).item;
    return { id: idOf((item ?? created) as never), name };
  }

  async #writeModel(folderId: string, model: Blob): Promise<StoredFile> {
    const existing = await this.#modelFile();
    if (existing) {
      await this.client.updateFile(existing.id, {
        file: model,
        versionTag: await this.client.nextVersionTag(existing.id),
      });
      return existing;
    }
    const name = `${this.#folderName}.frag`;
    const created = await this.client.createFile({
      file: model,
      name,
      versionTag: 'v1',
      parentFolderId: folderId,
      projectId: this.project.projectId,
    });
    this.#filesListed = undefined;
    const item = (created as { item?: { _id?: unknown; id?: unknown } }).item;
    return { id: idOf((item ?? created) as never), name };
  }
}

// ─── Graph helpers ───────────────────────────────────────────────────────────

function tally(changes: FlowChange[]): FlowCounts {
  const counts: FlowCounts = { added: 0, modified: 0, removed: 0 };
  for (const change of changes) {
    if (change.type === 'create') counts.added++;
    else if (change.type === 'delete') counts.removed++;
    else counts.modified++;
  }
  return counts;
}

/**
 * Orders versions by walking the parent graph from the root along first
 * parents, breaking forks by timestamp — array position is not meaningful
 * once more than one application writes. Fills `ordinal`.
 */
export function orderByGraph(versions: FlowVersion[]): FlowVersion[] {
  if (versions.length <= 1) {
    versions.forEach((v, i) => (v.ordinal = i));
    return [...versions];
  }
  const byGuid = new Map(versions.map((v) => [v.guid, v]));
  const children = new Map<string, FlowVersion[]>();
  const roots: FlowVersion[] = [];
  for (const version of versions) {
    const parent = version.parents?.[0];
    if (parent && byGuid.has(parent)) {
      const list = children.get(parent) ?? [];
      list.push(version);
      children.set(parent, list);
    } else {
      roots.push(version);
    }
  }
  const byTime = (a: FlowVersion, b: FlowVersion) =>
    String(a.timestamp).localeCompare(String(b.timestamp));
  roots.sort(byTime);

  const ordered: FlowVersion[] = [];
  const stack = [...roots].reverse();
  const seen = new Set<string>();
  while (stack.length) {
    const version = stack.pop()!;
    if (seen.has(version.guid)) continue;
    seen.add(version.guid);
    ordered.push(version);
    const next = (children.get(version.guid) ?? []).sort(byTime);
    for (let i = next.length - 1; i >= 0; i--) stack.push(next[i]);
  }
  // Anything unreachable (broken parents) still shows, by time, at the end.
  for (const version of versions) {
    if (!seen.has(version.guid)) ordered.push(version);
  }
  ordered.forEach((v, i) => (v.ordinal = i));
  return ordered;
}

function lastByGraph(versions: FlowVersion[]): FlowVersion | undefined {
  const ordered = orderByGraph(versions);
  return ordered[ordered.length - 1];
}

/** A random v4 guid, for version guids and recipe run ids. */
export function mintGuid(): string {
  const anyCrypto = globalThis.crypto as { randomUUID?: () => string };
  if (anyCrypto?.randomUUID) return anyCrypto.randomUUID();
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    return (c === 'x' ? r : (r & 0x3) | 0x8).toString(16);
  });
}
