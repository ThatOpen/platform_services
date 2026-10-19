/**
 * Recipes: scripts that bring something into a native application, written in
 * that application's own language.
 *
 * A recipe's whole contract is one sentence: it reads some input — a project
 * file (an IFC), platform elements, points, a spreadsheet, anything — and
 * returns the CHANGES that make a document of the native application match
 * it, in that application's vocabulary (families, types, levels, blocks,
 * layers).
 *
 * 🔴 APP-CENTRIC (Antonio and Jesús, 19-10). A recipe is chosen and applied
 * from INSIDE the native application, in one go: the plugin runs it and writes
 * its changes there at once, in one transaction. Nothing is queued anywhere:
 * there are no proposals. What happened is written in the document's history
 * when the person publishes, with the recipe and the exact source it read as
 * the step's origin. On the platform a recipe is only its description.
 *
 * A recipe keeps nothing of its own: what it made before in a document is
 * remembered by the native application's plugin, next to the document's other
 * That Open data, and handed back on every run ({@link RecipeContext.made}),
 * so a second run writes only the difference.
 */
import type { EngineServicesClient } from './client';
import { mintGuid } from './history';

/**
 * How a settings property says "this names something that EXISTS". Put it on
 * the property as `x-existing` inside {@link RecipeManifest.settingsSchema}:
 * the app resolves the candidates and renders a list — people pick, they
 * never type the name of a thing that exists.
 *
 * Resolving the candidates is the APP's job (the native application knows its
 * own types and levels). The kinds are stable so nothing changes for recipes
 * when a shared reader lands.
 */
export interface ExistingLookup {
  /** What kind of existing thing: 'document' | 'family-type' | 'level' | 'layer' | 'workset'… */
  of: string;
  /** Where it exists: the target document, or the declared source. Default 'target'. */
  from?: 'target' | 'source';
  /**
   * Narrows the candidates: attribute equals value, against the attribute
   * names EXACTLY as the native application publishes them, no case
   * normalization. Prefer the stable machine fields over display names —
   * Revit's `Category` text is localized per install ("Armazón estructural"),
   * so a column filter is `{ CategoryId: '-2001330' }`, never
   * `{ Category: 'Columns' }`.
   */
  where?: Record<string, string>;
}

/** What a recipe declares about itself. Shown in catalogs, checked by apps. */
export interface RecipeManifest {
  /** Machine name, unique in a catalog: 'rhino-points-to-revit-columns'. */
  name: string;
  /** The human name a list shows: 'Rhino points to Revit columns'. */
  title?: string;
  /** The one sentence a non-programmer reads: what it converts into what. */
  description: string;
  /** The long-form explanation an app renders, as markdown. */
  doc?: string;
  /** The native application whose language it writes: 'revit', 'autocad'… */
  to: string;
  /** The input kinds it understands: 'rhino-model', 'platform-elements', 'points', 'csv'… */
  inputs: string[];
  /**
   * What the native application offers as the input picker, when the input is
   * a thing of the project rather than inline data: another connected
   * document, or a project file (then `extensions` narrows the listing).
   * {@link Recipes.choices} lists the candidates; the picked one arrives as
   * `input` ({@link PickedSource}).
   */
  source?:
    | { kind: 'document'; source?: string }
    | { kind: 'project-file'; extensions?: string[] };
  /**
   * JSON Schema for `settings`. Apps generate the settings form from it, so
   * anything that names an EXISTING thing (a family, a level) carries
   * `x-existing` ({@link ExistingLookup}) and renders as a list the app fills —
   * people pick, they never type names of things that exist. Free text is only
   * for what a person invents.
   */
  settingsSchema?: Record<string, unknown>;
  /**
   * The self-documentation an app renders: a "reads → writes" table whose rows
   * are RULES (not objects), so every run can fill it with real tallies.
   */
  rules?: { reads: string; writes: string }[];
}

/** One thing this recipe made in the target before, as the target remembers it. */
export interface RecipeMade {
  /** The target's id of what was made (Revit's UniqueId). */
  id: string;
  /** The fingerprint of what it was made from (`flow:print`): unchanged source, nothing to do. */
  print?: string;
}

