/**
 * A project's own recipes: the ones its people make, with AI, next to the ones the platform ships.
 *
 * 🔴 (Antonio, 20-10) «Las recetas del proyecto se tienen que crear necesariamente con IA … nuestras recetas
 * deberían aparecer siempre como disponibles; luego el usuario podrá usarlas de punto de partida y crear
 * nuevas recetas para guardarlas en un proyecto». So:
 *
 * - The BUILT-IN recipes (`builtin-recipes/`) are always in the catalog, unchanged. A project recipe never
 *   takes a built-in's name: it is a new recipe, which may have started as a copy of one.
 * - A PROJECT recipe is one JSON file in the project's data folder (`__project_data/recipes/<name>.recipe.json`,
 *   the folder the CDE keeps out of sight): its manifest — what a person reads, `doc` included — and its
 *   code, an ES module that exports `run(context)`. Saving again is a new version of the same file, so
 *   every version is kept and a model can say which one built it.
 * - The code gets what the built-ins use through `context.kit` ({@link RecipeKit}): it imports nothing.
 *
 * How to write one is in docs/recipes-guide.md: written for an AI, with the built-ins as its examples.
 */
import type { EngineServicesClient } from './client';
import type { Recipe, RecipeContext, RecipeManifest, RecipeResult } from './recipes';
import { OperationBuilder, OP_SCHEMA } from './op-builder';
import { readFrag } from './frag-items';
import {
  CARRIED_FIELD,
  ELEMENT_FIELD,
  FEET_PER_METRE,
  innerJson,
  levelNames,
  levelsOf,
  printOf,
  readPickedFrag,
  recordsOf,
  siteLocationOf,
  stylesOf,
  whatItMadeBefore,
} from './builtin-recipes/shared';

/** The wire shape of a project recipe's file. */
export interface ProjectRecipeFile {
  schema: typeof PROJECT_RECIPE_SCHEMA;
  manifest: RecipeManifest;
  /** An ES module: `export async function run(context) { … }`, with `context.kit` for its tools. */
  code: string;
  /** Who saved this version, and what they said it changed. */
  author?: string;
  note?: string;
  savedAt?: string;
}

export const PROJECT_RECIPE_SCHEMA = 'thatopen/recipe@1';
const DATA_FOLDER = '__project_data';
const RECIPES_FOLDER = 'recipes';
const fileName = (name: string) => `${name}.recipe.json`;

/** One recipe of the catalog: where it comes from, and for a project one, its version. */
export interface CatalogEntry {
  manifest: RecipeManifest;
  /** Shipped with the platform, or made in this project. */
  origin: 'builtin' | 'project';
  /** A project recipe's latest storage version ('v3'). */
  version?: string;
  author?: string;
  savedAt?: string;
}

/** One saved version of a project recipe. */
export interface RecipeVersion {
  version: string;
  author?: string;
  note?: string;
  savedAt?: string;
}

/**
 * What a recipe's code is given to work with (`context.kit`), the same tools the built-ins are written
 * with: reading the platform's records out of a model, building the changes, units, fingerprints.
 */
export const RecipeKit = {
  OperationBuilder,
  OP_SCHEMA,
  readFrag,
  readPickedFrag,
  recordsOf,
  innerJson,
  levelsOf,
  levelNames,
  stylesOf,
  printOf,
  siteLocationOf,
  whatItMadeBefore,
  ELEMENT_FIELD,
  CARRIED_FIELD,
  FEET_PER_METRE,
};
export type RecipeKit = typeof RecipeKit;

/** A recipe name a file and a catalog can both carry: lower case, digits and dashes. */
export const RECIPE_NAME = /^[a-z0-9][a-z0-9-]{1,62}$/;

/** The project's recipes folder, found (or made, when asked) under its data folder. */
async function recipesFolder(
  client: EngineServicesClient,
  projectId: string,
  create: boolean,
): Promise<string | null> {
  const oldest = <T extends { _id?: unknown }>(all: T[]) =>
    [...all].sort((a, b) => String(a._id).localeCompare(String(b._id)))[0];
  const roots = await client.listFolders({ projectId, archived: false });
  let root = oldest(roots.filter((f) => f.name === DATA_FOLDER && !f.parentId));
  if (!root) {
    if (!create) return null;
    root = await client.createFolder(DATA_FOLDER, undefined, projectId);
  }
  const rootId = String(root._id);
  const children = await client.listFolders({ parentFolderId: rootId, projectId, archived: false });
  let folder = oldest(children.filter((f) => f.name === RECIPES_FOLDER && String(f.parentId) === rootId));
  if (!folder) {
    if (!create) return null;
    folder = await client.createFolder(RECIPES_FOLDER, rootId, projectId);
  }
  return String(folder._id);
}

