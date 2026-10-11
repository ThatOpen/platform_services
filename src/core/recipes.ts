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
import { mintGuid, type FlowDoc, type FlowSuggestion } from './history';

/**
 * How a settings property says "this names something that EXISTS". Put it on
 * the property as `x-existing` inside {@link RecipeManifest.settingsSchema}:
 * the app resolves the candidates and renders a list — people pick, they
 * never type the name of a thing that exists.
 *
 * Resolving the candidates is the APP's job today (reading `doc.model()` of
 * the target, or the declared source file, takes the fragments toolkit, which
 * the SDK does not carry). The kinds are stable so nothing changes for
 * recipes when a shared reader lands in that toolkit.
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
  /** The human name a card shows: 'Rhino points to Revit columns'. */
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
   * What the app should offer as the input picker, when the input is a thing
   * of the project rather than inline data: another connected document, or a
   * project file (then `extensions` narrows the listing). The picked value is
   * what arrives as `input`, and what `x-existing: { from: 'source' }`
   * lookups read.
   */
  source?:
    | { kind: 'document'; source?: string }
    | { kind: 'project-file'; extensions?: string[] };
  /** Where it runs by default. Browser unless it must run unattended. */
  runtime?: 'browser' | 'cloud';
  /**
   * JSON Schema for `settings`. Apps generate the settings form from it, so
   * anything that names an EXISTING thing (a target document, a family, a
   * level) carries `x-existing` ({@link ExistingLookup}) and renders as a
   * list the app fills — people pick, they never type names of things that
   * exist. Free text is only for what a person invents.
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
  /**
   * The suggestion's id, minted BEFORE the run: the payload envelope
   * (`revitflow/op@2`) carries the opId inside, so the builder needs it.
   * When the run is only a plan, nothing is queued and the id is discarded.
   */
  opId: string;
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
 * What {@link Recipes.plan} returns: everything needed to queue EXACTLY what
 * was planned, without running the recipe again — the payload already embeds
 * this `opId`. Hand it to {@link Recipes.queue} when the person confirms.
 */
export interface RecipePlan {
  opId: string;
  projectId: string;
  target: { source: string; docId: string };
  /** The head the plan was built against, for the suggestion's base. */
  baseCommitGuid?: string;
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
   * Runs a recipe WITHOUT queueing anything: the dry pass. Returns a
   * {@link RecipePlan} — the result to show (title, tallies, targets) plus
   * everything {@link queue} needs to queue EXACTLY this, payload and opId
   * included, with no second run. Discard it and the plan never happened.
   */
  async plan<S>(
    name: string,
    options: RecipeRunOptions<S>,
  ): Promise<RecipePlan> {
    const { base, opId, result } = await this.#execute(name, options);
    return {
      opId,
      projectId: options.projectId,
      target: options.target,
      ...(base?.guid ? { baseCommitGuid: base.guid } : {}),
      result,
    };
  }

  /**
   * Queues exactly what {@link plan} planned: same opId, same payload, no
   * second execution. The pair plan → confirm → queue is the UI flow; `run`
   * is the one-shot shortcut.
   */
  async queue(
    plan: RecipePlan,
    options: { author: string; userId?: string },
  ): Promise<RecipeRunOutcome> {
    const targetDoc = this.client
      .history(plan.projectId)
      .doc(plan.target.source, plan.target.docId);
    const suggestion = await targetDoc.suggest({
      opId: plan.opId,
      title: plan.result.title,
      verb: plan.result.verb,
      author: options.author,
      payload: plan.result.payload,
      targets: plan.result.targets,
      userId: options.userId,
      baseCommitGuid: plan.baseCommitGuid,
    });
    return { suggestion, result: plan.result };
  }

  /**
   * Runs a recipe and queues its suggestion on the target document. Safe to
   * call freely: nothing touches the native application until its owner
   * accepts the suggestion there. Use {@link plan} first when the app wants
   * to show the tallies before queueing.
   */
  async run<S>(
    name: string,
    options: RecipeRunOptions<S>,
  ): Promise<RecipeRunOutcome> {
    const { targetDoc, base, opId, result } = await this.#execute(
      name,
      options,
    );

    const suggestion = await targetDoc.suggest({
      opId,
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

  async #execute<S>(name: string, options: RecipeRunOptions<S>) {
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

    // Minted BEFORE the run: the payload envelope carries the opId inside.
    const opId = mintGuid();
    const result = await recipe.run({
      client: this.client,
      projectId: options.projectId,
      targetDoc,
      opId,
      input: options.input,
      settings: (options.settings ?? {}) as S,
    });
    return { recipe, targetDoc, base, opId, result };
  }
}

/** The options {@link Recipes.plan} and {@link Recipes.run} share. */
export interface RecipeRunOptions<S = Record<string, unknown>> {
  projectId: string;
  /** The target document, as `client.history(projectId).docs()` lists it. */
  target: { source: string; docId: string };
  input?: unknown;
  settings?: S;
  author: string;
  userId?: string;
}