/** Everything a recipe's `run` gets to work with. */
export interface RecipeContext<Settings = Record<string, unknown>> {
  client: EngineServicesClient;
  projectId: string;
  /** The document the changes are for: its native application, its id and the version it is on, when the platform knows it. */
  target: { source: string; docId?: string; version?: number };
  /**
   * What this recipe made in the target before: source key → what it made.
   * The native application keeps it with the document and hands it back,
   * filtered to what still exists there. Empty on a first run.
   */
  made: ReadonlyMap<string, RecipeMade>;
  /**
   * The id of this run, minted before it: the changes' envelope
   * (`revitflow/op@2`) carries it inside.
   */
  opId: string;
  /** The declared input: the picked source ({@link PickedSource}), ids, rows… */
  input: unknown;
  settings: Settings;
  /** Says how far it is, for the native application's progress bar: a line, and a fraction 0..1 when known. */
  progress: (says: string, fraction?: number) => void;
}

/** What a recipe's `run` returns: the changes, ready to be written in the target. */
export interface RecipeResult {
  title: string;
  /** add | set | remove | mixed. */
  verb: string;
  /** The changes, as a .frag (envelope `revitflow/op@2`), when the recipe builds one. */
  payload?: Blob;
  /** How many changes it carries. */
  targets?: number;
  /** Per-rule tallies matching `manifest.rules`, filled by the run. */
  ruleTallies?: { read: number; written: number }[];
}

/** A recipe: its manifest plus the function that writes the changes. */
export interface Recipe<Settings = Record<string, unknown>>
  extends RecipeManifest {
  run(context: RecipeContext<Settings>): Promise<RecipeResult>;
}

/** The project file or document a person picked as a recipe's source. */
export interface PickedSource {
  fileId: string;
  /** The file's name, extension included: what says its format. */
  name: string;
  /** The document it is the native file of, when it is one: the folder the history is written to. */
  folderId?: string;
  /** The storage version to read (its versionTag); the latest when absent. */
  version?: string;
}

/** One candidate for a recipe's source, as {@link Recipes.choices} lists it. */
export interface RecipeChoice extends PickedSource {
  /** What the picker shows: the document's name. */
  label: string;
  version: string;
}

/**
 * A recipe that has nothing to write: everything it would ask for is in the
 * target already, as the source has it. Not a failure: the native
 * application says «up to date».
 */
export class UpToDate extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'UpToDate';
  }
}

/**
 * Turns a file of another format into a .frag that carries the platform's
 * records (`Element` / `Carried` on each item), the one form recipes read.
 */
export type RecordsImporter = (bytes: Uint8Array, name: string) => Promise<Uint8Array>;

/**
 * The local recipe registry and runner. Reach it as `client.recipes`.
 */
export class Recipes {
  readonly #registry = new Map<string, Recipe<never>>();
  readonly #importers = new Map<string, RecordsImporter>();

  constructor(private readonly client: EngineServicesClient) {}

  /**
   * Says how this host turns files of one extension ('ifc') into records, so a
   * recipe can be pointed at the raw file and convert it as its first step.
   * The converter lives in the engine, which the SDK does not carry: the host
   * that has it provides it.
   */
  provideImporter(extension: string, importer: RecordsImporter): void {
    this.#importers.set(extension.toLowerCase(), importer);
  }

  /** The importer provided for an extension, or undefined. */
  importerFor(extension: string): RecordsImporter | undefined {
    return this.#importers.get(extension.toLowerCase());
  }

  /** Registers a recipe. One per name; a second with the same name throws. */
  register<S>(recipe: Recipe<S>): void {
    if (this.#registry.has(recipe.name)) {
      throw new Error(`A recipe named "${recipe.name}" is already registered.`);
    }
    this.#registry.set(recipe.name, recipe as Recipe<never>);
  }