const idOf = (item: { _id?: unknown; id?: unknown }) => String(item._id ?? item.id ?? '');
const tagOf = (v: { tag?: unknown; versionTag?: unknown }) => String(v.tag ?? v.versionTag ?? '');
const tagNumber = (tag: string) => Number(/(\d+)/.exec(tag)?.[1] ?? -1);

/** The project recipes' files, by recipe name. */
async function recipeFiles(client: EngineServicesClient, projectId: string) {
  const folderId = await recipesFolder(client, projectId, false);
  if (!folderId) return new Map<string, { id: string }>();
  const files = await client.listFiles({ folderId });
  const out = new Map<string, { id: string }>();
  for (const file of files) {
    const name = String((file as { name?: unknown }).name ?? '');
    if (name.endsWith('.recipe.json')) out.set(name.slice(0, -'.recipe.json'.length), { id: idOf(file as never) });
  }
  return out;
}

async function readRecipeFile(
  client: EngineServicesClient,
  fileId: string,
  version?: string,
): Promise<ProjectRecipeFile> {
  const response = await client.downloadFile(fileId, version ? { versionTag: version } : undefined);
  const file = JSON.parse(await response.text()) as ProjectRecipeFile;
  if (file?.schema !== PROJECT_RECIPE_SCHEMA || !file.manifest?.name || typeof file.code !== 'string') {
    throw new Error(`This is not a recipe this library can read (${String(file?.schema)}).`);
  }
  return file;
}

async function versionsOf(client: EngineServicesClient, fileId: string) {
  const versions = (await client.listVersions(fileId)) as { tag?: unknown; versionTag?: unknown; createdAt?: unknown }[];
  return versions
    .map((v) => ({ tag: tagOf(v), createdAt: String(v.createdAt ?? '') }))
    .filter((v) => v.tag)
    .sort((a, b) => tagNumber(a.tag) - tagNumber(b.tag));
}

/**
 * The project-recipe half of `client.recipes`: list, save, version and load. Kept apart from the registry
 * so the registry stays what the built-ins need and nothing more.
 */
export class ProjectRecipes {
  /** Compiled code, by file id and version: a version never changes, so it is compiled once. */
  readonly #compiled = new Map<string, Recipe<unknown>>();

  constructor(
    private readonly client: EngineServicesClient,
    private readonly builtinNames: () => Set<string>,
  ) {}

  /** The project's recipes, each its latest version. */
  async list(projectId: string): Promise<CatalogEntry[]> {
    const files = await recipeFiles(this.client, projectId);
    const entries = await Promise.all(
      [...files.entries()].map(async ([, { id }]) => {
        try {
          const versions = await versionsOf(this.client, id);
          const latest = versions[versions.length - 1]?.tag;
          const file = await readRecipeFile(this.client, id, latest);
          return {
            manifest: file.manifest,
            origin: 'project' as const,
            version: latest,
            author: file.author,
            savedAt: file.savedAt,
          };
        } catch {
          return null; // one unreadable file costs itself, never the catalog
        }
      }),
    );
    return entries.filter((e): e is NonNullable<typeof e> => e !== null);
  }

  /** Every saved version of a project recipe, oldest first. */
  async versions(projectId: string, name: string): Promise<RecipeVersion[]> {
    const file = (await recipeFiles(this.client, projectId)).get(name);
    if (!file) throw new Error(`The project has no recipe named "${name}".`);
    const versions = await versionsOf(this.client, file.id);
    return await Promise.all(
      versions.map(async ({ tag, createdAt }) => {
        try {
          const saved = await readRecipeFile(this.client, file.id, tag);
          return { version: tag, author: saved.author, note: saved.note, savedAt: saved.savedAt ?? createdAt };
        } catch {
          return { version: tag, savedAt: createdAt };
        }
      }),
    );
  }

  /** A project recipe's file as saved: its manifest and its code (the latest version unless one is named). */
  async source(projectId: string, name: string, version?: string): Promise<ProjectRecipeFile & { version: string }> {
    const file = (await recipeFiles(this.client, projectId)).get(name);
    if (!file) throw new Error(`The project has no recipe named "${name}".`);
    const tag = version ?? (await versionsOf(this.client, file.id)).pop()?.tag;
    if (!tag) throw new Error(`The recipe "${name}" has no saved version.`);
    return { ...(await readRecipeFile(this.client, file.id, tag)), version: tag };
  }

