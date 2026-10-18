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
  /** Filled, when given, with each source's last fingerprint (`flow:print`): what it was made from. */
  prints?: Map<string, string>,
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
        if (changes[i].attrs['flow:op'] === 'remove') {
          made.delete(source);
          prints?.delete(source);
        } else {
          made.set(source, ids[i]);
          const print = changes[i].attrs['flow:print'];
          if (print) prints?.set(source, print);
        }
      }
    } catch {
      // A payload that cannot be read costs its pairings and nothing else:
      // the worst that follows is a duplicate, never a wrong model.
    }
  }
  return made;
}

/**
 * A recipe that has nothing to ask for: everything it would propose is in the target already, as
 * the source has it. Not a failure: a run says «up to date» for it.
 */
export class NothingToPropose extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'NothingToPropose';
  }
}

/** A short, stable fingerprint of what a change asks for (FNV-1a over its JSON, keys sorted). */
export function printOf(value: unknown): string {
  const sorted = (v: unknown): unknown =>
    Array.isArray(v)
      ? v.map(sorted)
      : v && typeof v === 'object'
        ? Object.fromEntries(Object.keys(v as object).sort().map((k) => [k, sorted((v as Record<string, unknown>)[k])]))
        : v;
  const text = JSON.stringify(sorted(value));
  let hash = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(36);
}

/** The project file the person picked as a recipe's source. */
export interface PickedFile {
  fileId: string;
  name: string;
  /** The storage version to read (its versionTag); the latest when absent. */
  version?: string;
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
  let site: SiteLocation | null = null;
  if (extension !== 'frag') {
    const importer = context.client.recipes.importerFor(extension);
    if (!importer) {
      throw new Error(`This app cannot read .${extension} files: it provides no importer for them.`);
    }
    if (extension === 'ifc') site = siteLocationOf(bytes);
    bytes = await importer(bytes, picked.name);
  }
  return { picked, contents: await readFrag(bytes), site };
}

/**
 * Where an IFC's site stands in the coordinates it was written in: its origin
 * (metres) and the angle of its X axis (degrees, counter-clockwise). An IFC
 * Revit writes in shared coordinates places its site exactly at the source
 * model's shared location (racbasic: -19.82 m, -18.81 m, 37°), so a Revit
 * document that shares no coordinates yet can be given the same location and
 * receive the building square to its own axes.
 */
export interface SiteLocation {
  east: number;
  north: number;
  elevation: number;
  angleDeg: number;
}

/** Read from the IFC's text, with no IFC library: IFCSITE → its placement → its axis placement, in the file's length unit. */
export function siteLocationOf(bytes: Uint8Array): SiteLocation | null {
  const text = new TextDecoder('latin1').decode(bytes);
  const entity = (id: string) => new RegExp(`^${id}=\\s*([A-Z0-9_]+)\\((.*)\\);\\s*$`, 'm').exec(text);
  const refs = (args: string) => [...args.matchAll(/#\d+|\$/g)].map((m) => m[0]);
  const numbers = (args: string) => [...args.matchAll(/-?\d+(?:\.\d*)?(?:E[-+]?\d+)?/gi)].map((m) => Number(m[0]));
  const site = /^(#\d+)=\s*IFCSITE\((.*)\);\s*$/m.exec(text);
  if (!site) return null;
  // IFCSITE(GlobalId, OwnerHistory, Name, Description, ObjectType, ObjectPlacement, ...): the sixth.
  const placementRef = site[2].split(',')[5]?.trim();
  if (!placementRef?.startsWith('#')) return null;
  const local = entity(placementRef);
  if (local?.[1] !== 'IFCLOCALPLACEMENT') return null;
  const [relativeTo, axisRef] = refs(local[2]);
  // Placed relative to something else: its numbers alone are not where it stands.
  if (relativeTo !== '$' || !axisRef) return null;
  const axis = entity(axisRef);
  if (axis?.[1] !== 'IFCAXIS2PLACEMENT3D') return null;
  const [pointRef, , xRef] = refs(axis[2]);
  const point = pointRef && pointRef !== '$' ? entity(pointRef) : null;
  if (!point) return null;
  const [x = 0, y = 0, z = 0] = numbers(point[2]);
  let angleDeg = 0;
  const xDir = xRef && xRef !== '$' ? entity(xRef) : null;
  if (xDir) {
    const [dx = 1, dy = 0] = numbers(xDir[2]);
    angleDeg = (Math.atan2(dy, dx) * 180) / Math.PI;
  }
  // The file's length unit: an SI length with a prefix (MILLI, CENTI) or plain metres; feet by a conversion.
  const si = /IFCSIUNIT\([^)]*\.LENGTHUNIT\.\s*,\s*(\.([A-Z]+)\.|\$)\s*,\s*\.METRE\./i.exec(text);
  const prefixes: Record<string, number> = { MILLI: 0.001, CENTI: 0.01, DECI: 0.1, KILO: 1000 };
  const toMetres = si ? (si[2] ? (prefixes[si[2].toUpperCase()] ?? 1) : 1) : /IFCCONVERSIONBASEDUNIT\([^)]*\.LENGTHUNIT\.[^)]*'FOOT'/i.test(text) ? 0.3048 : 1;
  return { east: x * toMetres, north: y * toMetres, elevation: z * toMetres, angleDeg };
}