  /** The registered recipes, optionally filtered by target application. */
  list(filter?: { to?: string; input?: string }): RecipeManifest[] {
    const all = [...this.#registry.values()];
    return all.filter(
      (recipe) =>
        (!filter?.to || recipe.to === filter.to) &&
        (!filter?.input || recipe.inputs.includes(filter.input)),
    );
  }

  /** A registered recipe by name, or undefined. */
  get(name: string): RecipeManifest | undefined {
    return this.#registry.get(name);
  }

  /**
   * The candidates for a recipe's source in a project, for the picker: the
   * documents whose native file has one of the declared extensions, each with
   * the version it is on now. A recipe with no declared source has none.
   */
  async choices(name: string, projectId: string): Promise<RecipeChoice[]> {
    const recipe = this.#registry.get(name);
    if (!recipe) throw new Error(`No recipe named "${name}" is registered.`);
    const source = recipe.source;
    if (source?.kind !== 'project-file') return [];
    const extensions = (source.extensions ?? []).map((e) => e.toLowerCase());
    const documents = await this.client.documents(projectId).list();
    const picked = documents.filter(
      (one) =>
        one.descriptor.native &&
        (extensions.length === 0 ||
          extensions.includes(one.descriptor.native.format.toLowerCase())),
    );
    const versions = await latestVersions(
      this.client,
      picked.map((one) => one.descriptor.native!.fileId),
    );
    return picked
      .map((one) => {
        const native = one.descriptor.native!;
        return {
          label: one.descriptor.name,
          fileId: native.fileId,
          name: `${one.descriptor.name}.${native.format}`,
          folderId: one.folderId,
          version: versions.get(native.fileId) ?? 'v1',
        };
      })
      .sort((a, b) => a.label.localeCompare(b.label));
  }

  /**
   * Runs a recipe: the changes that make the target match its source, given
   * what it made there before. Throws {@link UpToDate} when there is nothing
   * to write. The caller (the native application's plugin) writes them.
   */
  async run<S>(name: string, options: RecipeRunOptions<S>): Promise<RecipeResult> {
    const recipe = this.#registry.get(name) as Recipe<S> | undefined;
    if (!recipe) throw new Error(`No recipe named "${name}" is registered.`);
    if (recipe.to !== options.target.source) {
      throw new Error(
        `Recipe "${name}" writes ${recipe.to}, but the target document belongs to ${options.target.source}.`,
      );
    }
    return await recipe.run({
      client: this.client,
      projectId: options.projectId,
      target: options.target,
      made: options.made ?? new Map(),
      opId: options.opId ?? mintGuid(),
      input: options.input,
      settings: (options.settings ?? {}) as S,
      progress: options.progress ?? (() => {}),
    });
  }
}

/** The options of {@link Recipes.run}. */
export interface RecipeRunOptions<S = Record<string, unknown>> {
  projectId: string;
  /** The target document: its native application, and its id and version when the platform knows it. */
  target: { source: string; docId?: string; version?: number };
  input?: unknown;
  settings?: S;
  /** What this recipe made in the target before (see {@link RecipeContext.made}). */
  made?: ReadonlyMap<string, RecipeMade>;
  /** The run's id, when the caller wants to name it; minted otherwise. */
  opId?: string;
  progress?: (says: string, fraction?: number) => void;
}

/** Each file's latest storage version tag (newest by date, then by number). */
export async function latestVersions(
  client: EngineServicesClient,
  fileIds: string[],
): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  if (fileIds.length === 0) return out;
  const tagNum = (t: unknown) => Number(/(\d+)/.exec(String(t ?? ''))?.[1] ?? -1);
  const newest = (versions: { tag?: unknown; versionTag?: unknown; createdAt?: unknown }[]) => {
    const sorted = versions.slice().sort((a, b) => {
      const ta = a?.createdAt ? new Date(String(a.createdAt)).getTime() : NaN;
      const tb = b?.createdAt ? new Date(String(b.createdAt)).getTime() : NaN;
      if (!Number.isNaN(ta) && !Number.isNaN(tb) && ta !== tb) return tb - ta;
      return tagNum(b?.tag ?? b?.versionTag) - tagNum(a?.tag ?? a?.versionTag);
    });
    const top = sorted[0];
    return top ? String(top.tag ?? top.versionTag ?? 'v1') : 'v1';
  };
  await Promise.all(
    fileIds.map(async (fileId) => {
      try {
        out.set(fileId, newest((await client.listVersions(fileId)) as never));
      } catch {
        out.set(fileId, 'v1');
      }
    }),
  );
  return out;
}
