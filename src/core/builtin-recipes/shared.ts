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
import type { PickedSource, RecipeContext, SourceShapes } from '../recipes';
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
 * Source key -> the target's id of what this recipe made for it, and its
 * fingerprints (`flow:print`, what it was made from), as the target handed
 * them back ({@link RecipeContext.made}). The recipe keeps nothing of its own.
 */
export function whatItMadeBefore(
  context: { made: RecipeContext<unknown>['made'] },
  /** Filled, when given, with each source's last fingerprint. */
  prints?: Map<string, string>,
): Map<string, string> {
  const made = new Map<string, string>();
  for (const [source, one] of context.made) {
    made.set(source, one.id);
    if (one.print) prints?.set(source, one.print);
  }
  return made;
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
export type PickedFile = PickedSource;

/**
 * Downloads and reads the picked file, the version picked, with the errors a
 * person can act on. A .frag is read as it is; any other format (a raw IFC)
 * goes first through the importer the host provided for it
 * (`client.recipes.provideImporter`), so the person points the recipe at the
 * file they uploaded and nothing else.
 */
/**
 * A STREAMED .frag's contents, or null when the bytes are a whole file (15-11, the Revit video: what Designer saves is a
 * version record — `{ entry, parts: { container, sidecar, lod } }`, each a range of a hidden object — and `readFrag`
 * read that JSON as a deflated model, which the browser reports as «Failed to fetch»). Each object is downloaded once,
 * its ranges cut out, and the host's reader (`client.recipes.provideStreamedReader`) says what they hold.
 */
async function streamedContents(context: RecipeContext<unknown>, bytes: Uint8Array, name: string) {
  if (bytes[0] !== 0x7b /* { */) return null;
  type Range = { object: string; offset: number; length: number };
  let record: { entry?: Range; parts?: Record<string, Range[]> };
  try {
    record = JSON.parse(new TextDecoder().decode(bytes));
  } catch {
    return null;
  }
  if (!record?.entry?.object || !record.parts) return null;
  const reader = context.client.recipes.streamedReader();
  if (!reader) throw new Error(`${name} is a streamed model, and this app cannot read those: it provides no reader for them.`);
  context.progress(`Downloading the pieces of ${name}`);
  const objects = new Map<string, Promise<Uint8Array>>();
  const objectOf = (id: string) => {
    let got = objects.get(id);
    if (!got) {
      got = (async () => {
        const response = await context.client.downloadHiddenFile(id);
        if (!response.ok) throw new Error(`Reading a piece of ${name} answered ${response.status}`);
        return new Uint8Array(await response.arrayBuffer());
      })();
      objects.set(id, got);
    }
    return got;
  };
  const cut = async (ranges: Range[] | undefined) => {
    const pieces = await Promise.all((ranges ?? []).map(async (r) => (await objectOf(r.object)).subarray(r.offset, r.offset + r.length)));
    const out = new Uint8Array(pieces.reduce((n, p) => n + p.length, 0));
    let at = 0;
    for (const piece of pieces) { out.set(piece, at); at += piece.length; }
    return out;
  };
  const [entry, container, sidecar, lod] = await Promise.all([
    cut([record.entry]), cut(record.parts.container), cut(record.parts.sidecar), cut(record.parts.lod),
  ]);
  context.progress(`Reading ${name}`);
  return await reader({ entry, container, sidecar, lod }, name);
}

export async function readPickedFrag(
  context: RecipeContext<unknown>,
  picked: PickedFile | undefined,
  /** Also a whole .frag's shapes, when the host reads them (`provideShapes('frag')`): a Rhino model's objects made as families. */
  options?: { shapes?: boolean },
) {
  if (!picked?.fileId) throw new Error('Choose the model file to read.');
  context.progress(`Downloading ${picked.name}`);
  let bytes: Uint8Array = new Uint8Array(
    await (
      await context.client.downloadFile(
        picked.fileId,
        picked.version ? { versionTag: picked.version } : undefined,
      )
    ).arrayBuffer(),
  );
  const extension = /\.([^.]+)$/.exec(picked.name)?.[1]?.toLowerCase() ?? 'frag';
  let site: SiteLocation | null = null;
  /** The file's own shapes, when the host reads them (families are made from these). */
  let shapes: SourceShapes | null = null;
  if (extension !== 'frag') {
    const importer = context.client.recipes.importerFor(extension);
    if (!importer) {
      throw new Error(`This app cannot read .${extension} files: it provides no importer for them.`);
    }
    if (extension === 'ifc') site = siteLocationOf(bytes);
    const reader = context.client.recipes.shapesFor(extension);
    if (reader) {
      context.progress(`Reading the shapes of ${picked.name}`);
      shapes = await reader(bytes, picked.name);
    }
    context.progress(`Reading ${picked.name}`);
    bytes = await importer(bytes, picked.name);
  }
  const streamed = await streamedContents(context, bytes, picked.name);
  // (A whole .frag's shapes, asked for: read from the file itself, its render frame turned Z up by the host's reader.)
  if (extension === 'frag' && options?.shapes && !streamed) {
    const reader = context.client.recipes.shapesFor('frag');
    if (reader) {
      context.progress(`Reading the shapes of ${picked.name}`);
      shapes = await reader(bytes, picked.name);
    }
  }
  const contents = streamed ?? (await readFrag(bytes));
  // 🔴 THE SHAPES IN THE RECORDS' FRAME (Snowdon 13-11: its floors built at the origin, its families 417 km away, and walls
  // stretched from one to the other — past Revit's 32 km, every shape there was garbage). A file far from its origin is read
  // moved to it, records and items alike, and its mark keeps how far (`thatOpenModelling.origin`, metres, in plan: the
  // records are the file's points less it); the shapes are read where the file says, so they are moved the same way here,
  // once, for every recipe that reads them.
  const origin = (contents.metadata as { thatOpenModelling?: { origin?: number[] } } | undefined)?.thatOpenModelling?.origin;
  if (shapes && Array.isArray(origin) && (origin[0] || origin[1])) {
    const done = new Set<object>();
    for (const el of shapes.elements.values())
      for (const piece of el.pieces) {
        if (done.has(piece)) continue;
        done.add(piece);
        piece.matrix = piece.matrix.map((n, i) => (i === 12 ? n - (origin[0] ?? 0) : i === 13 ? n - (origin[1] ?? 0) : n));
      }
    // (A bar's axis is in the world too, and moved the same.)
    for (const el of shapes.elements.values())
      if (el.rebar) el.rebar = moveBar(el.rebar, (p) => [p[0] - (origin[0] ?? 0), p[1] - (origin[1] ?? 0), p[2]] as const);
  }
  // (And at the project's height, as the records are read — `atTheProjectsHeight`: DACH's site stands 500 m up, and its 195 bars
  // came in 500 m above their building, in no host, 13-11.)
  if (shapes && site?.elevation)
    for (const el of shapes.elements.values())
      if (el.rebar) el.rebar = moveBar(el.rebar, (p) => [p[0], p[1], p[2] - site!.elevation] as const);
  return { picked, contents, site, shapes };
}

type Bar = NonNullable<NonNullable<ReturnType<SourceShapes['elements']['get']>>['rebar']>;
/** A bar (every bar of its set) moved point by point. */
const moveBar = (bar: Bar, to: (p: readonly [number, number, number]) => readonly [number, number, number]): Bar => ({
  ...bar,
  path: bar.path.map(to),
  ...(bar.paths ? { paths: bar.paths.map((one) => one.map(to)) } : {}),
});

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
