/**
 * The history API: documents, versions and change requests, with the flow
 * storage encapsulated.
 *
 * The vocabulary is deliberately small and BIM-shaped:
 * - A DOC is a connected native document (a Revit model, an AutoCAD drawing).
 * - A VERSION is one sync of it: who, when, what changed.
 * - A SUGGESTION is a change request someone queued for the doc's owner to
 *   accept or dismiss in the native app. Nobody writes in somebody else's
 *   document.
 *
 * EVERYTHING BELOW THIS SURFACE IS PRIVATE. Today the data lives as plain
 * project files (the `bimterop` folder, `revitflow_history.json`,
 * `revitflow_ops.json`, hidden deltas) written by the flow plugins — see
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
  /** Hidden-file id of the per-element geometry fingerprints, when the writer keeps them. */
  geomId?: string;
  /** Platform user id of the committer, when the writer knew it. */
  userId?: string;
  /** This version re-exported the whole model (the visible .frag shows it as of here). */
  full?: boolean;
  compact?: boolean;
  /** Suggestions this version applied (their opIds). */
  appliedOps?: string[];
  /** Position in the timeline, derived from the parent graph when read. Never stored. */
  ordinal?: number;
}

/** Wire shape of `revitflow_history.json`. */
interface FlowHistoryFile {
  model: string;
  commits: FlowVersion[];
}

/**
 * A change request queued for a document. Wire-compatible with
 * `revitflow_ops.json` (schema `revitflow/ops@1`).
 */
export interface FlowSuggestion {
  opId: string;
  /** Groups the suggestions one authored action produced across several docs. */
  batchId?: string;
  /** Hidden-file id of the payload .frag (envelope `revitflow/op@2`). */
  fragId?: string;
  title?: string;
  /** add | set | remove | mixed. */
  verb?: string;
  author?: string;
  userId?: string;
  createdAt?: string;
  /** The version this was authored against, by guid. */
  baseCommitGuid?: string;
  /** The storage version that version landed in, when known. Data only. */
  baseCommit?: number;
  /** How many elements it targets. */
  targets?: number;
  state?: 'pending' | 'applied' | 'discarded' | string;
  /** The native version that materialised it, once applied (storage version number). */
  appliedInCommit?: number | null;
  /** Native ids it touched or created, written by the plugin when it applied. */
  affectedIds?: string[];
}

/** Wire shape of `revitflow_ops.json`. */
interface FlowOpsFile {
  schema?: string;
  ops: FlowSuggestion[];
}

/** A connected document, as listed from the project. */
export interface FlowDocInfo {
  /** The native application that owns it: 'revit', 'autocad'… */
  source: string;
  /** The document's own id within that application. */
  docId: string;
  /** The visible model file's name, when one exists yet. */
  modelName?: string;
  /**
   * True when the folder exists but holds neither history, model nor
   * suggestion queue — a document somebody connected and never synced (a
   * plugin mid-first-publish, or an abandoned start). A legitimate state,
   * listed rather than hidden; apps decide whether to show it dimmed.
   */
  empty?: boolean;
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
  /** Suggestions this version applied. */
  appliedOps?: string[];
  /**
   * The head you built on. When given and the stored head differs, `sync`
   * refuses with {@link StaleHistoryError} instead of forking silently.
   */
  expectedLatestGuid?: string;
}

