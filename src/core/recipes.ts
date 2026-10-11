/**
 * Recipes: scripts that write change requests (suggestions) in a native
 * application's own language.
 *
 * A recipe's whole contract is one sentence: it reads some input — another
 * document's version, platform elements, points, a spreadsheet, anything —
 * and queues a SUGGESTION for a target document, expressed in that
 * application's native vocabulary (families, types, levels, blocks, layers).
 * Nothing applies until the document's owner accepts it in the native app,
 * which is why trying a recipe is always safe.
 *
 * A recipe is defined by its contract, not by where it runs: `runtime`
 * declares the default ('browser' runs where the caller is; 'cloud' is for
 * recipes that must run with nobody in front). This module is the local
 * registry and runner; the platform-level catalog (recipes as published
 * items) is the agreed phase 2 and will sit on top of the same manifest.
 */
import type { EngineServicesClient } from './client';
import type { FlowDoc, FlowSuggestion } from './history';

/** What a recipe declares about itself. Shown in catalogs, checked by apps. */
export interface RecipeManifest {
  /** Machine name, unique in a catalog: 'rhino-points-to-revit-columns'. */
  name: string;
  /** The one sentence a non-programmer reads: what it converts into what. */
  description: string;
  /** The native application whose language it writes: 'revit', 'autocad'… */
  to: string;
  /** The input kinds it understands: 'rhino-model', 'platform-elements', 'points', 'csv'… */
  inputs: string[];
  /** Where it runs by default. Browser unless it must run unattended. */
  runtime?: 'browser' | 'cloud';
  /**
   * JSON Schema for `settings`. Apps generate the settings form from it, so
   * anything that names an EXISTING thing (a target document, a family, a
   * level) must be an enum the app can fill — people pick, they never type
   * names of things that exist.
   */
  settingsSchema?: Record<string, unknown>;
  /**
   * The self-documentation an app renders: a "reads → proposes" table whose
   * rows are RULES (not objects), so a dry run can fill it with real tallies.
   */
  rules?: { reads: string; proposes: string }[];
}

/** Everything a recipe's `run` gets to work with. */
export interface RecipeContext<Settings = Record<string, unknown>> {
  client: EngineServicesClient;
  projectId: string;
  /** The document the suggestion is for. Read its timeline/model if needed. */
  targetDoc: FlowDoc;
  /** The declared input, already fetched by the caller (bytes, ids, rows…). */
  input: unknown;
  settings: Settings;
}

/** What a recipe's `run` returns: the suggestion, ready to queue. */
export interface RecipeResult {
  title: string;
  /** add | set | remove | mixed. */
  verb: string;
  /** The .frag payload (envelope `revitflow/op@2`), when the recipe builds one. */
  payload?: Blob;
  targets?: number;
  /** Per-rule tallies matching `manifest.rules`, filled by the run. */
  ruleTallies?: { read: number; proposed: number }[];
}

/** A recipe: its manifest plus the function that writes the suggestion. */
export interface Recipe<Settings = Record<string, unknown>>
  extends RecipeManifest {
  run(context: RecipeContext<Settings>): Promise<RecipeResult>;
}

/** What {@link Recipes.run} returns: the queued suggestion plus the tallies. */
export interface RecipeRunOutcome {
  suggestion: FlowSuggestion;
  result: RecipeResult;
}

/**
 * The local recipe registry and runner. Reach it as `client.recipes`.
 */
export class Recipes {
  readonly #registry = new Map<string, Recipe<never>>();

  constructor(private readonly client: EngineServicesClient) {}

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
   * Runs a recipe and queues its suggestion on the target document. Safe to
   * call freely: nothing touches the native application until its owner
   * accepts the suggestion there.
   */
  async run<S>(
    name: string,
    options: {
      projectId: string;
      /** The target document, as `client.history(projectId).docs()` lists it. */
      target: { source: string; docId: string };
      input?: unknown;
      settings?: S;
      author: string;
      userId?: string;
    },
  ): Promise<RecipeRunOutcome> {
    const recipe = this.#registry.get(name) as Recipe<S> | undefined;
    if (!recipe) throw new Error(`No recipe named "${name}" is registered.`);
    if (recipe.to !== options.target.source) {
      throw new Error(
        `Recipe "${name}" writes ${recipe.to}, but the target document belongs to ${options.target.source}.`,
      );
    }

    const targetDoc = this.client
      .history(options.projectId)
      .doc(options.target.source, options.target.docId);
    const base = await targetDoc.latest();

    const result = await recipe.run({
      client: this.client,
      projectId: options.projectId,
      targetDoc,
      input: options.input,
      settings: (options.settings ?? {}) as S,
    });

    const suggestion = await targetDoc.suggest({
      title: result.title,
      verb: result.verb,
      author: options.author,
      payload: result.payload,
      targets: result.targets,
      userId: options.userId,
      baseCommitGuid: base?.guid,
    });

    return { suggestion, result };
  }
}