  /**
   * Saves a recipe in the project: a new file the first time, a new version after. Checked before it is
   * written: a valid name that is not a built-in's, a manifest that says what it writes, and code that
   * compiles and exports `run`. Returns the version it was saved as.
   */
  async save(
    projectId: string,
    recipe: { manifest: RecipeManifest; code: string },
    options: { author: string; note?: string },
  ): Promise<string> {
    const { manifest, code } = recipe;
    if (!RECIPE_NAME.test(manifest?.name ?? '')) {
      throw new Error('A recipe name is lower case letters, digits and dashes, 2 to 63 of them: "walls-from-ifc".');
    }
    if (this.builtinNames().has(manifest.name)) {
      throw new Error(`"${manifest.name}" is a built-in recipe. Give yours a name of its own.`);
    }
    if (!manifest.to || !manifest.description || !Array.isArray(manifest.inputs)) {
      throw new Error('A recipe says what it writes (`to`), what it does (`description`) and what it reads (`inputs`).');
    }
    await compileRecipe(manifest, code); // refuses code that does not load or has no run
    const file: ProjectRecipeFile = {
      schema: PROJECT_RECIPE_SCHEMA,
      manifest,
      code,
      author: options.author,
      ...(options.note ? { note: options.note } : {}),
      savedAt: new Date().toISOString(),
    };
    const blob = new Blob([JSON.stringify(file, null, 2)], { type: 'application/json' });
    const existing = (await recipeFiles(this.client, projectId)).get(manifest.name);
    if (existing) {
      const versions = await versionsOf(this.client, existing.id);
      const next = `v${Math.max(0, ...versions.map((v) => tagNumber(v.tag))) + 1}`;
      await this.client.createVersion(existing.id, blob, next);
      return next;
    }
    const folderId = await recipesFolder(this.client, projectId, true);
    await this.client.createFile({
      file: blob,
      name: fileName(manifest.name),
      versionTag: 'v1',
      projectId,
      parentFolderId: folderId!,
    } as never);
    return 'v1';
  }

  /** A project recipe, ready to run: the latest version unless one is named. */
  async load(projectId: string, name: string, version?: string): Promise<{ recipe: Recipe<unknown>; version: string }> {
    const file = (await recipeFiles(this.client, projectId)).get(name);
    if (!file) throw new Error(`The project has no recipe named "${name}".`);
    const tag = version ?? (await versionsOf(this.client, file.id)).pop()?.tag;
    if (!tag) throw new Error(`The recipe "${name}" has no saved version.`);
    const key = `${file.id}@${tag}`;
    let recipe = this.#compiled.get(key);
    if (!recipe) {
      const saved = await readRecipeFile(this.client, file.id, tag);
      recipe = await compileRecipe(saved.manifest, saved.code);
      this.#compiled.set(key, recipe);
    }
    return { recipe, version: tag };
  }
}

/**
 * Turns a recipe's code into a recipe: the module is loaded (a `data:` URL, which a page and node both
 * import) and its `run` is wrapped so it gets the kit. Throws, saying why, when it does not load or has
 * no `run`.
 */
export async function compileRecipe(manifest: RecipeManifest, code: string): Promise<Recipe<unknown>> {
  let module: { run?: unknown; default?: { run?: unknown } };
  try {
    const url = `data:text/javascript;base64,${toBase64(code)}`;
    module = await import(/* @vite-ignore */ url);
  } catch (error) {
    throw new Error(`The recipe's code does not load: ${error instanceof Error ? error.message : String(error)}`);
  }
  const run = (module.run ?? module.default?.run) as ((context: RecipeContext<unknown>) => Promise<RecipeResult>) | undefined;
  if (typeof run !== 'function') throw new Error('The recipe\'s code exports no `run(context)` function.');
  return { ...manifest, run: (context) => run({ ...context, kit: RecipeKit } as RecipeContext<unknown>) };
}

function toBase64(text: string): string {
  const bytes = new TextEncoder().encode(text);
  let binary = '';
  for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(binary);
}

/**
 * The changes a run asks for, as data a person (or an AI checking its recipe) can read: one entry per
 * change, in order, with its verb, the element it targets (for set and remove), the source it answers to,
 * and what it writes. No Revit needed: this is what the plugin would apply.
 */
export async function describeChanges(payload: Blob | Uint8Array): Promise<{
  envelope: Record<string, unknown>;
  changes: { op: string; target?: string; source?: string; attrs: Record<string, string> }[];
}> {
  const bytes = payload instanceof Uint8Array ? payload : new Uint8Array(await payload.arrayBuffer());
  const { items, metadata } = await readFrag(bytes);
  const changes = items
    .filter((item) => item.attrs['flow:op'])
    .map((item) => {
      const attrs: Record<string, string> = {};
      for (const [key, value] of Object.entries(item.attrs)) if (!key.startsWith('flow:')) attrs[key] = value;
      return {
        op: item.attrs['flow:op'],
        ...(item.guid ? { target: item.guid } : {}),
        ...(item.attrs['flow:source'] ? { source: item.attrs['flow:source'] } : {}),
        attrs,
      };
    });
  return { envelope: (metadata ?? {}) as Record<string, unknown>, changes };
}