/** What `suggest` needs. */
export interface SuggestInput {
  /**
   * The suggestion's id, when the caller minted it up front — a payload
   * (envelope `revitflow/op@2`) carries the opId INSIDE, so whoever builds
   * one needs the id before this call. Minted here when absent.
   */
  opId?: string;
  title: string;
  /** add | set | remove | mixed. */
  verb: string;
  author: string;
  /** The suggestion's .frag payload (envelope `revitflow/op@2`), when it has one. */
  payload?: Blob;
  targets?: number;
  batchId?: string;
  userId?: string;
  /** The version it was authored against. */
  baseCommitGuid?: string;
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
const OPS_FILE = 'revitflow_ops.json';
const OPS_SCHEMA = 'revitflow/ops@1';
const LEGACY_MODEL_FILE = 'revitflow_model.frag';
// Internal bookkeeping files that are NOT the model.
const INTERNAL_PREFIX = 'revitflow_';
const versionTag = () => `v-${Date.now()}`;

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
    const folders = await this.client.listFolders({
      parentFolderId: root,
      projectId: this.projectId,
    });
    const docs: FlowDocInfo[] = [];
    // Filtered here as well as in the query: the backend ignores an unknown
    // `parentFolderId` filter and answers with EVERY folder of the project,
    // which made any project folder with a dash in its name look like a doc.
    for (const folder of childrenOf(folders, root)) {
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
        names.includes(HISTORY_FILE) || names.includes(OPS_FILE) || !!model;
      docs.push({
        source: name.slice(0, dash),
        docId: name.slice(dash + 1),
        modelName: model,
        ...(hasAny ? {} : { empty: true }),
      });
    }
    return docs;
  }

  /** One document's history. `source` and `docId` as {@link docs} lists them. */
  doc(source: string, docId: string): FlowDoc {
    return new FlowDoc(this.client, this, source, docId);
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
 * One connected document: its timeline, its model, and its suggestions.
 */
export class FlowDoc {
  #folderId?: string;

  constructor(
    private readonly client: EngineServicesClient,
    private readonly project: ProjectHistory,
    readonly source: string,
    readonly docId: string,
  ) {}

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

  /** The visible model .frag as last fully exported. */
  async model(): Promise<Blob> {
    const file = await this.#modelFile();
    if (!file) {
      throw new Error(
        `Document ${this.source}-${this.docId} has no model file yet.`,
      );
    }
    const response = await this.client.downloadFile(file.id);
    return await response.blob();
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
      ...(input.appliedOps?.length ? { appliedOps: input.appliedOps } : {}),
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
      version.deltaId = String(
        (hidden as { _id?: unknown; id?: unknown })._id ??
          (hidden as { id?: unknown }).id,
      );
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

  // ─── Suggestions (change requests) ────────────────────────────────────────

  /** Every suggestion in the document's queue, pending or resolved. */
  async suggestions(): Promise<FlowSuggestion[]> {
    const ops = await this.#readOps();
    return ops?.ops ?? [];
  }

  /** The suggestions still waiting for the owner, oldest first. */
  async pendingSuggestions(): Promise<FlowSuggestion[]> {
    return (await this.suggestions()).filter((op) => op.state === 'pending');
  }

  /**
   * Queues a change request for this document. The payload, when given, is
   * uploaded as a hidden file under the suggestions index.
   */
  async suggest(input: SuggestInput): Promise<FlowSuggestion> {
    const folderId = await this.#folder(true);
    const index = (await this.#readOps()) ?? { schema: OPS_SCHEMA, ops: [] };
    const indexFile = await this.#file(OPS_FILE);

    const suggestion: FlowSuggestion = {
      opId: input.opId ?? mintGuid(),
      title: input.title,
      verb: input.verb,
      author: input.author,
      createdAt: new Date().toISOString(),
      state: 'pending',
      ...(input.targets !== undefined ? { targets: input.targets } : {}),
      ...(input.batchId ? { batchId: input.batchId } : {}),
      ...(input.userId ? { userId: input.userId } : {}),
      ...(input.baseCommitGuid
        ? { baseCommitGuid: input.baseCommitGuid }
        : {}),
    };

    if (input.payload) {
      // The payload hangs from the index file, so it exists first.
      const holder =
        indexFile ??
        (await this.#createJson(folderId, OPS_FILE, index));
      const hidden = await this.client.createHiddenFile(
        input.payload,
        holder.id,
      );
      suggestion.fragId = String(
        (hidden as { _id?: unknown; id?: unknown })._id ??
          (hidden as { id?: unknown }).id,
      );
    }

    const fresh = (await this.#readOps()) ?? index;
    fresh.schema ??= OPS_SCHEMA;
    fresh.ops.push(suggestion);
    await this.#writeJson(folderId, OPS_FILE, fresh);
    return suggestion;
  }

  /** A suggestion's .frag payload. */
  async suggestionPayload(suggestion: FlowSuggestion): Promise<Blob> {
    if (!suggestion.fragId) {
      throw new Error(`Suggestion ${suggestion.opId} carries no payload.`);
    }
    const response = await this.client.downloadHiddenFile(suggestion.fragId);
    return await response.blob();
  }

  /**
   * Marks a suggestion applied (naming the version that materialised it) or
   * discarded. The native plugins do this themselves when they apply; apps
   * use it for `discarded`.
   */
  async resolveSuggestion(
    opId: string,
    outcome:
      | { state: 'applied'; appliedInCommit?: number; affectedIds?: string[] }
      | { state: 'discarded' },
  ): Promise<FlowSuggestion> {
    const folderId = await this.#folder(false);
    if (!folderId) throw new Error('This document has no suggestion queue.');
    const index = await this.#readOps();
    const suggestion = index?.ops.find((op) => op.opId === opId);
    if (!index || !suggestion) {
      throw new Error(`No suggestion ${opId} in this document's queue.`);
    }
    Object.assign(suggestion, outcome);
    await this.#writeJson(folderId, OPS_FILE, index);
    return suggestion;
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
    const folders = await this.client.listFolders({
      parentFolderId: rootId,
      projectId: this.project.projectId,
    });
    // Same defensive filter as docs(): the backend may answer with every
    // folder of the project, and a same-named folder elsewhere must not win.
    const found = childrenOf(folders, rootId).find(
      (f) => String(f.name ?? '') === this.#folderName,
    );
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
    this.#folderId = idOf(made as never);
    return this.#folderId;
  }

  async #files(): Promise<StoredFile[]> {
    const folderId = await this.#folder(false);
    const items = await this.client.listFiles({ folderId });
    return items.map((item) => ({
      id: idOf(item as never),
      name: String((item as { name?: unknown }).name ?? ''),
    }));
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
    const text = await response.text();
    if (!text.trim()) return undefined;
    return JSON.parse(text) as T;
  }

  #readHistory(): Promise<FlowHistoryFile | undefined> {
    return this.#readJson<FlowHistoryFile>(HISTORY_FILE);
  }

  #readOps(): Promise<FlowOpsFile | undefined> {
    return this.#readJson<FlowOpsFile>(OPS_FILE);
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
        versionTag: versionTag(),
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
      versionTag: versionTag(),
      parentFolderId: folderId,
      projectId: this.project.projectId,
    });
    const item = (created as { item?: { _id?: unknown; id?: unknown } }).item;
    return { id: idOf((item ?? created) as never), name };
  }

  async #writeModel(folderId: string, model: Blob): Promise<StoredFile> {
    const existing = await this.#modelFile();
    if (existing) {
      await this.client.updateFile(existing.id, {
        file: model,
        versionTag: versionTag(),
      });
      return existing;
    }
    const name = `${this.#folderName}.frag`;
    const created = await this.client.createFile({
      file: model,
      name,
      versionTag: versionTag(),
      parentFolderId: folderId,
      projectId: this.project.projectId,
    });
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

/** A random v4 guid, for version guids and suggestion opIds. */
export function mintGuid(): string {
  const anyCrypto = globalThis.crypto as { randomUUID?: () => string };
  if (anyCrypto?.randomUUID) return anyCrypto.randomUUID();
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    return (c === 'x' ? r : (r & 0x3) | 0x8).toString(16);
  });
}
