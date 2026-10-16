/**
 * What every built-in recipe shares: reading the platform's own semantic
 * records out of a .frag, finding what a recipe already made, and the unit
 * and axis conversions into Revit.
 *
 * THE RECORDS. A .frag that went through the platform's editable converter
 * (or was modelled here) carries each element as JSON inside two item
 * attributes: `Element` (the item's own record) and `Carried` (records with
 * no body of their own: openings, levels). The field names are the modeling
 * engine's contract (`element-attributes.ts`: ELEMENT_FIELD, CARRIED_FIELD).
 * A .frag imported with the plain IfcImporter has NEITHER - only IFC
 * attributes - and the recipes refuse it by name rather than guess.
 *
 * UNITS AND AXES. Records are in METRES and radians; curve points are plane
 * [x, y] and placements [x, y, height]. Revit's API is FEET, Z up - so
 * [x, y, h] maps to Revit [x*s, y*s, h*s] with s = feet-per-metre. Item ids
 * like `run:0` are DOCUMENT-scoped, not GUIDs: a reconcile key must carry the
 * source file's identity next to them.
 */
import type { RecipeContext } from '../recipes';
import type { FlowSuggestion } from '../history';
import { readFrag, type FragItem } from '../frag-items';

/** The modeling engine's attribute names (its `element-attributes.ts`). */
export const ELEMENT_FIELD = 'Element';
export const CARRIED_FIELD = 'Carried';

/** Revit's internal length unit: where every position has to end up. */
export const FEET_PER_METRE = 1 / 0.3048;

/** One semantic record, as saved: `params` carries the kind-specific fields. */
export interface OurRecord {
  id: string;
  kind: string;
  params: Record<string, unknown>;
  /** The item it rode in (its guid is the publisher's id, when it has one). */
  item: FragItem;
}

/** Every record of a read .frag: items' `Element` plus their `Carried` lists. */
export function recordsOf(items: FragItem[]): OurRecord[] {
  const records: OurRecord[] = [];
  for (const item of items) {
    for (const field of [ELEMENT_FIELD, CARRIED_FIELD]) {
      const raw = item.attrs[field];
      if (!raw) continue;
      try {
        const parsed = JSON.parse(raw) as unknown;
        for (const one of Array.isArray(parsed) ? parsed : [parsed]) {
          const record = one as {
            id?: unknown;
            kind?: unknown;
            params?: unknown;
          };
          if (typeof record?.id !== 'string' || typeof record?.kind !== 'string')
            continue;
          records.push({
            id: record.id,
            kind: record.kind,
            params: (record.params ?? {}) as Record<string, unknown>,
            item,
          });
        }
      } catch {
        // One broken record costs itself, never the file.
      }
    }
  }
  return records;
}

/**
 * A param the converter double-encodes (`params.run`, `params.member`,
 * `params.definition`... are JSON IN TEXT inside the record's JSON).
 */
export function innerJson<T>(record: OurRecord, param: string): T | null {
  const raw = record.params[param];
  if (typeof raw !== 'string') return null;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
}

/** Level id (`datum:N`) -> its name, from the document's datum records. */
export function levelNames(records: OurRecord[]): Map<string, string> {
  const names = new Map<string, string>();
  for (const [id, level] of levelsOf(records)) names.set(id, level.name);
  return names;
}

/** Level id -> name and elevation (metres), from the datum records. */
export function levelsOf(
  records: OurRecord[],
): Map<string, { name: string; at: number }> {
  const levels = new Map<string, { name: string; at: number }>();
  for (const record of records) {
    if (record.kind !== 'datum' || record.params.of !== 'level') continue;
    const named = record.params.named;
    const at = record.params.at;
    if (typeof named === 'string' && typeof at === 'number')
      levels.set(record.id, { name: named, at });
  }
  return levels;
}

/** Styles by name (`lookRef` points here): the record, for thickness hints. */
export function stylesOf(records: OurRecord[]): Map<string, OurRecord> {
  const styles = new Map<string, OurRecord>();
  for (const record of records) {
    if (!record.kind.endsWith('Style')) continue;
    const name = record.params.name;
    if (typeof name === 'string') styles.set(name, record);
  }
  return styles;
}

/**
 * Source id -> what this recipe already made for it, read back from its own
 * APPLIED suggestions: the i-th id the target answered with is what the i-th
 * change made. It keeps nothing of its own, so it behaves the same whoever
 * runs it and wherever (the pattern the first end-to-end conversion proved).
 */
export async function whatItMadeBefore(
  context: RecipeContext<never> | RecipeContext<unknown>,
  author: string,
): Promise<Map<string, string>> {
  const made = new Map<string, string>();
  const applied = (await context.targetDoc.suggestions())
    .filter(
      (one: FlowSuggestion) =>
        one.author === author &&
        one.state === 'applied' &&
        one.fragId &&
        (one.affectedIds?.length ?? 0) > 0,
    )
    .sort((a, b) => String(a.createdAt).localeCompare(String(b.createdAt)));
  for (const suggestion of applied) {
    try {
      const payload = await context.targetDoc.suggestionPayload(suggestion);
      const { items } = await readFrag(
        new Uint8Array(await payload.arrayBuffer()),
      );
      // The changes, in payload order; the item that groups them has no verb.
      const changes = items.filter((item) => item.attrs['flow:op']);
      const ids = suggestion.affectedIds ?? [];
      for (let i = 0; i < changes.length && i < ids.length; i++) {
        const source = changes[i].attrs['flow:source'];
        if (!source) continue;
        if (changes[i].attrs['flow:op'] === 'remove') made.delete(source);
        else made.set(source, ids[i]);
      }
    } catch {
      // A payload that cannot be read costs its pairings and nothing else:
      // the worst that follows is a duplicate, never a wrong model.
    }
  }
  return made;
}

/** The project file the person picked as a recipe's source. */
export interface PickedFile {
  fileId: string;
  name: string;
}

/**
 * Downloads and reads the picked file, with the errors a person can act on. A
 * .frag is read as it is; any other format (a raw IFC) goes first through the
 * importer the app provided for it (`client.recipes.provideImporter`), so the
 * person points the recipe at the file they uploaded and nothing else.
 */
export async function readPickedFrag(
  context: RecipeContext<unknown>,
  picked: PickedFile | undefined,
) {
  if (!picked?.fileId) throw new Error('Choose the model file to read.');
  let bytes = new Uint8Array(
    await (await context.client.downloadFile(picked.fileId)).arrayBuffer(),
  );
  const extension = /\.([^.]+)$/.exec(picked.name)?.[1]?.toLowerCase() ?? 'frag';
  if (extension !== 'frag') {
    const importer = context.client.recipes.importerFor(extension);
    if (!importer) {
      throw new Error(`This app cannot read .${extension} files: it provides no importer for them.`);
    }
    bytes = await importer(bytes, picked.name);
  }
  return { picked, contents: await readFrag(bytes) };
}
