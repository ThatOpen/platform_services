/**
 * The platform's own records become the modelling tool change requests: one engine, two
 * recipes. `frag-to-the modelling tool` reads a model made or edited here (Designer);
 * `ifc-to-the modelling tool` reads the frag an IFC was converted into. Same records,
 * same rules - the only difference is where the file came from, and the
 * recipe saying so to the person.
 *
 * WHOLE BUILDINGS, not demos: levels, walls, curtain walls, stairs, floors,
 * roofs, ceilings, columns and free-standing instances are all written,
 * in ONE operation - levels first because everything stands on them, by name.
 * The applier materialises each natively (Wall.Create, the curtain grid,
 * stair runs, Floor/Roof/Ceiling.Create, Level ensured by name) and makes
 * missing system types from the carried `Type.Width`. What it cannot create
 * yet - hosted doors and windows, footings, ramps - is READ and TALLIED, and
 * the rules table says so; that row empties as the applier grows, without
 * the recipes changing shape.
 *
 * CONVENTIONS, stated once: records are metres and radians, plane [x, y]
 * with height as the third coordinate, levels referenced as `datum:N` and
 * resolved to names; changes are written in the modelling tool's own terms - feet,
 * degrees, types by exact name. Record ids are DOCUMENT-scoped, so every
 * reconcile key carries the source file's id next to them.
 */
import { UpToDate, type Recipe, type RecipeContext } from '../recipes';
import { OperationBuilder } from '../op-builder';
import {
  FEET_PER_METRE,
  innerJson,
  levelsOf,
  printOf,
  readPickedFrag,
  recordsOf,
  stylesOf,
  whatItMadeBefore,
  type PickedFile,
} from './shared';
import { categoryOfName, extentAcross, familiesFromShapes, startsWithACategory, openingsFromShapes, pointsOf as shapePoints, roofOverWall, roomsFromShapes, shapedPanelsOf, wallTopOf } from './shapes-to-families';

/** the modelling tool's own category ids, printed from the modelling tool's API - never guessed. */
const CATEGORY = {
  levels: '-2000240',
  walls: '-2000011',
  floors: '-2000032',
  roofs: '-2000035',
  ceilings: '-2000038',
  structuralFoundations: '-2001300',
  stairs: '-2000120',
  railings: '-2000126',
  rebar: '-2009000',
};

/**
 * The native family and type a record's element had where it was authored, when the file says:
 * an IFC exported from the modelling tool names every element "Family:Type:ElementId". A model that came FROM
 * the modelling tool goes back with its own type names; anything else keeps the record's style name.
 */
/**
 * 🔴 THE UNION OF LOOPS THAT TOUCH (a client's model 13-11: a ceiling written as two rectangles side by side, «CL-UB03.02», read as its
 * first, 13.6 m of its 32.2): each loop turned counter-clockwise, every side split where another's corner lies on it, the sides
 * met once each way taken away (they are inside), the rest chained again; corners that do not turn dropped. Plan points; the
 * loops that come out, the outer ones counter-clockwise and any hole clockwise.
 */
export function unionOfLoops(loops: number[][][]): number[][][] {
  const area = (l: number[][]) => l.reduce((a, p, i) => { const q = l[(i + 1) % l.length]!; return a + p[0]! * q[1]! - q[0]! * p[1]!; }, 0) / 2;
  const key = (p: number[]) => `${Math.round(p[0]! * 1e4)}|${Math.round(p[1]! * 1e4)}`;
  const turned = loops.filter((l) => l.length >= 3).map((l) => (area(l) < 0 ? [...l].reverse() : l));
  const corners = turned.flat();
  const sides = new Map<string, [number[], number[]]>();
  for (const l of turned)
    for (let i = 0; i < l.length; i++) {
      const p = l[i]!, q = l[(i + 1) % l.length]!;
      const long = Math.hypot(q[0]! - p[0]!, q[1]! - p[1]!);
      if (!(long > 1e-6)) continue;
      const d = [(q[0]! - p[0]!) / long, (q[1]! - p[1]!) / long];
      const on = corners
        .map((r) => ({ r, t: (r[0]! - p[0]!) * d[0]! + (r[1]! - p[1]!) * d[1]! }))
        .filter(({ r, t }) => t > 1e-4 && t < long - 1e-4 && Math.abs((r[0]! - p[0]!) * d[1]! - (r[1]! - p[1]!) * d[0]!) < 1e-4)
        .sort((x, y) => x.t - y.t).map(({ r }) => r);
      const chain = [p, ...on, q];
      for (let k = 0; k + 1 < chain.length; k++) {
        const [u, v] = [chain[k]!, chain[k + 1]!];
        const [ku, kv] = [key(u), key(v)];
        if (ku === kv) continue;
        if (sides.has(`${kv}>${ku}`)) sides.delete(`${kv}>${ku}`);
        else sides.set(`${ku}>${kv}`, [u, v]);
      }
    }
  const next = new Map<string, number[]>();
  for (const [p, q] of sides.values()) next.set(key(p), q);
  const out: number[][][] = [];
  const used = new Set<string>();
  for (const [p] of sides.values()) {
    if (used.has(key(p))) continue;
    const loop: number[][] = [];
    for (let at: number[] | undefined = p, guard = 0; at && !used.has(key(at)) && guard < 100000; guard++) { used.add(key(at)); loop.push(at); at = next.get(key(at)); }
    const turning = loop.filter((r, i) => { const o = loop[(i - 1 + loop.length) % loop.length]!, t = loop[(i + 1) % loop.length]!; return Math.abs((r[0]! - o[0]!) * (t[1]! - r[1]!) - (r[1]! - o[1]!) * (t[0]! - r[0]!)) > 1e-9; });
    if (turning.length >= 3) out.push(turning);
  }
  return out;
}

/**
 * The outline of a union of rectangles [x0, y0, x1, y1] (a stepped curtain wall's pieces, in its plane), counter-clockwise,
 * its corners only; null unless the union is one piece with no hole. Edges within 5 mm are one.
 */
function outlineOfBoxes(boxes: number[][]): number[][] | null {
  const snap = (v: number) => Math.round(v / 0.005) * 0.005;
  const xs = [...new Set(boxes.flatMap((b) => [snap(b[0]), snap(b[2])]))].sort((a, b) => a - b);
  const ys = [...new Set(boxes.flatMap((b) => [snap(b[1]), snap(b[3])]))].sort((a, b) => a - b);
  if (xs.length > 400 || ys.length > 400) return null;
  const nx = xs.length - 1, ny = ys.length - 1;
  const on = (i: number, j: number) => i >= 0 && j >= 0 && i < nx && j < ny && grid[j * nx + i];
  const grid = new Array<boolean>(nx * ny).fill(false);
  for (const b of boxes) {
    const i0 = xs.indexOf(snap(b[0])), i1 = xs.indexOf(snap(b[2])), j0 = ys.indexOf(snap(b[1])), j1 = ys.indexOf(snap(b[3]));
    for (let j = j0; j < j1; j++) for (let i = i0; i < i1; i++) grid[j * nx + i] = true;
  }
  // (Gaps between pieces narrower than a bar are the wall's own: filled.)
  for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) if (!grid[j * nx + i] && xs[i + 1] - xs[i] < 0.03 && on(i - 1, j) && on(i + 1, j)) grid[j * nx + i] = true;
  for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) if (!grid[j * nx + i] && ys[j + 1] - ys[j] < 0.03 && on(i, j - 1) && on(i, j + 1)) grid[j * nx + i] = true;
  // Its boundary edges, each cell's sides with nothing beyond, counter-clockwise (inside on the left).
  const next = new Map<string, string[]>();
  const keyOf = (i: number, j: number) => `${i},${j}`;
  const edge = (a: [number, number], b: [number, number]) => { const k = keyOf(...a); next.set(k, [...(next.get(k) ?? []), keyOf(...b)]); };
  let count = 0;
  for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) {
    if (!grid[j * nx + i]) continue;
    if (!on(i, j - 1)) { edge([i, j], [i + 1, j]); count++; }
    if (!on(i + 1, j)) { edge([i + 1, j], [i + 1, j + 1]); count++; }
    if (!on(i, j + 1)) { edge([i + 1, j + 1], [i, j + 1]); count++; }
    if (!on(i - 1, j)) { edge([i, j + 1], [i, j]); count++; }
  }
  if (!count) return null;
  const start = next.keys().next().value as string;
  const loop: string[] = [start];
  let at = start;
  for (let guard = 0; guard <= count; guard++) {
    const outs = next.get(at);
    if (!outs?.length) return null;
    at = outs.shift()!;
    if (at === start) break;
    loop.push(at);
  }
  // One loop only: every boundary edge used.
  if (loop.length !== count || [...next.values()].some((v) => v.length)) return null;
  const pts = loop.map((k) => { const [i, j] = k.split(',').map(Number); return [xs[i], ys[j]]; });
  // Its corners only.
  return pts.filter((p, k) => { const a = pts[(k - 1 + pts.length) % pts.length], b = pts[(k + 1) % pts.length]; return Math.abs((p[0] - a[0]) * (b[1] - p[1]) - (p[1] - a[1]) * (b[0] - p[0])) > 1e-9; });
}

function nativeOf(record: { item: { attrs: Record<string, string> } }): { family: string; type: string } | null {
  let name = record.item.attrs.Name;
  if (typeof name !== 'string') return null;
  // (A name that starts with its the modelling tool category, «Structural Foundations : M_Pile : 500mm»: the family is the second.)
  if (startsWithACategory(name)) {
    name = name.slice(name.indexOf(':') + 1);
    // (Such names carry no element id at the end: «Family : Type».)
    if (name.indexOf(':') === name.lastIndexOf(':') && name.includes(':')) {
      const [family, type] = name.split(':').map((part) => part.trim());
      return family && type ? { family, type } : null;
    }
  }
  const first = name.indexOf(':');
  const last = name.lastIndexOf(':');
  if (first <= 0 || last <= first) return null;
  const type = name.slice(first + 1, last).trim();
  return type ? { family: name.slice(0, first).trim(), type } : null;
}

/**
 * What a slab record is in the modelling tool, by the family it came from: a floor, a roof made by its
 * footprint, a foundation slab, or something this recipe does not make as a slab (a pad, a stair's
 * landing). Without a native name it is a floor, as before.
 */
function slabKind(record: { item: { attrs: Record<string, string> } }): 'floor' | 'roof' | 'foundation' | 'other' {
  const native = nativeOf(record);
  const predefined = record.item.attrs.PredefinedType;
  if (!native) return 'floor';
  if (/escalera|stair|landing|descansillo/i.test(native.family) || predefined === 'LANDING') return 'other';
  // 🔴 A PILE OR A PILE CAP IS NO SLAB (school_str 13-11: 121 steel piles made foundation slabs, 175 caps generic): an
  // isolated foundation of the file's shape — and so is anything its name files under structural foundations that is no
  // foundation slab.
  if (/pile|pilote|encepado|pfahl/i.test(native.family)) return 'other';
  if (categoryOfName(record.item.attrs.Name) === 'OST_StructuralFoundation' && !/slab|losa|platte|radier|dalle/i.test(native.family)) return 'other';
  if (/plataforma|^pad\b|building pad/i.test(native.family)) return 'other';
  if (/cubierta|roof/i.test(native.family) || predefined === 'ROOF') return 'roof';
  if (/cimentaci|foundation/i.test(native.family) || predefined === 'BASESLAB') return 'foundation';
  return 'floor';
}

/** A family type of the target, as the target publishes it. */
interface NativeType {
  categoryId: string;
  family: string;
  type: string;
}

interface Settings {
  /** The modelling tool type columns get, when style names are not trusted. */
  columnType?: NativeType;
  /** The modelling tool door and window types the model's hosted doors and windows get, when style names are not trusted. */
  doorType?: NativeType;
  windowType?: NativeType;
  /**
   * Trust the records' own style names: `lookRef` "Family:Type" becomes the
   * change's Family and Type verbatim, for columns and instances. the modelling tool
   * matches a type exactly and refuses the whole request when one is missing
   * - right for a model that came FROM this the modelling tool, wrong for anything else.
   * (Walls and floors always go by their style name: system types are named
   * identity, and the applier makes a missing one from the carried width.)
   */
  trustStyleNames?: boolean;
  /** Also bring free-standing family instances (furniture, equipment). Needs trustStyleNames. */
  includeInstances?: boolean;
  /** Carry the model's levels (ensured by name on the target). Default true. */
  createLevels?: boolean;
}

/** The saved member's inner JSON (`params.member`). */
interface MemberBody {
  of?: string;
  start?: [number, number, number];
  roll?: number;
  level?: string;
}

/** The saved instance's inner JSON (`params.instance`). */
interface InstanceBody {
  placement?: {
    at?: [number, number, number];
    right?: [number, number, number];
  };
  host?: string | null;
}

/** A run's inner JSON (`params.run`): the wall's line and bounds. */
interface RunBody {
  run?: { line?: { curves?: CurveJson[]; closed?: boolean } };
  base?: number;
  height?: number;
  level?: string;
}

/** An extrusion's inner JSON (`params.extrusion`): the slab's profile. */
interface ExtrusionBody {
  profile?: {
    outline?: { curves?: CurveJson[]; closed?: boolean };
    holes?: { curves?: CurveJson[] }[];
  };
  level?: string;
}

interface CurveJson {
  kind?: string;
  from?: [number, number];
  to?: [number, number];
}

const DEGREES = 180 / Math.PI;

/** "Family:Type" as the styles name things; null when it does not split. */
function familyAndType(lookRef: unknown): { family: string; type: string } | null {
  if (typeof lookRef !== 'string') return null;
  const colon = lookRef.indexOf(':');
  if (colon <= 0 || colon === lookRef.length - 1) return null;
  return { family: lookRef.slice(0, colon), type: lookRef.slice(colon + 1) };
}

const num = (v: number) => String(v);

// A wall outline without its crumbs: a corner whose triangle with its neighbours is under 2 cm²
// and that sits on an edge under 2 cm goes (Schependomlaan's 5 «balkonopstand» carry a notch 1 cm
// high and 6 to 34 mm wide at their foot, and the modelling tool deletes each wall as «line too short»).
// Straight-through corners left behind go too.
function withoutSlivers(loop: [number, number][]): [number, number][] {
  const pts = loop.slice();
  const tri = (a: number[], b: number[], c: number[]) => Math.abs((b[0] - a[0]) * (c[1] - a[1]) - (c[0] - a[0]) * (b[1] - a[1])) / 2;
  for (let changed = true; changed && pts.length > 3;) {
    changed = false;
    for (let k = 0; k < pts.length && pts.length > 3; k++) {
      const a = pts[(k - 1 + pts.length) % pts.length], b = pts[k], c = pts[(k + 1) % pts.length];
      const short = Math.min(Math.hypot(b[0] - a[0], b[1] - a[1]), Math.hypot(c[0] - b[0], c[1] - b[1])) < 0.02;
      if (tri(a, b, c) < 1e-8 || (short && tri(a, b, c) < 2e-4)) { pts.splice(k, 1); changed = true; k--; }
    }
  }
  return pts;
}

function sharedRun(to: 'frag' | 'ifc') {
  return async (context: RecipeContext<Settings>) => {
    const { picked, contents, site, shapes } = await readPickedFrag(
      context,
      context.input as PickedFile | undefined,
    );
    const records = recordsOf(contents.items);
    // WHICH FRAME THE COORDINATES ARE IN. An IFC exported from the modelling tool in shared coordinates says
    // so in its header («CoordinateBase: Shared Coordinates», localised). Those positions are the
    // project's SHARED ones, not the target's internal ones: every change is marked so, and the
    // applier converts through the target's own shared location. A target that shares
    // coordinates with the source then gets each element where the source had it.
    const sharedFrame = /CoordinateBase:\s*(Coordenadas compartidas|Shared Coordinates|Shared)/i.test(
      JSON.stringify(contents.metadata ?? {}),
    );
    // AND WHICH SHARED LOCATION THAT IS: the IFC's site stands at it. Sent with every change, so a
    // target that shares no coordinates yet (a new document, its location the default one) is given
    // it by the applier before anything is built, and the building lands square to its axes. Without
    // it a new document got racbasic turned 37° and the modelling tool rolled the request back (17-10).
    // `SharedAt` = "east,north,elevation" in feet and the angle in degrees.
    const sharedAt =
      sharedFrame && site
        ? [site.east * FEET_PER_METRE, site.north * FEET_PER_METRE, site.elevation * FEET_PER_METRE, site.angleDeg]
            .map((n) => n.toFixed(6))
            .join(',')
        : undefined;
    if (records.length === 0) {
      throw new Error(
        to === 'ifc'
          ? `Nothing in "${picked.name}" could be read as a building element (walls, floors, levels...).`
          :`"${picked.name}" carries no platform records, so there is nothing semantic to convert.`,
      );
    }

    const { columnType, doorType, windowType, trustStyleNames, includeInstances } = context.settings;
    const createLevels = context.settings.createLevels !== false;
    if (includeInstances && !trustStyleNames) {
      throw new Error(
        'Free-standing instances can only be made by their style names: turn trustStyleNames on.',
      );
    }

    const levels = levelsOf(records);
    const styles = stylesOf(records);
    if (typeof process !== 'undefined' && process.env?.RECIPE_STYLE) for (const [k, v] of styles) if (k.includes(process.env.RECIPE_STYLE)) console.error(`[style] ${k}: ${JSON.stringify(v).slice(0, 1500)}`);
    const author = `recipe:${to}-to-revit`;
    const env0: Record<string, string | undefined> = typeof process !== 'undefined' ? process.env : {};
    const prints = new Map<string, string>();
    const made = whatItMadeBefore(context, prints);
    context.progress('Writing the changes for the modelling tool');
    const operation = new OperationBuilder({
      project: context.projectId,
      document: context.target.docId ?? '',
      baseCommit: context.target.version ?? 0,
      author,
    });
    // Records are metres; the modelling tool is feet. Plane [x, y] + height is the modelling tool
    // [x, y, z] directly - both are Z up in these records.
    const s = FEET_PER_METRE;
    // 🔴 A SOURCE KEY SURVIVES A NEW VERSION OF THE FILE (Antonio, 18-10: a changed IFC is
    // propagated, not imported again). The converter numbers its records in reading order (run:8),
    // which a new version reshuffles; the element's own id (an IFC GlobalId, the item's guid) does
    // not. So a record is keyed by its item's guid, its kind and its place among that item's records
    // of that kind; by its number only when its item has no guid.
    const stableKeys = new Map<string, string>();
    {
      const seenInItem = new Map<string, number>();
      for (const record of records) {
        const guid = record.item.guid;
        if (!guid) continue;
        const slot = `${guid}:${record.kind}`;
        const n = seenInItem.get(slot) ?? 0;
        seenInItem.set(slot, n + 1);
        stableKeys.set(record.id, `${picked.fileId}:${slot}${n ? `:${n}` : ''}`);
      }
    }
    const key = (recordId: string) => stableKeys.get(recordId) ?? `${picked.fileId}:${recordId}`;
    const seen = new Set<string>();
    /** A curtain wall's panels made as families of their own shape, their cells left empty (see 2b). */
    const shapedPanels = new Set<string>();

    /**
     * Adds once per source key. One already made is KEPT when the source asks for the same thing it
     * was made from (its fingerprint, `flow:print`), and REPLACED when the source changed: removed
     * and made again from the new version (the applier's `set` moves and writes fields, it does not
     * rebuild a wall's shape). Made before fingerprints existed: kept.
     */
    let kept = 0;
    let changed = 0;
    // A FOCUSED RUN (the bench, 24-10, Antonio's idea): only what `settings.focus` names (element gids) and what it
    // touches is written: its type's every other element (a type is made by its first), its host and what it
    // hosts, the walls its ends meet, what its top is attached to. Each change waits in `pending` until all are
    // known, then those kept go (see `flushFocus`).
    const focus = Array.isArray((context.settings as { focus?: unknown }).focus) ? new Set((context.settings as { focus: string[] }).focus) : null;
    const pending: { sourceKey: string; attrs: Record<string, string>; placement?: { position?: [number, number, number]; rotationDeg?: number; host?: string } }[] = [];
    const flushFocus = () => {
      if (!focus) return;
      const gidOf = (k: string | undefined) => (k ? k.split(':')[1] : undefined);
      const kept = new Set<number>();
      const ends = (a: Record<string, string>) => (a.LocationLine ?? '').split(';').map((p) => p.split(',').map(Number)).filter((p) => p.length >= 2 && p.every(Number.isFinite));
      const keep = (i: number) => { if (!kept.has(i)) { kept.add(i); grew = true; } };
      let grew = true;
      pending.forEach((p, i) => { if (focus.has(gidOf(p.sourceKey) ?? '')) keep(i); });
      // Grown until nothing more joins (a focused wall's type brings its other walls, not their neighbours' types).
      for (let round = 0; grew && round < 2; round++) {
        grew = false;
        const types = new Set([...kept].map((i) => `${pending[i].attrs.CategoryId}|${pending[i].attrs.Type ?? ''}`));
        const gids = new Set([...kept].map((i) => gidOf(pending[i].sourceKey)));
        const keys = new Set([...kept].map((i) => pending[i].sourceKey));
        const keptEnds = [...kept].flatMap((i) => ends(pending[i].attrs));
        pending.forEach((p, i) => {
          if (kept.has(i)) return;
          const a = p.attrs;
          if (a.Type && types.has(`${a.CategoryId}|${a.Type}`)) return keep(i);
          if (p.placement?.host && (keys.has(p.placement.host) || gids.has(gidOf(p.placement.host)))) return keep(i);
          if (a.AttachTop && keys.has(a.AttachTop)) return keep(i);
          if (a.CutBy && a.CutBy.split('|').some((k) => keys.has(k))) return keep(i);
          if (round === 0 && ends(a).some((q) => keptEnds.some((r) => Math.hypot(q[0] - r[0], q[1] - r[1]) < 1))) return keep(i);
        });
        // And what the kept are hosted in or attached to.
        for (const i of [...kept]) {
          const host = pending[i].placement?.host, top = pending[i].attrs.AttachTop, cutters = (pending[i].attrs.CutBy ?? '').split('|');
          pending.forEach((q, j) => { if (q.sourceKey === host || q.sourceKey === top || cutters.includes(q.sourceKey)) keep(j); });
        }
      }
      // Levels and anything without an element of its own (no gid) always go.
      pending.forEach((p, i) => { if (!/^[0-9A-Za-z_$]{22}$/.test(gidOf(p.sourceKey) ?? '')) kept.add(i); });
      for (const i of [...kept].sort((x, y) => x - y)) operation.add(pending[i].attrs, { ...pending[i].placement, source: pending[i].sourceKey });
      if (typeof process !== 'undefined') console.error(`[focus] ${focus.size} asked, ${kept.size} of ${pending.length} change(s) written`);
    };
    /** Whether `add` would keep what it made before for this change (made, and its print the same). */
    const wouldKeep = (sourceKey: string, attrs: Record<string, string>, placement?: { position?: [number, number, number]; rotationDeg?: number; host?: string }) => {
      if (!made.has(sourceKey)) return false;
      const before = prints.get(sourceKey);
      const framed = sharedFrame ? { ...attrs, Frame: 'shared', ...(sharedAt ? { SharedAt: sharedAt } : {}) } : attrs;
      return !before || before === printOf({ attrs: framed, placement: placement ?? {} });
    };
    // What each was written with, for what comes later to read (a wall's outline and its holes).
    const written = new Map<string, Record<string, string>>();
    const add = (
      sourceKey: string,
      attrs: Record<string, string>,
      placement?: { position?: [number, number, number]; rotationDeg?: number; host?: string },
    ) => {
      seen.add(sourceKey);
      written.set(sourceKey, attrs);
      const framed = sharedFrame ? { ...attrs, Frame: 'shared', ...(sharedAt ? { SharedAt: sharedAt } : {}) } : attrs;
      const print = printOf({ attrs: framed, placement: placement ?? {} });
      const madeId = made.get(sourceKey);
      if (madeId) {
        const before = prints.get(sourceKey);
        if (!before || before === print) {
          kept++;
          return false;
        }
        operation.remove(madeId);
        operation.add({ ...framed, 'flow:print': print }, { ...placement, source: sourceKey });
        changed++;
        return false;
      }
      if (focus) { pending.push({ sourceKey, attrs: { ...framed, 'flow:print': print }, placement }); return true; }
      operation.add({ ...framed, 'flow:print': print }, { ...placement, source: sourceKey });
      return true;
    };

    const thicknessOf = (lookRef: unknown): number | undefined => {
      const style =
        typeof lookRef === 'string' ? styles.get(lookRef) : undefined;
      const thickness = style?.params.thickness;
      return typeof thickness === 'number' && thickness > 0
        ? thickness * s
        : undefined;
    };

    // A GABLE ROOF, read once: four edges, two opposite ones sloping. Its top is the record's
    // base at both eaves (its `base` is the TOP at the eaves) and rises from each to the ridge.
    // The roof and every wall whose top is on it ask the same thing of it.
    const gableOf = (record: (typeof records)[number]) => {
      const body = innerJson<ExtrusionBody & { slopes?: (number | null)[] }>(record, 'extrusion');
      const level = levels.get(String(body?.level ?? record.params.level ?? ''));
      const slopes = body?.slopes;
      const edges = body?.profile?.outline?.curves ?? [];
      const sloped = Array.isArray(slopes) ? slopes.map((x) => typeof x === 'number') : [];
      const i = sloped.indexOf(true);
      if (record.params.of !== 'roof' || !level || edges.length !== 4 || sloped.filter(Boolean).length !== 2 || i < 0 || i > 1 || !sloped[i + 2]) return null;
      const [ei, ej] = [edges[i], edges[i + 2]];
      const A = ei.from!, B = ei.to!;
      const L = Math.hypot(B[0] - A[0], B[1] - A[1]);
      const u = [(B[0] - A[0]) / L, (B[1] - A[1]) / L];
      let n = [-u[1], u[0]];
      const toJ = (ej.from![0] - A[0]) * n[0] + (ej.from![1] - A[1]) * n[1];
      if (toJ < 0) n = [-n[0], -n[1]];
      const W = Math.abs(toJ);
      const [si, sj] = [slopes![i] as number, slopes![i + 2] as number];
      const top = level.at + (typeof record.params.base === 'number' ? record.params.base : 0);
      // Each eave as high as its own: `eaves[k]` raises edge k above the base (racbasic: one
      // 6.1 mm up, which left the roof and the six walls on it 6 mm off).
      const raised = (body as { eaves?: number[] } | null)?.eaves ?? [];
      const [ti, tj] = [top + (Number(raised[i]) || 0), top + (Number(raised[i + 2]) || 0)];
      const ridge = (tj - ti + sj * W) / (si + sj);
      /** The roof's top over a plan point: up from each eave, the lower of the two. */
      const zAt = (x: number, y: number) => {
        const d = (x - A[0]) * n[0] + (y - A[1]) * n[1];
        return Math.min(ti + si * d, tj + sj * (W - d));
      };
      return { A, u, n, L, W, si, sj, ridge, top, ti, tj, zAt };
    };
    const roofRecords = new Map(records.filter((r) => r.kind === 'extrusion' && r.params.of === 'roof').map((r) => [r.id, r]));
    const roofGids = [...roofRecords.values()].filter((r) => r.item.guid).map((r) => ({ id: r.id, gid: r.item.guid! }));

    // ---- 1. Levels: named identity, ensured on the target. ----
    // Counted as WRITTEN only when asked for: one this recipe made before is kept, not written
    // (the rules table shows read against written - Antonio, 17-10).
    let levelCount = 0;
    if (createLevels) {
      for (const [datumId, level] of levels) {
        const attrs = { CategoryId: CATEGORY.levels, Name: level.name, Elevation: num(level.at * s) };
        // 🔴 THE SAME LEVEL IS THE SAME LEVEL, whatever key the new version gives it: a level has no element of its own, it goes
        // by the thing it hangs on, and that thing changing asked to delete the level and everything on it (1-11, a shaft
        // drawn: 10 levels of a client's model «to remove», with their doors and ceilings).
        const print = printOf({ attrs: sharedFrame ? { ...attrs, Frame: 'shared', ...(sharedAt ? { SharedAt: sharedAt } : {}) } : attrs, placement: {} });
        const madeAs = [...prints].find(([one, was]) => was === print && made.has(one))?.[0];
        if (add(madeAs ?? key(datumId), attrs)) levelCount++;
      }
    }

    // ---- 2. Walls: one add per straight segment of each wall run. ----
    let wallCount = 0;
    let wallSkipped = 0;
    /** Each wall type's width, as the first wall of it said it (see «one type, one width» below). */
    const wallTypeWidths = new Map<string, number>();
    /** Each wall type's layers as its first wall's body stacked them, where the file declares none («…as its body stacks them»). */
    const pieceLayersOf = new Map<string, string>();
    /** Every slab's and roof's keys and box in the file's shape coordinates (for a wall's added strip, «…as the modelling tool can make
     * it»): its record's, made as a floor, and its shape's, made as a family from it — whichever this operation makes. */
    let slabBoxesMade: { keys: string[]; box: number[] }[] | null = null;
    const slabBoxes = () => (slabBoxesMade ??= !shapes ? [] : [...shapes.elements.values()].filter((el) => /^IFC(SLAB|ROOF)/i.test(el.ifcClass)).flatMap((el) => {
      const q = shapePoints(shapes, el.gid);
      if (!q.length) return [];
      const rec = records.find((r) => r.kind === 'extrusion' && r.item.guid === el.gid);
      return [{ keys: [...(rec ? [key(rec.id)] : []), `${picked.fileId}:${el.gid}:shape`], box: [0, 1, 2].map((k) => Math.min(...q.map((p) => p[k]))).concat([0, 1, 2].map((k) => Math.max(...q.map((p) => p[k])))) }];
    }));
    interface Seg {
      record: (typeof records)[number];
      i: number;
      from: [number, number];
      to: [number, number];
      width: number;
      joinStart: boolean;
      joinEnd: boolean;
      /** An arc's point half way round (its from/to are its chord's ends). */
      arcMid?: [number, number];
    }
    const segs: Seg[] = [];
    for (const record of records) {
      if (record.kind !== 'run' || record.params.of !== 'wall') continue;
      const body = innerJson<RunBody>(record, 'run');
      const curves = body?.run?.line?.curves ?? [];
      const lookRef = record.params.lookRef;
      const level = levels.get(String(body?.level ?? record.params.level ?? ''));
      if (typeof lookRef !== 'string' || typeof body?.height !== 'number' || !level) {
        wallSkipped++;
        continue;
      }
      const width = (thicknessOf(lookRef) ?? 0) / s;
      // 🔴 AN ARC (the converter since 24-10: {kind: 'arc', centre, radius, from, sweep}, radians, sweep signed): its
      // chord as its line, and the point half way round, for the applier to bend it through (LocationArc).
      type Arc = { kind: string; centre?: [number, number]; radius?: number; from?: number | [number, number]; sweep?: number; to?: [number, number] };
      const asSegment = (curve: Arc) => {
        if (curve.kind === 'segment' && Array.isArray(curve.from) && curve.to) return { from: [...curve.from] as [number, number], to: [...curve.to] as [number, number] };
        if (curve.kind === 'arc' && curve.centre && typeof curve.radius === 'number' && typeof curve.from === 'number' && typeof curve.sweep === 'number') {
          const at = (a: number) => [curve.centre![0] + curve.radius! * Math.cos(a), curve.centre![1] + curve.radius! * Math.sin(a)] as [number, number];
          if (typeof process !== "undefined" && process.env?.RECIPE_TRACE) console.error(`[wall-arc] ${record.item.guid}: radius ${curve.radius.toFixed(2)}, sweep ${(curve.sweep * 180 / Math.PI).toFixed(1)}°`);
          return { from: at(curve.from), to: at(curve.from + curve.sweep), arcMid: at(curve.from + curve.sweep / 2) };
        }
        return null;
      };
      const segments = (curves as Arc[]).map(asSegment).filter((x): x is NonNullable<ReturnType<typeof asSegment>> => x !== null);
      wallSkipped += curves.length - segments.length;
      segments.forEach((curve, i) =>
        segs.push({
          record, i, width,
          from: curve.from,
          to: curve.to,
          ...('arcMid' in curve ? { arcMid: curve.arcMid } : {}),
          // A run's own ends meet only at its first and last segment; inside, the run continues.
          joinStart: i === 0 && String(record.params.meetsAtStart) === 'true',
          joinEnd: i === segments.length - 1 && String(record.params.meetsAtEnd) === 'true',
        }),
      );
    }

    // WHERE A WALL MEETS ANOTHER IT ENDS ON THE OTHER'S LINE, as the modelling tool draws it: the records
    // carry each wall's line cut back to the faces it meets, and say which ends meet (`meetsAt`).
    // Such an end goes back to where its line crosses the line of the wall it meets, and the modelling tool,
    // allowed to join it there, cleans the corner as the original did.
    const cross = (a: Seg, b: Seg): [number, number] | null => {
      const d1 = [a.to[0] - a.from[0], a.to[1] - a.from[1]], d2 = [b.to[0] - b.from[0], b.to[1] - b.from[1]];
      const den = d1[0] * d2[1] - d1[1] * d2[0];
      if (Math.abs(den) < 1e-9 * Math.hypot(...d1) * Math.hypot(...d2) * 1e3) return null; // parallel
      const u = ((b.from[0] - a.from[0]) * d2[1] - (b.from[1] - a.from[1]) * d2[0]) / den;
      return [a.from[0] + u * d1[0], a.from[1] + u * d1[1]];
    };
    const distToSeg = (p: [number, number], q: Seg) => {
      const dx = q.to[0] - q.from[0], dy = q.to[1] - q.from[1];
      const L2 = dx * dx + dy * dy || 1;
      const u = Math.max(0, Math.min(1, ((p[0] - q.from[0]) * dx + (p[1] - q.from[1]) * dy) / L2));
      return Math.hypot(p[0] - (q.from[0] + u * dx), p[1] - (q.from[1] + u * dy));
    };
    // (Each wall's span in height read once: asked of every pair, Snowdon Architectural's 1079 walls parsed their records 4.6 M
    // times, 83 of the reading's 290 s — 13-11.)
    const heightSpan = new Map<Seg['record'], [number, number]>();
    const spanOf = (r: Seg['record']): [number, number] => {
      let known = heightSpan.get(r);
      if (!known) {
        const l = innerJson<RunBody>(r, 'run');
        const e = levels.get(String(l?.level ?? r.params.level))!.at;
        known = [e + l!.base!, e + l!.base! + l!.height!];
        heightSpan.set(r, known);
      }
      return known;
    };
    const sameLevel = (a: Seg, b: Seg) => {
      const [a0, a1] = spanOf(a.record), [b0, b1] = spanOf(b.record);
      return Math.min(a1, b1) > Math.max(a0, b0); // they overlap in height
    };
    // How far a cut-back end may be from the wall it meets, and travel to reach its line: a
    // metre. A thick wall met at an angle, or one that runs through, leaves the cut further back
    // than a thickness (racbasic's retaining walls: 0.56 m).
    const REACH = 1.0;
    const extended = new Map<Seg, { from: [number, number]; to: [number, number] }>();
    /** Half the thickness of the wall each end was carried to (see the outline's ends below). */
    const metHalf = new Map<Seg, { from?: number; to?: number }>();
    for (const a of segs) {
      const ends: ['from' | 'to', boolean][] = [['from', a.joinStart], ['to', a.joinEnd]];
      const out = { from: a.from, to: a.to };
      for (const [end, joins] of ends) {
        if (!joins) continue;
        const p = a[end];
        let best: Seg | null = null, bd = Infinity;
        for (const b of segs) {
          if (b === a || b.arcMid || !sameLevel(a, b)) continue; // (not to an arc's chord)
          const d = distToSeg(p, b);
          if (d < bd) { bd = d; best = b; }
        }
        // The neighbour it meets is within a wall's thickness of the cut-back end.
        if (!best || bd > REACH) continue;
        const x = cross(a, best);
        if (!x) continue;
        // Only a move ALONG the wall, and only as far as the walls' thickness, in or out: never
        // a different wall (racbasic's 1.2 m partition 506386, 0.12 thick: a crossing 0.6 m in
        // and one 0.59 m past its end, both from walls it does not meet; its retaining walls,
        // 0.3 thick, do need theirs, up to 0.56 m, and some inward - measured both ways).
        const reach = Math.min(REACH, 2 * Math.max(a.width, best.width) + 0.02);
        if (Math.hypot(x[0] - p[0], x[1] - p[1]) > reach) continue;
        // And the crossing is ON the wall it meets (within its thickness), not on its line far beyond.
        if (distToSeg(x, best) > best.width + 0.01) continue;
        out[end] = x;
        metHalf.set(a, { ...metHalf.get(a), [end]: best.width / 2 });
      }
      extended.set(a, out);
    }

    // 🔴 A WALL ANOTHER CUTS WHERE THEY OVERLAP (Duplex 24-10: four party walls, 550 mm by their type, a 152 mm furring
    // wall laid 57 mm into them; the file's shape of each is cut there, ours were whole, 12 % over): two parallel walls
    // whose thicknesses overlap, the one whose shape is thinner than its type there cut by the other (Join Geometry).
    const cutBy = new Map<Seg, Seg[]>();
    if (shapes) {
      const across = (sg: Seg) => {
        const L = Math.hypot(sg.to[0] - sg.from[0], sg.to[1] - sg.from[1]);
        return { L, d: [(sg.to[0] - sg.from[0]) / L, (sg.to[1] - sg.from[1]) / L] };
      };
      const thickAt = (sg: Seg, lo: number, hi: number) => {
        const g = sg.record.item.guid;
        if (!g || segs.filter((o) => o.record === sg.record).length !== 1) return null;
        const { d } = across(sg);
        // (Its section half way along the overlap, half way up its shape: a notch's corners say its whole thickness.)
        const zs = shapePoints(shapes, g).map((p) => p[2]);
        if (!zs.length) return null;
        const x = extentAcross(shapes, g, sg.from, d, (lo + hi) / 2, (Math.min(...zs) + Math.max(...zs)) / 2);
        return x ? x.hi - x.lo : null;
      };
      for (const a of segs) {
        if (a.arcMid || !(a.width > 0)) continue;
        const A = across(a);
        if (A.L < 0.3) continue;
        for (const b of segs) {
          if (b === a || b.arcMid || !(b.width > 0) || !sameLevel(a, b)) continue;
          const B = across(b);
          if (B.L < 0.3 || Math.abs(A.d[0] * B.d[1] - A.d[1] * B.d[0]) > 0.02) continue;
          const off = Math.abs(-(b.from[0] - a.from[0]) * A.d[1] + (b.from[1] - a.from[1]) * A.d[0]);
          if (off > (a.width + b.width) / 2 - 0.01) continue;
          const tb = [b.from, b.to].map((p) => (p[0] - a.from[0]) * A.d[0] + (p[1] - a.from[1]) * A.d[1]);
          const lo = Math.max(0, Math.min(...tb)), hi = Math.min(A.L, Math.max(...tb));
          if (hi - lo < 0.3) continue;
          const ta = thickAt(a, lo, hi);
          if (typeof process !== "undefined" && process.env?.RECIPE_WALL?.split(",").includes(a.record.item.guid ?? "")) console.error(`[cut-by?] ${a.record.item.guid} by ${b.record.item.guid}: off ${off.toFixed(3)}, along ${lo.toFixed(2)}..${hi.toFixed(2)}, shape ${ta}`);
          if (ta === null || ta > a.width - 0.01) continue;
          if (typeof process !== 'undefined' && process.env?.RECIPE_TRACE) console.error(`[cut-by] ${a.record.item.guid} (${(a.width * 1000).toFixed(0)} mm, its shape ${(ta * 1000).toFixed(0)}) cut by ${b.record.item.guid} over ${(hi - lo).toFixed(2)} m`);
          cutBy.set(a, [...(cutBy.get(a) ?? []), b]);
        }
      }
    }

    // 🔴 THE SHAPES AT THE RECORDS' HEIGHT. The records are read at the project's height (`atTheProjectsHeight`), the
    // shapes where the file has them: DACH stands 500 m up, and every family, opening and room came in 500 m above its
    // building (21-10). The offset is measured on the walls (their shape's bottom against their record's), and only
    // a large one (a site's elevation, not a wall standing below its base) is taken off.
    /**
     * 🔴 A CURTAIN WALL'S GLASS AS THICK AS ITS FILE DRAWS IT (the Conference Center's 160 «Glazed Centered» panels
     * 37 % thicker than their glass, 24-10): the median, across the wall (`d` its direction), of its plain panels'
     * thickness, feet; null when it has none.
     */
    const glassOf = (curtainGid: string | undefined, d: number[]): number | null => {
      if (!shapes || !curtainGid) return null;
      const nrm = [-d[1], d[0]];
      const each: number[] = [];
      for (const el of shapes.elements.values()) {
        if (el.parent !== curtainGid || !/^IFCPLATE$/i.test(el.ifcClass) || el.pieces.length !== 1) continue;
        const g = shapes.geometries.get(el.pieces[0].geometry);
        if (!g || g.tris.length / 3 > 12) continue;
        const pts = shapePoints(shapes, el.gid);
        if (pts.length < 4) continue;
        const across = pts.map((p) => p[0] * nrm[0] + p[1] * nrm[1]);
        const t = Math.max(...across) - Math.min(...across);
        if (t > 0.002 && t < 0.2) each.push(t);
      }
      if (!each.length) return null;
      each.sort((a, b) => a - b);
      if (typeof process !== 'undefined' && process.env?.RECIPE_TRACE) console.error(`[glass] ${curtainGid}: ${each.length} panel(s), median ${(each[Math.floor(each.length / 2)] * 1000).toFixed(1)} mm`);
      return each[Math.floor(each.length / 2)] * s;
    };
    // 🔴 ITS MULLIONS AS THE FILE HAS THEM, when its type says none (Conference Center 24-10: every curtain wall's
    // upright width read 0, so the modelling tool drew no mullion, and 397 of its 1245 members had nothing to be): the median bar
    // of its own members, its face (the narrower of along and up) and its depth (across the wall).
    const mullionOf = (curtainGid: string | undefined, d: number[]): { width: number; depth: number } | null => {
      if (!shapes || !curtainGid) return null;
      const nrm = [-d[1], d[0]];
      const faces: number[] = [], depths: number[] = [];
      for (const el of shapes.elements.values()) {
        if (el.parent !== curtainGid || !/^IFCMEMBER$/i.test(el.ifcClass)) continue;
        const pts = shapePoints(shapes, el.gid);
        if (pts.length < 4) continue;
        const along = pts.map((p) => p[0] * d[0] + p[1] * d[1]), across = pts.map((p) => p[0] * nrm[0] + p[1] * nrm[1]), up = pts.map((p) => p[2]);
        const span = (v: number[]) => Math.max(...v) - Math.min(...v);
        const face = Math.min(span(along), span(up)), depth = span(across);
        if (face > 0.005 && face < 0.5 && depth > 0.005 && depth < 1) { faces.push(face); depths.push(depth); }
      }
      if (!faces.length) return null;
      faces.sort((a, b) => a - b); depths.sort((a, b) => a - b);
      const m = { width: faces[Math.floor(faces.length / 2)], depth: depths[Math.floor(depths.length / 2)] };
      if (typeof process !== 'undefined' && process.env?.RECIPE_TRACE) console.error(`[mullion] ${curtainGid}: ${faces.length} member(s), median ${(m.width * 1000).toFixed(1)} × ${(m.depth * 1000).toFixed(1)} mm`);
      return { width: m.width * s, depth: m.depth * s };
    };
    /**
     * 🔴 THE GLAZING OF A ROOF MADE OF GLASS (rac_advanced's «Sloped Glazing»: an IfcRoof of IfcPlate and IfcMember): each bar's
     * axis, its section and the glass's thickness, read off the file's own pieces. Each axis in feet, x and y as the record's (the
     * shapes' plan is the records'), z from the lowest of its pieces, which the applier puts at the roof's own bottom. Null when
     * the roof has no glass.
     */
    const glazingOf = (roofGid: string): { bars: number[][]; panels: number; mullion: { width: number; depth: number; offset?: number }; panel: { thickness: number } } | null => {
      if (!shapes) return null;
      const kids = [...shapes.elements.values()].filter((el) => el.parent === roofGid && /^IFC(PLATE|MEMBER)$/i.test(el.ifcClass));
      const plates = kids.filter((el) => /^IFCPLATE$/i.test(el.ifcClass)), members = kids.filter((el) => /^IFCMEMBER$/i.test(el.ifcClass));
      if (!plates.length) return null;
      const all = kids.flatMap((el) => shapePoints(shapes, el.gid));
      if (!all.length) return null;
      const z0 = Math.min(...all.map((p) => p[2]));
      const median = (v: number[]) => [...v].sort((a, b) => a - b)[Math.floor(v.length / 2)] ?? 0;
      /** A piece's long axis and its section's two sides: across it level, and square to that. */
      const axisOf = (pts: number[][]) => {
        // (Its axis the points' main direction: corner to corner, a bar mitred at its ends lay askew and its section came twice as wide.)
        const c = [0, 1, 2].map((k) => pts.reduce((t, p) => t + p[k], 0) / pts.length);
        const cov = [0, 1, 2].map((i) => [0, 1, 2].map((j) => pts.reduce((t, p) => t + (p[i] - c[i]) * (p[j] - c[j]), 0)));
        let dir = [1, 1, 1];
        for (let it = 0; it < 50; it++) { const nx = [0, 1, 2].map((i) => cov[i][0] * dir[0] + cov[i][1] * dir[1] + cov[i][2] * dir[2]); const l = Math.hypot(nx[0], nx[1], nx[2]) || 1; dir = nx.map((x) => x / l); }
        let u = [dir[1], -dir[0], 0]; const lu = Math.hypot(u[0], u[1]); u = lu > 1e-6 ? u.map((x) => x / lu) : [1, 0, 0];
        const v = [dir[1] * u[2] - dir[2] * u[1], dir[2] * u[0] - dir[0] * u[2], dir[0] * u[1] - dir[1] * u[0]];
        const along = (q: number[]) => pts.map((p) => (p[0] - c[0]) * q[0] + (p[1] - c[1]) * q[1] + (p[2] - c[2]) * q[2]);
        const span = (q: number[]) => { const x = along(q); return Math.max(...x) - Math.min(...x); };
        const half = span(dir) / 2;
        // 🔴 ITS SECTION BY THE SMALLEST RECTANGLE ROUND IT, square to the bar, at any turn (rac_advanced 12-11: read along level and
        // square axes, a 30 mm square bar on a 15° slope came as 58 x 72).
        const flat = pts.map((p) => [(p[0] - c[0]) * u[0] + (p[1] - c[1]) * u[1] + (p[2] - c[2]) * u[2], (p[0] - c[0]) * v[0] + (p[1] - c[1]) * v[1] + (p[2] - c[2]) * v[2]]);
        let sides = [span(u), span(v)];
        for (let i = 0; i < flat.length; i++) for (let j = i + 1; j < flat.length; j++) {
          const ex = flat[j][0] - flat[i][0], ey = flat[j][1] - flat[i][1], l = Math.hypot(ex, ey);
          if (l < 1e-6) continue;
          const [cx, cy] = [ex / l, ey / l];
          const xs = flat.map((q) => q[0] * cx + q[1] * cy), ys = flat.map((q) => -q[0] * cy + q[1] * cx);
          const w = Math.max(...xs) - Math.min(...xs), h = Math.max(...ys) - Math.min(...ys);
          if (w * h < sides[0] * sides[1] - 1e-12) sides = [w, h];
        }
        return { from: c.map((x, k) => x - dir[k] * half), to: c.map((x, k) => x + dir[k] * half), sides: sides.sort((p, q) => p - q) };
      };
      const bars: number[][] = [], widths: number[] = [], depths: number[] = [];
      for (const el of members) {
        const pts = shapePoints(shapes, el.gid);
        if (pts.length < 4) continue;
        const ax = axisOf(pts);
        bars.push([ax.from[0] * s, ax.from[1] * s, (ax.from[2] - z0) * s, ax.to[0] * s, ax.to[1] * s, (ax.to[2] - z0) * s]);
        widths.push(ax.sides[0]); depths.push(ax.sides[1]);
      }
      const glass = plates.map((el) => shapePoints(shapes, el.gid)).filter((pts) => pts.length >= 4).map((pts) => axisOf(pts).sides[0]);
      /**
       * 🔴 ITS BARS ON ITS GLASS, AS THE FILE LAYS THEM (rac_advanced 13-11: the file's 30 mm bars sit on the glass, the modelling tool's were
       * centred in it, every bar 3 cm under the file's and each pane 4 cm off): how far each bar's axis is from the middle of the
       * pane under it, along the pane's upper side; the median, for the bar type's offset.
       */
      const planeOf = (pts: number[][]) => {
        const c = [0, 1, 2].map((k) => pts.reduce((t, p) => t + p[k], 0) / pts.length);
        const cov = [0, 1, 2].map((i) => [0, 1, 2].map((j) => pts.reduce((t, p) => t + (p[i] - c[i]) * (p[j] - c[j]), 0)));
        const power = (m: number[][], seed: number[]) => { let v = seed; for (let it = 0; it < 60; it++) { const nx = [0, 1, 2].map((i) => m[i][0] * v[0] + m[i][1] * v[1] + m[i][2] * v[2]); const l = Math.hypot(nx[0], nx[1], nx[2]) || 1; v = nx.map((x) => x / l); } return v; };
        const e1 = power(cov, [1, 0.7, 0.3]);
        const l1 = [0, 1, 2].reduce((t, i) => t + e1[i] * [0, 1, 2].reduce((u, j) => u + cov[i][j] * e1[j], 0), 0);
        const e2 = power(cov.map((row, i) => row.map((x, j) => x - l1 * e1[i] * e1[j])), [0.3, 1, 0.7]);
        let n = [e1[1] * e2[2] - e1[2] * e2[1], e1[2] * e2[0] - e1[0] * e2[2], e1[0] * e2[1] - e1[1] * e2[0]];
        const ln = Math.hypot(n[0], n[1], n[2]) || 1; n = n.map((x) => x / ln);
        if (n[2] < 0) n = n.map((x) => -x);
        return { c, n };
      };
      const panes = plates.map((el) => shapePoints(shapes, el.gid)).filter((pts) => pts.length >= 4).map(planeOf);
      const offsets: number[] = [];
      for (const el of members) {
        const pts = shapePoints(shapes, el.gid);
        if (pts.length < 4 || !panes.length) continue;
        const m = [0, 1, 2].map((k) => pts.reduce((t, p) => t + p[k], 0) / pts.length);
        // (The pane nearest it in its own plane: a bar on a hip lies between two, either says the same.)
        let best: { d: number; along: number } | null = null;
        for (const p of panes) {
          const r = [m[0] - p.c[0], m[1] - p.c[1], m[2] - p.c[2]];
          const d = r[0] * p.n[0] + r[1] * p.n[1] + r[2] * p.n[2];
          const along = Math.hypot(r[0] - d * p.n[0], r[1] - d * p.n[1], r[2] - d * p.n[2]);
          if (Math.abs(d) < 0.25 && (!best || along < best.along)) best = { d, along };
        }
        if (best) offsets.push(best.d);
      }
      const offset = offsets.length ? median(offsets) : 0;
      if (typeof process !== 'undefined' && process.env?.RECIPE_TRACE) console.error(`[glazing] ${roofGid}: bars ${(offset * 1000).toFixed(1)} mm off the glass's middle (${offsets.length} of ${members.length})`);
      return { bars, panels: plates.length, mullion: { width: median(widths) * s, depth: median(depths) * s, ...(Math.abs(offset) > 0.0005 ? { offset: offset * s } : {}) }, panel: { thickness: (median(glass) || 0.01) * s } };
    };
    const shapeDz = (() => {
      if (!shapes) return 0;
      const d: number[] = [];
      for (const sg of segs) {
        const g = sg.record.item.guid;
        if (!g || !shapes.elements.has(g)) continue;
        const body = innerJson<RunBody>(sg.record, 'run');
        const level = levels.get(String(body?.level ?? sg.record.params.level ?? ''));
        if (!body || !level) continue;
        const pts = shapePoints(shapes, g);
        if (!pts.length) continue;
        let low = Infinity;
        for (const p of pts) low = Math.min(low, p[2]);
        d.push(low - (level.at + (typeof body.base === 'number' ? body.base : 0)));
      }
      d.sort((a, b) => a - b);
      const m = d.length ? d[Math.floor(d.length / 2)] : 0;
      return Math.abs(m) > 0.5 ? m : 0;
    })();
    for (const sg of segs) {
      const { record } = sg;
      /** Its other pieces' profiles, when the file cut it through (see `wallTopOf`). */
      let pieceProfiles: string[] = [];
      const body = innerJson<RunBody>(record, 'run')!;
      if (typeof process !== 'undefined' && process.env?.RECIPE_WALL?.split(",").includes(record.item.guid ?? "")) console.error(`[wall] ${record.item.guid}: params ${JSON.stringify(record.params).slice(0, 800)} seg ${JSON.stringify({ from: sg.from, to: sg.to, i: sg.i })}`);
      const base = typeof body.base === 'number' ? body.base : 0;
      const height = body.height!;
      const level = levels.get(String(body.level ?? record.params.level ?? ''))!;
      const lookRef = record.params.lookRef as string;
      // (An arc keeps the ends the converter gave it, unjoined: the extension to a meeting is along its chord, and
      // the modelling tool, joining it, trimmed its ends and moved its neighbours — Savoyvilla's 13 arcs, twins as families, off.)
      let { from: f, to: e } = sg.arcMid ? { from: sg.from, to: sg.to } : extended.get(sg)!;
      // (A stub its joins trimmed to nothing — Savoyvilla 24-10: two 12 cm walls, both ends cut back by half their
      // 12 cm, «LocationLine is missing or not two points» — keeps its own line.)
      if (Math.hypot(e[0] - f[0], e[1] - f[1]) < 0.01) ({ from: f, to: e } = sg);
      // 🔴 A SQUARE END BACK TO ITS CUT: where the record wants it square and says the plane it is cut by (`asCut`), and
      // the meeting carried the line past that plane, the line ends at the plane, unjoined. (Not on OUT to it: GNI model_51
      // r54, 80 walls carried up to 10 cm on and joined there, 95.0 → 88.1, its corners no better.)
      const cutBack = new Set<string>();
      if (!sg.arcMid && segs.filter((o) => o.record === record).length === 1) {
        const cuts = (body as { asCut?: { start?: { through?: number[]; keep?: number[] }[]; end?: { through?: number[]; keep?: number[] }[] } }).asCut;
        const L = Math.hypot(e[0] - f[0], e[1] - f[1]);
        if (cuts && L > 0.05) {
          const d = [(e[0] - f[0]) / L, (e[1] - f[1]) / L];
          const onTo = (p: number[], plane?: { through?: number[]; keep?: number[] }) => {
            const t = plane?.through, k = plane?.keep;
            if (!t || !k) return null;
            const dn = d[0] * k[0] + d[1] * k[1];
            if (Math.abs(dn) < 0.5) return null; // (a slanted cut is a mitre's: the modelling tool's join makes it)
            return ((t[0] - p[0]) * k[0] + (t[1] - p[1]) * k[1]) / dn;
          };
          const ts = record.params.wantedAtStart === 'square' ? onTo(f, cuts.start?.[0]) : null;
          const te = record.params.wantedAtEnd === 'square' ? onTo(e, cuts.end?.[0]) : null;
          // (And back to it, square and unjoined, where its meeting carried it past: GNI model_182 r54, an «Exterior
          // Wall» of layers run 7 cm into its neighbour and joined there, a twin before as an exact square end.)
          if (ts !== null && ts > 0.005 && ts < Math.min(1, L / 2)) { f = [f[0] + d[0] * ts, f[1] + d[1] * ts]; cutBack.add('start'); }
          if (te !== null && te < -0.005 && te > -Math.min(1, L / 2)) { e = [e[0] + d[0] * te, e[1] + d[1] * te]; cutBack.add('end'); }
          // (TRIAL, off unless RECIPE_CUT_OUT: on OUT to it as well, unjoined — the exact square end of the shape test
          // below, from the record's plane where the shape's mesh is no help: GNI model_176's face-set walls butted.)
          if (typeof process !== 'undefined' && process.env?.RECIPE_CUT_OUT) {
            if (ts !== null && ts < -0.005 && ts > -1) { f = [f[0] + d[0] * ts, f[1] + d[1] * ts]; cutBack.add('start'); }
            if (te !== null && te > 0.005 && te < 1) { e = [e[0] + d[0] * te, e[1] + d[1] * te]; cutBack.add('end'); }
          }
          if (typeof process !== "undefined" && process.env?.RECIPE_TRACE && ((ts !== null && Math.abs(ts) > 0.005 && Math.abs(ts) < 1) || (te !== null && Math.abs(te) > 0.005 && Math.abs(te) < 1))) console.error(`[wall-to-cut] ${record.item.guid} ${lookRef}: start ${ts?.toFixed(3)} end ${te?.toFixed(3)}`);
          if (typeof process !== 'undefined' && process.env?.RECIPE_WALL?.split(",").includes(record.item.guid ?? "")) console.error(`[wall-cut] ${record.item.guid}: start ${ts?.toFixed(3)} end ${te?.toFixed(3)}`);
        }
      }
      // 🔴 A SQUARE END WHERE THE FILE'S SHAPE ENDS, UNJOINED. Which wall runs through a corner is the modelling tool's join order,
      // which the API cannot set (13-10): racbasic's corner walls came out the other way round, 0.2 m long and short.
      // The file's own shape says where each end is; a square end goes exactly there and is left unjoined, so the
      // corner is the file's whatever the modelling tool would choose. A slanted end (a mitre) keeps the modelling tool's join.
      const exact = new Set<string>(cutBack);
      // (Not for an arc: what is read off its shape below assumes a straight wall.)
      const shapeOfWall = !sg.arcMid && shapes && record.item.guid && segs.filter((o) => o.record === record).length === 1 ? shapes.elements.get(record.item.guid) : undefined;
      if (shapeOfWall) {
        const pts = shapePoints(shapes!, record.item.guid!);
        const L = Math.hypot(e[0] - f[0], e[1] - f[1]);
        if (pts.length >= 4 && L > 0.05) {
          const d = [(e[0] - f[0]) / L, (e[1] - f[1]) / L];
          const along = pts.map((p) => (p[0] - f[0]) * d[0] + (p[1] - f[1]) * d[1]);
          const lo = Math.min(...along), hi = Math.max(...along);
          // Square: the shape's points at that end span its whole thickness. A mitre reaches its end at one edge only
          // (r20: a 3 cm window called racbasic's mitres square and ten walls ran past them).
          const across = pts.map((p) => -(p[0] - f[0]) * d[1] + (p[1] - f[1]) * d[0]);
          const thick = Math.max(...across) - Math.min(...across);
          const square = (at: number) => {
            const end = across.filter((_, k) => Math.abs(along[k] - at) < 0.002);
            return end.length >= 2 && Math.max(...end) - Math.min(...end) > (typeof process !== 'undefined' && process.env?.RECIPE_END_STEP ? 0.25 : 0.9) * thick;
          };
          const f0 = f;
          if (square(lo)) { f = [f0[0] + d[0] * lo, f0[1] + d[1] * lo]; exact.add('start'); }
          if (square(hi)) { e = [f0[0] + d[0] * hi, f0[1] + d[1] * hi]; exact.add('end'); }
        }
      }
      // A run's `base` is RELATIVE to its level (run:0 of racbasic: Level 2 at 3.0 m,
      // base -0.3, built 2.7..9.2), so it is the modelling tool's base offset as it stands.
      const z = (level.at + base) * s;
      const line = `${num(f[0] * s)},${num(f[1] * s)},${num(z)};` + `${num(e[0] * s)},${num(e[1] * s)},${num(z)}`;
      const attrs: Record<string, string> = {
        CategoryId: CATEGORY.walls,
        Type: nativeOf(record)?.type ?? lookRef,
        LocationLine: line,
        Level: level.name,
        BaseOffset: num(base * s),
        Height: num(height * s),
        // (An arc: bent through its middle by the applier, its ends where the line's are.)
        ...(sg.arcMid ? { LocationArc: `${num(sg.arcMid[0] * s)},${num(sg.arcMid[1] * s)},${num(z)}` } : {}),
      };
      // (Cut by: each cutter's source key, and the id of the one made before — a checkpoint's kept wall.)
      const cutters = cutBy.get(sg);
      if (cutters) attrs.CutBy = cutters.flatMap((b) => { const k = `${key(b.record.id)}#${b.i}`; const before = made.get(k); return before ? [k, before] : [k]; }).join('|');
      // Which ends the modelling tool may join: only those that meet another wall where it was authored.
      // Every end the record says meets another wall may join it, moved or not: the modelling tool's cleanup
      // there is part of the wall (racbasic's foundation wall reaches 0.101 m past its line).
      const joins = sg.arcMid ? [] : [f !== sg.from || sg.joinStart ? 'start' : '', e !== sg.to || sg.joinEnd ? 'end' : ''].filter((end) => Boolean(end) && !exact.has(end));
      if (joins.length) attrs.JoinEnds = joins.join(',');
      // How each joined end meets: a mitre where the record wants one (the modelling tool's Wall Joins).
      const mitres = joins.filter((end) => record.params[end === 'start' ? 'wantedAtStart' : 'wantedAtEnd'] === 'mitre');
      if (mitres.length) attrs.Mitre = mitres.join(',');
      // (Which wall goes on through a corner is NOT said here: reordering the modelling tool's
      // ElementsAtJoin by the record's cut-back ends left 628523 as it was and broke two
      // more, measured 13-10. the modelling tool's join order still waits for a way to set it.)
      // Its top tied to a level, as it was authored: the height then follows the level.
      const top = levels.get(String(record.params.topLevel ?? ''));
      if (top) {
        attrs.TopLevel = top.name;
        attrs.TopOffset = num((level.at + base + height - top.at) * s);
      }
      // AN ELEVATION THAT IS NOT A RECTANGLE (the modelling tool's Edit Profile, or a top cut by a roof the
      // converter already folded in): the outline, [along, up] from the line's start and the
      // base, laid in the wall's vertical plane. Its first and last stations go where the ends
      // went, so an end extended to a meeting carries the outline with it.
      const given = (body as { profile?: [number, number][] }).profile;
      let profile = Array.isArray(given) ? withoutSlivers(given) : given;
      // 🔴 (A rectangle over its whole line and height says nothing a plain wall does not — and a wall by its outline is
      // one the modelling tool will not mitre nor join: Schependomlaan 24-10, 40 «HSB-element» walls squared at their mitred ends.)
      // (Only where it wants a mitre: elsewhere its outline keeps its ends where the file has them, and as a plain wall
      // the modelling tool trimmed Conference's partitions a thickness short at their joins, 12 walls off, r35.)
      const mitred = record.params.wantedAtStart === 'mitre' || record.params.wantedAtEnd === 'mitre';
      if (mitred && Array.isArray(profile) && profile.length === 4) {
        const L0 = Math.hypot(sg.to[0] - sg.from[0], sg.to[1] - sg.from[1]), h0 = body.height!;
        const at = (v: number, end: number) => (Math.abs(v) < 1e-4 ? 'lo' : Math.abs(v - end) < 1e-3 ? 'hi' : null);
        const corners = profile.map(([a, z]) => [at(a, L0), at(z, h0)]);
        if (corners.every(([a, z]) => a && z) && new Set(corners.map(([a, z]) => `${a}${z}`)).size === 4) profile = undefined;
      }
      // 🔴 A NOTCH ITS DOOR FILLS, ON A WALL WHOSE LAYERS GO ON ABOVE OR BELOW IT (GNI model_176 30-10: «SW» walls whose
      // outline is their box less the notch of the door in them, their 5 cm finish going on 20 cm above; the modelling tool keeps a
      // wall by its outline from extending a layer, «TopExtension read-only», 47 walls «off»): a plain wall, each door
      // and window cutting its own. (And one whose outline is only its box, there for its ends: the modelling tool's join cleans those.)
      if (typeof process !== 'undefined' && process.env?.RECIPE_LAYER_EXT && Array.isArray(profile) && profile.length >= 4 && shapes && record.item.guid && typeof body.height === 'number') {
        const def = (() => { try { return JSON.parse(String(styles.get(lookRef)?.params?.definition ?? 'null')); } catch { return null; } })() as { layers?: { topExtension?: number; baseExtension?: number }[] } | null;
        if ((def?.layers ?? []).some((l) => (l.topExtension ?? 0) > 0.001 || (l.baseExtension ?? 0) > 0.001)) {
          const L0 = Math.hypot(sg.to[0] - sg.from[0], sg.to[1] - sg.from[1]), h0 = body.height, d0 = [(sg.to[0] - sg.from[0]) / L0, (sg.to[1] - sg.from[1]) / L0];
          const z0 = level.at + base + shapeDz;
          const boxes = [...shapes.elements.values()].filter((o) => o.host === record.item.guid && !/^IFCOPENINGELEMENT$/i.test(o.ifcClass)).map((o) => {
            const q = shapePoints(shapes, o.gid).map((p) => [(p[0] - sg.from[0]) * d0[0] + (p[1] - sg.from[1]) * d0[1], p[2] - z0]);
            return q.length ? [Math.min(...q.map((x) => x[0])), Math.max(...q.map((x) => x[0])), Math.min(...q.map((x) => x[1])), Math.max(...q.map((x) => x[1]))] : null;
          }).filter((b): b is number[] => b !== null);
          // (Its corners where its outline's ends are: one that stops at the face of the wall it meets, not its line.)
          const a0 = Math.min(...profile.map(([a]) => a)), a1 = Math.max(...profile.map(([a]) => a));
          const corner = ([a, z]: [number, number]) => (Math.abs(a - a0) < 0.005 || Math.abs(a - a1) < 0.005) && (Math.abs(z) < 0.005 || Math.abs(z - h0) < 0.005);
          const filled = ([a, z]: [number, number]) => boxes.some((b) => a >= b[0] - 0.03 && a <= b[1] + 0.03 && z >= b[2] - 0.15 && z <= b[3] + 0.03);
          const notches = profile.filter((p) => !corner(p));
          if (profile.filter(corner).length === 4 && (notches.length === 0 || (boxes.length && notches.every(filled)))) {
            if (typeof process !== 'undefined' && process.env?.RECIPE_TRACE) console.error(`[layer-extension] ${record.item.guid} ${lookRef}: its outline's ${notches.length} notch corner(s) filled by what it hosts → a plain wall`);
            profile = undefined;
          }
        }
      }
      if (!sg.arcMid && Array.isArray(profile) && profile.length >= 3 && sg.i === 0 && !segs.some((o) => o !== sg && o.record === record)) {
        const L = Math.hypot(sg.to[0] - sg.from[0], sg.to[1] - sg.from[1]);
        const dir = [(sg.to[0] - sg.from[0]) / L, (sg.to[1] - sg.from[1]) / L];
        const flat: number[] = [];
        // Where the ends went, along the line: an end vertex keeps following its edge that is
        // not upright (a sloped top goes on sloping), or the modelling tool, trimming back to the joint,
        // leaves the slope's end off (racbasic's CL_W1 493612: 3 cm at each end).
        let ext0 = -((f[0] - sg.from[0]) * dir[0] + (f[1] - sg.from[1]) * dir[1]);
        let ext1 = (e[0] - sg.to[0]) * dir[0] + (e[1] - sg.to[1]) * dir[1];
        const baseExt0 = ext0, baseExt1 = ext1;
        // (Measured r56: model_150 96.7 → 99.7. A wall by its outline the modelling tool does not carry on at a join — GNI model_150
        // r55, 25 «Wall 11.5» partitions with a door notch, each corner left open between the axis it stopped at and the
        // face of the wall it meets — so a joined end's outline goes on to that wall's far face; the modelling tool trims the other.)
        {
          const half = metHalf.get(sg);
          const faced: string[] = [];
          // (No further than its own shape goes: GNI model_125 r56, a 33 cm stub carried 15 cm past where the file's
          // ends, into the wall it meets.)
          const own = shapes && record.item.guid ? shapePoints(shapes, record.item.guid).map((q) => (q[0] - sg.from[0]) * dir[0] + (q[1] - sg.from[1]) * dir[1]) : [];
          const reach0 = own.length ? Math.max(0, -Math.min(...own)) - ext0 : Infinity, reach1 = own.length ? Math.max(0, Math.max(...own) - L) - ext1 : Infinity;
          // (And where the wall it meets went unmeasured, as far as its own shape goes, under 60 cm: GNI model_167 r58, «STB 20.0
          // WD 12.0» L corners, one end faced and the other left 13 cm short of the corner, a square of insulation nobody's;
          // measured r63/r65: 167 95.2 → 96.6, Duplex, Savoyvilla, racbasic, 150, 51 unchanged.)
          const h0 = half?.from ?? (reach0 < 0.6 ? reach0 : 0), h1 = half?.to ?? (reach1 < 0.6 ? reach1 : 0);
          if (h0 && joins.includes('start') && reach0 > 0.005) { ext0 += Math.min(h0, reach0); faced.push('start'); }
          if (h1 && joins.includes('end') && reach1 > 0.005) { ext1 += Math.min(h1, reach1); faced.push('end'); }
          // (That end then unjoined: the other wall's end, joined, meets it along its side, a T.)
          const left = joins.filter((j) => !faced.includes(j));
          if (faced.length) { if (left.length) attrs.JoinEnds = left.join(','); else delete attrs.JoinEnds; }
          if (faced.length && attrs.Mitre) { const m = attrs.Mitre.split(',').filter((j) => left.includes(j)); if (m.length) attrs.Mitre = m.join(','); else delete attrs.Mitre; }
          if (faced.length && typeof process !== 'undefined' && process.env?.RECIPE_TRACE) console.error(`[profile-face] ${record.item.guid} ${lookRef}: ${faced.join(',')} to the far face`);
        }
        const outlineAt = (e0: number, e1: number) => profile.map(([a, up], k) => {
          const atStart = Math.abs(a) < 1e-6, atEnd = Math.abs(a - L) < 1e-6;
          let along = a, height = up;
          if (atStart || atEnd) {
            along = atStart ? -e0 : L + e1;
            const sloped = [profile[(k - 1 + profile.length) % profile.length], profile[(k + 1) % profile.length]]
              .find(([b]) => Math.abs(b - a) > 1e-6);
            if (sloped) height = up + ((sloped[1] - up) / (sloped[0] - a)) * (along - a);
          }
          return [along, height] as [number, number];
        });
        // 🔴 NEVER AN OUTLINE THAT CROSSES ITSELF (GNI model_119 r56/r57a: the modelling tool itself died in Wall.Create, an access
        // violation, twice): an end moved past a station inside it — a door's notch near the end — folds it. Then the
        // ends where they were, and else the file's own.
        const simple = (pts: [number, number][]) => {
          const n = pts.length, edges = pts.map((p, k) => [p, pts[(k + 1) % n]] as const);
          if (edges.some(([p, q]) => Math.hypot(q[0] - p[0], q[1] - p[1]) < 0.001)) return false;
          // (Nor a spike: an edge that turns straight back along the one before — collinear, no crossing seen above.)
          for (let k = 0; k < n; k++) {
            const [p, q] = edges[k], [, r] = edges[(k + 1) % n];
            const u = [q[0] - p[0], q[1] - p[1]], v = [r[0] - q[0], r[1] - q[1]];
            if ((u[0] * v[0] + u[1] * v[1]) / (Math.hypot(...u) * Math.hypot(...v)) < -0.999) return false;
          }
          const cr = (o: number[], p: number[], q: number[]) => (p[0] - o[0]) * (q[1] - o[1]) - (p[1] - o[1]) * (q[0] - o[0]);
          for (let i = 0; i < n; i++) for (let j = i + 1; j < n; j++) {
            if (j === i + 1 || (i === 0 && j === n - 1)) continue;
            const [a, b] = edges[i], [c, d] = edges[j];
            const d1 = cr(c, d, a), d2 = cr(c, d, b), d3 = cr(a, b, c), d4 = cr(a, b, d);
            if (((d1 > 1e-9 && d2 < -1e-9) || (d1 < -1e-9 && d2 > 1e-9)) && ((d3 > 1e-9 && d4 < -1e-9) || (d3 < -1e-9 && d4 > 1e-9))) return false;
          }
          return true;
        };
        let outline = outlineAt(ext0, ext1);
        if (!simple(outline)) {
          const tries: [number, number][] = [[baseExt0, baseExt1], [0, 0]];
          const ok = tries.find(([a, b]) => simple(outlineAt(a, b)));
          if (typeof process !== 'undefined' && process.env?.RECIPE_TRACE) console.error(`[profile-folded] ${record.item.guid} ${lookRef}: ends ${ext0.toFixed(3)}/${ext1.toFixed(3)} fold it → ${ok ? ok.map((x) => x.toFixed(3)).join('/') : 'as given'}`);
          outline = ok ? outlineAt(...ok) : profile.map(([a, up]) => [a, up] as [number, number]);
        }
        const flatOf = (pts: [number, number][]) => pts.flatMap(([along, height]) => {
          const p = [sg.from[0] + along * dir[0], sg.from[1] + along * dir[1]];
          return [p[0] * s, p[1] * s, (level.at + base + height) * s];
        });
        for (const v of flatOf(outline)) flat.push(v);
        attrs.Profile = JSON.stringify([flat]);
        // 🔴 A SLIT FROM ITS FOOT NEARLY TO ITS TOP IS TWO WALLS (GNI model_71 r58: «SW - 035/045», 10 cm slits up to 20 cm
        // under the top; the modelling tool «No es posible crear extrusión» and deleted both walls): its box either side of the slit, a
        // wall of each — the strip over the slit left out. (Measured r63: model_71 89.2 → 91.0; on no reference model.)
        if (outline.length === 8) {
          const zs = outline.map(([, u]) => u), top = Math.max(...zs), low = Math.min(...zs);
          const as = outline.map(([a]) => a), a0 = Math.min(...as), a1 = Math.max(...as);
          const inner = outline.filter(([a]) => a > a0 + 0.005 && a < a1 - 0.005);
          const sa = [...new Set(inner.map(([a]) => +a.toFixed(4)))].sort((x, y) => x - y);
          const corners = outline.filter(([a, u]) => (Math.abs(a - a0) < 0.005 || Math.abs(a - a1) < 0.005) && (Math.abs(u - top) < 0.005 || Math.abs(u - low) < 0.005)).length;
          if (corners === 4 && inner.length === 4 && sa.length === 2 && sa[1] - sa[0] < 0.3 && inner.some(([, u]) => Math.abs(u - low) < 0.005) && inner.every(([, u]) => Math.abs(u - low) < 0.005 || top - u < 0.3)) {
            const box = (x0: number, x1: number): [number, number][] => [[x0, low], [x1, low], [x1, top], [x0, top]];
            attrs.Profile = JSON.stringify([flatOf(box(a0, sa[0]))]);
            pieceProfiles = [JSON.stringify([flatOf(box(sa[1], a1))])];
            if (typeof process !== 'undefined' && process.env?.RECIPE_TRACE) console.error(`[slit-split] ${record.item.guid} ${lookRef}: a slit ${((sa[1] - sa[0]) * 100).toFixed(0)} cm wide at ${sa[0].toFixed(2)}, two walls`);
          }
        }
        delete attrs.TopLevel;
        delete attrs.TopOffset;
      }
      // Its top attached to a roof (the modelling tool's Attach Top), when that roof is made too.
      const attachedTo = record.params.topAttachedTo;
      // ON A ROOF'S TOP FACE (a gable end): the modelling tool attaches a wall to a roof's underside only, and
      // the original is that wall with its profile edited to the gable. So is this one: its
      // outline is the roof's top over its line - each eave, the ridge where the line crosses it.
      const onTop = record.params.topAttachedAt === 'top' || (body as { topAttachedAt?: string }).topAttachedAt === 'top';
      const gable = !sg.arcMid && typeof attachedTo === 'string' && onTop && !attrs.Profile && roofRecords.has(attachedTo) ? gableOf(roofRecords.get(attachedTo)!) : null;
      if (gable) {
        const L = Math.hypot(e[0] - f[0], e[1] - f[1]);
        const at = (t: number) => [f[0] + ((e[0] - f[0]) * t) / L, f[1] + ((e[1] - f[1]) * t) / L];
        // Stations: both ends, and where the line crosses the ridge.
        const da = (f[0] - gable.A[0]) * gable.n[0] + (f[1] - gable.A[1]) * gable.n[1];
        const db = (e[0] - gable.A[0]) * gable.n[0] + (e[1] - gable.A[1]) * gable.n[1];
        const stations = [0, L];
        if ((da - gable.ridge) * (db - gable.ridge) < 0) stations.splice(1, 0, ((gable.ridge - da) / (db - da)) * L);
        const bottom = level.at + base;
        const flat: number[] = [];
        const corner = (t: number, z: number) => { const p = at(t); flat.push(p[0] * s, p[1] * s, z * s); };
        corner(0, bottom);
        corner(L, bottom);
        for (const t of [...stations].reverse()) { const p = at(t); corner(t, gable.zAt(p[0], p[1])); }
        attrs.Profile = JSON.stringify([flat]);
        delete attrs.TopLevel;
        delete attrs.TopOffset;
      }
      // Not said by the converter: read off the file's own shape (a top the roof cut).
      const attachTo = typeof attachedTo === 'string' ? attachedTo
        : shapes && record.item.guid ? roofOverWall(shapes, record.item.guid, roofGids) : undefined;
      if (attachTo && !attrs.Profile) { attrs.AttachTop = key(attachTo); const before = made.get(key(attachTo)); if (before) attrs.AttachTopMade = before; }
      if (attachTo && typeof attachedTo !== 'string' && typeof process !== 'undefined' && process.env?.RECIPE_TRACE) console.error(`[attach] ${record.item.guid} ${record.item.name ?? ''} → ${attachTo}`);
      // 🔴 ITS TOP AS ITS SHAPE DRAWS IT, when nothing above said it (an edited profile the modelling tool exported as polygonal
      // openings with nothing in them: racbasic's 530178, 6.3 m³ for 1.2; see `wallTopOf`).
      if (!attrs.Profile && !attrs.AttachTop && shapeOfWall) {
        // (Its whole outline first, when nothing is hosted in it and the outline is the wall: a top read alone stands
        // on a flat foot, and Savoyvilla's wall beside the ramp, cut from below by it, came 7.7 m³ for 3.6, 24-10.)
        const hostedIn = [...shapes!.elements.values()].filter((o) => o.host === record.item.guid && !/^IFCOPENINGELEMENT$/i.test(o.ifcClass));
        let whole = wallTopOf(shapes!, record.item.guid!, f, e, true);
        // (Never an edge of millimetres — Schependomlaan's balcony upstands, «la línea es demasiado corta», and the modelling tool
        // deleted them: corners nearer than 2 cm to the last kept one merged; a hole left with less than three, gone.)
        const merged = (loop: [number, number][]) => {
          const out: [number, number][] = [];
          for (const p of loop) if (!out.length || Math.hypot(p[0] - out[out.length - 1][0], p[1] - out[out.length - 1][1]) >= 0.02) out.push(p);
          while (out.length > 1 && Math.hypot(out[0][0] - out[out.length - 1][0], out[0][1] - out[out.length - 1][1]) < 0.02) out.pop();
          return out;
        };
        if (whole?.outline) {
          const outline = merged(whole.outline);
          whole = outline.length >= 3 ? { ...whole, outline, holes: (whole.holes ?? []).map(merged).filter((h) => h.length >= 3) } : null;
        }
        // 🔴 (Something hosted in it — Savoyvilla 24-10: the wall the ramp runs through, and a window in it — its outline all
        // the same, without the holes its hosted things fill: each of those cuts its own.)
        if (hostedIn.length && whole?.outline) {
          const L0 = Math.hypot(e[0] - f[0], e[1] - f[1]), d0 = [(e[0] - f[0]) / L0, (e[1] - f[1]) / L0];
          const boxes = hostedIn.map((o) => {
            const q = shapePoints(shapes!, o.gid).map((p) => [(p[0] - f[0]) * d0[0] + (p[1] - f[1]) * d0[1], p[2]]);
            return q.length ? [Math.min(...q.map((x) => x[0])), Math.max(...q.map((x) => x[0])), Math.min(...q.map((x) => x[1])), Math.max(...q.map((x) => x[1]))] : null;
          }).filter((b): b is number[] => b !== null);
          const filled = (hole: [number, number][]) => {
            const a0 = Math.min(...hole.map((h) => h[0])), a1 = Math.max(...hole.map((h) => h[0])), z0 = Math.min(...hole.map((h) => h[1])), z1 = Math.max(...hole.map((h) => h[1]));
            // (Any of them in it at all: a hole two windows share, cut as a rectangle, and the modelling tool deleted both — racbasic
            // and Savoyvilla r36, 5 windows missing.)
            return boxes.some((b) => Math.min(a1, b[1]) - Math.max(a0, b[0]) > 0.01 && Math.min(z1, b[3]) - Math.max(z0, b[2]) > 0.01);
          };
          const free = (whole.holes ?? []).filter((h) => !filled(h));
          // (And with none left: its outline still says a notch its top cannot — Savoyvilla's lintel wall, 2.4 m³ for 1.5.)
          whole = !whole.pieces?.length && (free.length || whole.outline.length > 4) ? { ...whole, holes: free } : null;
          if (whole && typeof process !== 'undefined' && process.env?.RECIPE_TRACE) console.error(`[wall-outline] ${record.item.guid}: ${hostedIn.length} hosted, ${free.length} empty hole(s) kept`);
        }
        const top = whole?.outline ? null : wallTopOf(shapes!, record.item.guid!, f, e);
        if (top) {
          if (typeof process !== 'undefined' && process.env?.RECIPE_TRACE) console.error(`[wall-top] ${record.item.guid} ${record.item.name ?? ''}: ${top.chain.map(([a, z]) => `${a.toFixed(2)}/${z.toFixed(2)}`).join(' ')}`);
          const L = Math.hypot(e[0] - f[0], e[1] - f[1]);
          const dir = [(e[0] - f[0]) / L, (e[1] - f[1]) / L];
          const flat: number[] = [];
          const corner = (along: number, z: number) => { flat.push((f[0] + along * dir[0]) * s, (f[1] + along * dir[1]) * s, z * s); };
          corner(top.lo, top.bottom - shapeDz);
          corner(top.hi, top.bottom - shapeDz);
          for (const [along, z] of [...top.chain].reverse()) corner(along, z - shapeDz);
          attrs.Profile = JSON.stringify([flat]);
          delete attrs.TopLevel;
          delete attrs.TopOffset;
        }
        // Else its whole outline when nothing is hosted in it (a notch at its end; see `wallTopOf`): where a door or
        // window is, its own opening cuts it.
        // (Its openings with nothing in them are its outline's holes: only a door or a window hosted keeps it a box.)
        if (whole?.outline) {
          if (typeof process !== 'undefined' && process.env?.RECIPE_TRACE) console.error(`[wall-outline] ${record.item.guid} ${record.item.name ?? ''}: ${whole.outline.length} corners`);
          const L = Math.hypot(e[0] - f[0], e[1] - f[1]);
          const dir = [(e[0] - f[0]) / L, (e[1] - f[1]) / L];
          const loopOf = (loop: [number, number][]) => loop.flatMap(([along, z]) => [(f[0] + along * dir[0]) * s, (f[1] + along * dir[1]) * s, (z - shapeDz) * s]);
          attrs.Profile = JSON.stringify([loopOf(whole.outline), ...(whole.holes ?? []).map(loopOf)]);
          delete attrs.TopLevel;
          delete attrs.TopOffset;
          pieceProfiles = (whole.pieces ?? []).map((p) => JSON.stringify([loopOf(p)]));
        }
      } else if (attrs.Profile && shapeOfWall && !attrs.AttachTop) {
        // 🔴 A PROFILE THE CONVERTER GAVE, AND THE HOLES ITS FACE SHOWS (racbasic 24-10: a SIP gable wall that is mostly
        // one pentagonal window, 6.3 m³ for 1.2: the gable came, the window, a non-rectangular opening, never did).
        // Only for a wall whose hosted things are empty openings; the applier cuts what the modelling tool's outline will not take.
        const hosted = [...shapes!.elements.values()].some((o) => o.host === record.item.guid && !/^IFCOPENINGELEMENT$/i.test(o.ifcClass));
        const whole = !hosted ? wallTopOf(shapes!, record.item.guid!, f, e, true) : null;
        if (whole?.holes?.length && !whole.pieces?.length) {
          const L = Math.hypot(e[0] - f[0], e[1] - f[1]);
          const dir = [(e[0] - f[0]) / L, (e[1] - f[1]) / L];
          const loopOf = (loop: [number, number][]) => loop.flatMap(([along, z]) => [(f[0] + along * dir[0]) * s, (f[1] + along * dir[1]) * s, (z - shapeDz) * s]);
          try {
            const given = JSON.parse(attrs.Profile) as number[][];
            attrs.Profile = JSON.stringify([...given, ...whole.holes.map(loopOf)]);
            if (typeof process !== 'undefined' && process.env?.RECIPE_TRACE) console.error(`[wall-holes] ${record.item.guid} ${record.item.name ?? ''}: ${whole.holes.length} hole(s) added to the converter's profile`);
          } catch { /* a profile not in loops: as it came */ }
        }
      }
      // 🔴 CUT BY THE PLANES THE FILE CUTS IT BY (Savoyvilla 24-10: the wall beside the ramp, cut from below by its slope,
      // something hosted in it so read by its top alone, its foot flat: 7.7 m³ for 3.6): its outline clipped by each
      // plane that is not upright (an upright one is an end, which its line already says).
      const clips = ((body as { clippedBy?: { through: number[]; keep: number[] }[] }).clippedBy ?? []).filter((c) => Array.isArray(c.through) && Array.isArray(c.keep) && Math.abs(c.keep[2]) > 0.05);
      if (!sg.arcMid && clips.length && !attrs.AttachTop) {
        try {
          const L = Math.hypot(e[0] - f[0], e[1] - f[1]);
          const z0 = level.at + base;
          const loops: number[][] = attrs.Profile ? JSON.parse(attrs.Profile)
            : [[f[0] * s, f[1] * s, z0 * s, e[0] * s, e[1] * s, z0 * s, e[0] * s, e[1] * s, (z0 + height) * s, f[0] * s, f[1] * s, (z0 + height) * s]];
          let pts = [] as number[][];
          for (let i = 0; i + 2 < loops[0].length; i += 3) pts.push([loops[0][i] / s, loops[0][i + 1] / s, loops[0][i + 2] / s]);
          const areaOf = (q: number[][]) => { const d = [(e[0] - f[0]) / L, (e[1] - f[1]) / L]; let a = 0; for (let i = 0; i < q.length; i++) { const p = q[i], r = q[(i + 1) % q.length]; a += (p[0] * d[0] + p[1] * d[1]) * r[2] - (r[0] * d[0] + r[1] * d[1]) * p[2]; } return Math.abs(a) / 2; };
          const before = areaOf(pts);
          for (const c of clips) {
            const side = (p: number[]) => (p[0] - c.through[0]) * c.keep[0] + (p[1] - c.through[1]) * c.keep[1] + (p[2] - c.through[2]) * c.keep[2];
            const out: number[][] = [];
            for (let i = 0; i < pts.length; i++) {
              const p = pts[i], q = pts[(i + 1) % pts.length], sp = side(p), sq = side(q);
              if (sp >= 0) out.push(p);
              if ((sp >= 0) !== (sq >= 0)) { const r = sp / (sp - sq); out.push([0, 1, 2].map((k) => p[k] + r * (q[k] - p[k]))); }
            }
            pts = out;
          }
          const after = pts.length >= 3 ? areaOf(pts) : 0;
          if (after > 0.05 && before - after > 0.05) {
            if (typeof process !== 'undefined' && process.env?.RECIPE_TRACE) console.error(`[wall-clip] ${record.item.guid} ${record.item.name ?? ''}: ${clips.length} plane(s), ${before.toFixed(2)} → ${after.toFixed(2)} m²`);
            attrs.Profile = JSON.stringify([pts.flatMap((p) => [p[0] * s, p[1] * s, p[2] * s]), ...loops.slice(1)]);
            delete attrs.TopLevel;
            delete attrs.TopOffset;
          }
        } catch { /* a profile not in loops: as it came */ }
      }
      // 🔴 AN ARC, WHERE ITS SHAPE BOWS (cims 24-10: curved partitions the converter gives as the chord, 12 cm off at
      // their middle): the middle of its shape across its line against its ends'; bowed over 2 cm, the point its arc
      // passes through, for the applier to bend its line there.
      if (!attrs.Profile && shapeOfWall) {
        const pts = shapePoints(shapes!, record.item.guid!);
        const L = Math.hypot(e[0] - f[0], e[1] - f[1]);
        if (pts.length >= 8 && L > 0.5) {
          const d = [(e[0] - f[0]) / L, (e[1] - f[1]) / L], nrm = [-d[1], d[0]];
          const band = (lo: number, hi: number) => {
            const u = pts.filter((q) => { const t = (q[0] - f[0]) * d[0] + (q[1] - f[1]) * d[1]; return t >= lo * L && t <= hi * L; }).map((q) => (q[0] - f[0]) * nrm[0] + (q[1] - f[1]) * nrm[1]);
            return u.length >= 2 ? { c: (Math.max(...u) + Math.min(...u)) / 2, w: Math.max(...u) - Math.min(...u) } : null;
          };
          const b0 = band(-0.02, 0.06), b1 = band(0.94, 1.02), bm = band(0.45, 0.55);
          if (b0 && b1 && bm) {
            const base = (b0.c + b1.c) / 2, sag = bm.c - base;
            // (An arc, not a jog: every point, the arc taken away, lies within its thickness — Savoyvilla's and racbasic's
            // straight walls with a step or a sweep read 6 cm, and spread wider once a bow they have not is taken off.)
            const residual = pts.map((q) => {
              const t = Math.min(Math.max(((q[0] - f[0]) * d[0] + (q[1] - f[1]) * d[1]) / L, 0), 1);
              return (q[0] - f[0]) * nrm[0] + (q[1] - f[1]) * nrm[1] - base - 4 * sag * t * (1 - t);
            });
            const spread = Math.max(...residual) - Math.min(...residual);
            // (And its middle seen on both faces: racbasic's straight partitions have one face's
            // vertex alone there, a «bow» of half their thickness.)
            const arcLike = spread < (b0.w + b1.w) / 2 + 0.01 && bm.w > 0.5 * Math.min(b0.w, b1.w);
            if (typeof process !== "undefined" && process.env?.RECIPE_WALL?.split(",").includes(record.item.guid ?? "")) console.error(`[arc-bands] ${JSON.stringify({ b0, bm, b1, sag, spread })}`);
            if (arcLike && Math.abs(sag) > 0.02 && Math.abs(sag) < L / 2) {
              const m = [(f[0] + e[0]) / 2 + nrm[0] * sag, (f[1] + e[1]) / 2 + nrm[1] * sag];
              attrs.LocationArc = `${num(m[0] * s)},${num(m[1] * s)},${num(z)}`;
              if (typeof process !== 'undefined' && process.env?.RECIPE_TRACE) console.error(`[wall-arc] ${record.item.guid} ${record.item.name ?? ''}: bows ${(sag * 100).toFixed(1)} cm over ${L.toFixed(2)} m`);
            }
          }
        }
      }
      const width = thicknessOf(lookRef);
      if (width) attrs['Type.Width'] = num(width);
      // 🔴 ONE TYPE, ONE WIDTH: a type name the file uses at another thickness is a variant of its own, «name · N mm»
      // (Savoyvilla 24-10: «萨伏伊别墅内墙（墙饰条）» at 260 mm and at 120; the type was made by the first, and the 120 mm
      // walls came out 260, twice their volume).
      if (width) {
        const seen = wallTypeWidths.get(attrs.Type);
        if (seen === undefined) wallTypeWidths.set(attrs.Type, width);
        else if (Math.abs(seen - width) > 0.001) attrs.Type = `${attrs.Type} · ${Math.round((width / s) * 1000)} mm`;
      }
      // ITS LAYERS, as the file declares them (the original's compound wall: a face between each two, which a
      // one-layer type has not; racbasic's partitions 6 cm off the original everywhere, 21-10). the modelling tool lists them
      // from the exterior, the side left of the line; the file stacks them from the line's right, and a usage
      // against its axis is the same type flipped (one type for every wall of it, as in the modelling tool).
      const declared = record.item.guid ? shapes?.elements.get(record.item.guid) : undefined;
      if (declared?.layers && declared.layers.length > 1) {
        attrs['Type.Layers'] = JSON.stringify([...declared.layers].reverse().map((l) => [+num(l.thickness * s), l.material ?? '', l.function ?? '']));
        if (declared.layersFlipped) attrs.FlipLayers = '1';
      }
      // 🔴 …AND WHERE IT DECLARES NONE, AS ITS BODY STACKS THEM (GNI model_119 30-10, Archicad: «Wall Brick - Red 287 mm»,
      // an IfcMaterialConstituentSet with no thicknesses, its body one solid per constituent and a 5 cm cavity between;
      // as one 287 mm layer, 55 walls «off» at 14 cm, the faces between its layers nowhere in ours): the bands its pieces
      // fill across its line, exterior (left) first, a gap between two an air layer. One type, one stack: a wall of the
      // type drawn the other way is it flipped; one stacked otherwise keeps the type's.
      else if (typeof process !== 'undefined' && process.env?.RECIPE_PIECE_LAYERS && declared && declared.pieces.length >= 2 && width && record.item.guid) {
        const L = Math.hypot(e[0] - f[0], e[1] - f[1]), d = [(e[0] - f[0]) / L, (e[1] - f[1]) / L];
        const bands: [number, number][] = [];
        declared.pieces.forEach((_, k) => {
          const pts = shapePoints(shapes!, record.item.guid!, k);
          if (pts.length < 4) return;
          const al = pts.map((p) => (p[0] - f[0]) * d[0] + (p[1] - f[1]) * d[1]), ac = pts.map((p) => -(p[0] - f[0]) * d[1] + (p[1] - f[1]) * d[0]), zs = pts.map((p) => p[2]);
          // (Its layer bodies only — most of its height, a length of it, a piece an opening cut short as good — not a
          // corner's bit.)
          if (Math.max(...al) - Math.min(...al) < Math.min(0.3, 0.5 * L) || Math.max(...zs) - Math.min(...zs) < 0.5 * height) return;
          const lo = Math.min(...ac), hi = Math.max(...ac);
          if (!bands.some((b) => Math.abs(b[0] - lo) < 0.002 && Math.abs(b[1] - hi) < 0.002)) bands.push([lo, hi]);
        });
        bands.sort((a, b) => b[1] - a[1]);
        const total = bands.length ? bands[0][1] - bands[bands.length - 1][0] : 0;
        const stacked = bands.every((b, k) => k === 0 || b[1] <= bands[k - 1][0] + 0.002);
        if (bands.length >= 2 && stacked && Math.abs(total - width / s) < 0.01) {
          const rows: [number, string, string][] = [];
          bands.forEach((b, k) => {
            // (To the half millimetre: the same stack in another wall is the same type.)
            const mm = (x: number) => +num((Math.round(x * 2000) / 2000) * s);
            if (k > 0 && bands[k - 1][0] - b[1] > 0.003) rows.push([mm(bands[k - 1][0] - b[1]), '', 'air']);
            rows.push([mm(b[1] - b[0]), '', '']);
          });
          const mine = JSON.stringify(rows), back = JSON.stringify([...rows].reverse()), seen = pieceLayersOf.get(attrs.Type);
          if (seen === undefined) pieceLayersOf.set(attrs.Type, mine);
          if (seen === undefined || seen === mine) attrs['Type.Layers'] = mine;
          else if (seen === back) { attrs['Type.Layers'] = seen; attrs.FlipLayers = '1'; }
          if (typeof process !== 'undefined' && process.env?.RECIPE_TRACE) console.error(`[piece-layers] ${record.item.guid} ${attrs.Type}: ${mine}${seen && seen !== mine ? (seen === back ? ' (flipped)' : ' (the type stacks otherwise: kept)') : ''}`);
        }
      }
      // 🔴 A LAYER THAT GOES ON ABOVE OR BELOW THE WALL (GNI model_176, Archicad 26 «SW - 0xx»: a 5 cm cladding up to
      // 3.2 m on a 25 cm structure up to 3.0, one 30 cm wall up to 3.2 before, a strip too many on each; the converter
      // since e64534d2a: `topExtension` / `baseExtension` on its style's layers): its type's layers from the style,
      // exterior first, each with its extension; the modelling tool's extendable layer and the wall's extension distances.
      if (!attrs['Type.Layers'] && typeof process !== 'undefined' && process.env?.RECIPE_LAYER_EXT) {
        const def =(() => { try { return JSON.parse(String(styles.get(lookRef)?.params?.definition ?? 'null')); } catch { return null; } })() as { layers?: { thickness?: number; material?: string; function?: string; topExtension?: number; baseExtension?: number }[] } | null;
        const ls = def?.layers ?? [];
        if (ls.length > 1 && ls.some((l) => (l.topExtension ?? 0) > 0.001 || (l.baseExtension ?? 0) > 0.001)) {
          attrs['Type.Layers'] = JSON.stringify(ls.map((l) => [+num((l.thickness ?? 0) * s), l.material ?? '', l.function ?? '', +num((l.topExtension ?? 0) * s), +num((l.baseExtension ?? 0) * s)]));
          const top = Math.max(...ls.map((l) => l.topExtension ?? 0)), bottom = Math.max(...ls.map((l) => l.baseExtension ?? 0));
          // 🔴 …AS THE MODELLING TOOL CAN MAKE IT: THE WALL UP TO ITS FINISH'S TOP, CUT BY THE SLAB ITS STRUCTURE STOPS AT (GNI model_176
          // r60y: the modelling tool's API refuses an extendable layer on any structure not already vertically compound, and it cannot
          // make one): its height on by the extension, plain layers, and Join Geometry with each slab its added strip runs
          // into, the slab cutting — its structure stops under the slab, its finish, past the slab's edge, goes on.
          const slabsIn = (z0: number, z1: number) => {
            if (!shapes || !record.item.guid) return [] as string[];
            const wp = shapePoints(shapes, record.item.guid);
            if (wp.length < 4) return [];
            const wb = [Math.min(...wp.map((q) => q[0])), Math.min(...wp.map((q) => q[1])), Math.max(...wp.map((q) => q[0])), Math.max(...wp.map((q) => q[1]))];
            return slabBoxes().filter((b) => b.box[0] < wb[2] - 0.01 && wb[0] < b.box[3] - 0.01 && b.box[1] < wb[3] - 0.01 && wb[1] < b.box[4] - 0.01 && b.box[2] < z1 - 0.01 && z0 < b.box[5] - 0.01).flatMap((b) => b.keys);
          };
          const z0 = level.at + base + shapeDz;
          const cutters = typeof process !== 'undefined' && process.env?.RECIPE_EXT_CUT && !attrs.Profile && top > 0.001 && bottom < 0.001 ? slabsIn(z0 + height, z0 + height + top) : [];
          if (cutters.length && (attrs.Height || attrs.TopOffset)) {
            attrs['Type.Layers'] = JSON.stringify(ls.map((l) => [+num((l.thickness ?? 0) * s), l.material ?? '', l.function ?? '']));
            if (attrs.TopOffset) attrs.TopOffset = num(Number(attrs.TopOffset) + top * s); else attrs.Height = num(Number(attrs.Height) + top * s);
            attrs.CutBy = [...(attrs.CutBy ? attrs.CutBy.split('|') : []), ...cutters].join('|');
            if (typeof process !== 'undefined' && process.env?.RECIPE_TRACE) console.error(`[layer-extension] ${record.item.guid} ${attrs.Type}: up ${top} to its finish's top, cut by ${cutters.length} slab(s)`);
          } else {
            if (top > 0.001) attrs.TopExtension = num(top * s);
            if (bottom > 0.001) attrs.BaseExtension = num(bottom * s);
          }
          if (typeof process !== 'undefined' && process.env?.RECIPE_TRACE) console.error(`[layer-extension] ${record.item.guid} ${attrs.Type}: top ${top}, base ${bottom}`);
        }
      }
      if (typeof process !== 'undefined' && process.env?.RECIPE_WALL?.split(",").includes(record.item.guid ?? "")) console.error(`[wall-attrs] ${JSON.stringify(attrs).slice(0, 1500)} style ${JSON.stringify(styles.get(lookRef)?.params ?? null).slice(0, 800)}`);
      if (add(`${key(record.id)}#${sg.i}`, attrs)) wallCount++;
      // Its other pieces (a wall the file cut through, top to bottom), each a wall of the same type by its outline.
      pieceProfiles.forEach((profile, k) => { if (add(`${key(record.id)}#${sg.i}p${k + 1}`, { ...attrs, Profile: profile })) wallCount++; });
    }

    // ---- 2b. Curtain walls: the modelling tool's own system, its grid line by line. ----
    // A run of the converter spans the curtain wall INSIDE its border bars: half a bar short at
    // each end, at the bottom and at the top (measured on racbasic: every wall 0.04 m short and
    // 0.04 m low, its lines 0.02 m early, against the modelling tool's own). the modelling tool's wall spans the bars'
    // middles, so the run grows by half a bar each way and its lines move with its start.
    // Lines the record leaves out are its type's rule (`asTheType` in the converter): every
    // spacing from where the justification puts the first, ends left out.
    const ruled = (length: number, spacing: number, justify: unknown): number[] => {
      if (!(spacing > 0) || spacing >= length) return [];
      const leftover = length - Math.floor(length / spacing + 1e-9) * spacing;
      const first = justify === 'beginning' ? 0 : justify === 'end' ? leftover : justify === 'centreLine' ? (length / 2) % spacing : leftover / 2;
      const out: number[] = [];
      for (let at = first; at <= length + 1e-4; at += spacing) if (at > 1e-4 && at < length - 1e-4) out.push(at);
      return out;
    };
    let curtainCount = 0;
    let curtainRead = 0;
    /** Each curtain wall type's mullion, as its first wall said it (see «one curtain type, one mullion» below). */
    const curtainTypeMullions = new Map<string, string>();
    for (const record of records) {
      if (record.kind !== 'run' || record.params.of !== 'curtainWall') continue;
      curtainRead++;
      const body = innerJson<RunBody & { lines?: { along?: number[]; up?: number[] }; omitted?: string[] }>(record, 'run');
      const seg = body?.run?.line?.curves?.[0];
      const level = levels.get(String(body?.level ?? record.params.level ?? ''));
      const lookRef = record.params.lookRef;
      const style = typeof lookRef === 'string' ? styles.get(lookRef)?.params : undefined;
      if (!seg?.from || !seg.to || typeof body?.height !== 'number' || !level || !style) continue;
      const n = (v: unknown) => (typeof v === 'number' ? v : Number(v) || 0);
      const L = Math.hypot(seg.to[0] - seg.from[0], seg.to[1] - seg.from[1]);
      const d = [(seg.to[0] - seg.from[0]) / L, (seg.to[1] - seg.from[1]) / L];
      // 🔴 Half a bar of the bars it HAS (Conference r38: its «MaxSpacing» walls' style says 0, their members are 38 mm,
      // and every grid line and the wall's ends sat 19 mm off — 135 members and 49 panels): its measured mullion when
      // its style says none.
      const measured = n(style.uprightWidth) > 0 ? null : mullionOf(record.item.guid ?? undefined, d);
      const halfUp = (n(style.uprightWidth) || (measured ? measured.width / s : 0)) / 2;
      const halfAcross = (n(style.horizontalWidth) || (measured ? measured.width / s : 0)) / 2;
      // 🔴 A SIDE WITH NO BAR (Savoyvilla 24-10: its entrance glass has none at its foot, the modelling tool's type a bar on every
      // side: the panels 25 mm high, the uprights 25 mm low): the sides whose border the file's own members do not run
      // along, not grown by half a bar and their border bars taken away. Only for a wall the file gives members for,
      // and not one by its outline.
      const bare = { start: false, end: false, bottom: false, top: false };
      /** Its uprights' middles along its line, inside its ends, where the file draws them (see «…its lines from its bars»). */
      let barsAlong: number[] = [];
      /** Its ends that are CORNER bars (an L where two walls meet): the bar's sides, metres. */
      const corners: { start?: { along: number; across: number; at: number[] }; end?: { along: number; across: number; at: number[] } } = {};
      if (shapes && record.item.guid && !Array.isArray((body as { profile?: unknown }).profile)) {
        const kids = [...shapes.elements.values()].filter((el) => el.parent === record.item.guid);
        const boxOf = (gid: string) => {
          const pts = shapePoints(shapes, gid);
          if (!pts.length) return null;
          const t = pts.map((p) => (p[0] - seg.from![0]) * d[0] + (p[1] - seg.from![1]) * d[1]), zz = pts.map((p) => p[2]);
          const a = pts.map((p) => (p[0] - seg.from![0]) * -d[1] + (p[1] - seg.from![1]) * d[0]);
          return { t0: Math.min(...t), t1: Math.max(...t), z0: Math.min(...zz), z1: Math.max(...zz), a0: Math.min(...a), a1: Math.max(...a) };
        };
        const all = kids.map((k) => boxOf(k.gid)).filter((b): b is NonNullable<typeof b> => b !== null);
        const bars = kids.filter((k) => /^IFCMEMBER$/i.test(k.ifcClass)).map((k) => boxOf(k.gid)).filter((b): b is NonNullable<typeof b> => b !== null);
        if (bars.length && all.length) {
          const T0 = Math.min(...all.map((b) => b.t0)), T1 = Math.max(...all.map((b) => b.t1)), Z0 = Math.min(...all.map((b) => b.z0)), Z1 = Math.max(...all.map((b) => b.z1));
          const flat = (b: typeof bars[number]) => b.t1 - b.t0 > b.z1 - b.z0;
          bare.bottom = !bars.some((b) => flat(b) && Math.abs(b.z0 - Z0) < 0.01);
          bare.top = !bars.some((b) => flat(b) && Math.abs(b.z1 - Z1) < 0.01);
          bare.start = !bars.some((b) => !flat(b) && Math.abs(b.t0 - T0) < 0.01);
          bare.end = !bars.some((b) => !flat(b) && Math.abs(b.t1 - T1) < 0.01);
          // 🔴 A CORNER BAR AT AN END (rac_advanced 12-11: 79 «L Corner Mullion», a rectangular bar in their place and every panel by
          // a corner 8 cm off): an upright on the end twice as wide along the wall as its others, and as deep across.
          const inner = bars.filter((b) => !flat(b) && b.t0 > T0 + 0.01 && b.t1 < T1 - 0.01).map((b) => b.t1 - b.t0).sort((x, y) => x - y);
          const usual = inner[Math.floor(inner.length / 2)] ?? halfUp * 2;
          for (const side of ['start', 'end'] as const) {
            const atEnd = bars.filter((b) => !flat(b) && (side === 'start' ? Math.abs(b.t0 - T0) < 0.01 : Math.abs(b.t1 - T1) < 0.01));
            const wide = atEnd.filter((b) => b.t1 - b.t0 > 2 * usual && b.a1 - b.a0 > 2 * usual);
            if (wide.length && wide.length >= atEnd.length / 2) {
              const w = wide[0];
              // (Where it is, plan feet: which end the applier's line starts at is its own business.)
              const endT = side === 'start' ? T0 : T1;
              corners[side] = { along: (w.t1 - w.t0) * s, across: (w.a1 - w.a0) * s, at: [(seg.from![0] + d[0] * endT) * s, (seg.from![1] + d[1] * endT) * s] };
              if (typeof process !== 'undefined' && process.env?.RECIPE_TRACE) console.error(`[curtain-corner] ${record.item.guid}: its ${side} a corner bar, ${((w.t1 - w.t0) * 1000).toFixed(0)} x ${((w.a1 - w.a0) * 1000).toFixed(0)} mm`);
            }
          }
          barsAlong = [...new Set(bars.filter((b) => !flat(b) && b.t0 > T0 + 0.01 && b.t1 < T1 - 0.01).map((b) => +((b.t0 + b.t1) / 2).toFixed(4)))].sort((x, y) => x - y);
          if (Object.values(bare).some(Boolean) && typeof process !== 'undefined' && process.env?.RECIPE_TRACE) console.error(`[curtain-bare] ${record.item.guid}: no bar at its ${Object.entries(bare).filter(([, v]) => v).map(([k]) => k).join(', ')}`);
        }
      }
      // The half bar each side grows by: none where it has no bar.
      const g0 = bare.start ? 0 : halfUp, g1 = bare.end ? 0 : halfUp, b0 = bare.bottom ? 0 : halfAcross, b1 = bare.top ? 0 : halfAcross;
      const f = [seg.from[0] - d[0] * g0, seg.from[1] - d[1] * g0];
      const e = [seg.to[0] + d[0] * g1, seg.to[1] + d[1] * g1];
      const base = (typeof body.base === 'number' ? body.base : 0) - b0;
      const height = body.height + b0 + b1;
      const z = (level.at + base) * s;
      // 🔴 …ITS LINES FROM ITS BARS, where the record says none (GNI model_0_arc r58: a the modelling tool «Curtain System», its grid
      // laid over the whole system, our wall's own centred rule half a bay off: 40 uprights and 14 panels 13.9 cm «off»):
      // its uprights' middles, when the type's rule puts a line anywhere none is. (Measured r66: model_0_arc 97.3 → 100;
      // on none of Duplex, Savoyvilla, racbasic, GNI 203/67/70/150.)
      const ruledAlong = ruled(L, n(style.alongSpacing), style.alongJustify);
      const fromBars = !body.lines?.along && barsAlong.length > 0
        && (barsAlong.length !== ruledAlong.length || barsAlong.some((t, k) => Math.abs(t - ruledAlong[k]) > 0.01));
      if (fromBars && typeof process !== 'undefined' && process.env?.RECIPE_TRACE) console.error(`[curtain-lines] ${record.item.guid}: ${barsAlong.length} from its bars, not the type's ${ruledAlong.length}`);
      const along = body.lines?.along ?? (fromBars ? barsAlong : ruledAlong);
      const up = body.lines?.up ?? ruled(body.height, n(style.upSpacing), style.upJustify);
      // «horizontal@<up mm>:<along mm>»: the segment of that line starting there is not there.
      // 🔴 A BAR BY ITS KEY, AS THE READER NAMES IT (`curtainMembers`): an upright is «upright@<along>:<up>» — only «vertical» was read,
      // and every upright a wall has taken out came back as a bar in the modelling tool (rac_advanced's storefronts, one too many each, 12-11).
      const stationOf = (one: string) => {
        const m = /^(horizontal|vertical|upright)@(-?[\d.]+):(-?[\d.]+)$/.exec(one);
        if (!m) return [];
        const horizontal = m[1] === 'horizontal';
        const at = Number(m[2]) / 1000 + (horizontal ? b0 : g0);
        const from = Number(m[3]) / 1000 + (horizontal ? g0 : b0);
        return [{ horizontal, at: at * s, from: from * s }];
      };
      const omit = (body.omitted ?? []).flatMap(stationOf);
      // 🔴 AND THE STRETCHES OF ITS LINES IT HAS TAKEN OUT, ITS PANELS THERE ONE (`merged`): the modelling tool's «remove segment», so the panel is one
      // as in the file (rac_advanced 12-11: a wall with a door had 74 panels for its 49, every merged pair cut in two).
      const merge = (((body as { merged?: string[] }).merged) ?? []).flatMap(stationOf);
      // (Its bare sides' border bars, one station per bay along each: the applier takes the type's bar there away. With no
      // bar on any side, a type with no border bars instead — Savoyvilla's entrance glass, r41: its bars would not go.)
      const noBorders = bare.start && bare.end && bare.bottom && bare.top;
      if (!noBorders) {
        const alongs = [0, ...along.map((a) => a + g0)], ups = [0, ...up.map((u) => u + b0)];
        const Lg = L + g0 + g1;
        if (bare.bottom) for (const x of alongs) omit.push({ horizontal: true, at: 0, from: x * s });
        if (bare.top) for (const x of alongs) omit.push({ horizontal: true, at: height * s, from: x * s });
        if (bare.start) for (const y of ups) omit.push({ horizontal: false, at: 0, from: y * s });
        if (bare.end) for (const y of ups) omit.push({ horizontal: false, at: Lg * s, from: y * s });
      }
      // «panel@<along mm>,<up mm>»: that cell is no glass (a door stands in it).
      const empty = (body.omitted ?? []).flatMap((one) => {
        const m = /^panel@(-?[\d.]+),(-?[\d.]+)$/.exec(one);
        return m ? [{ along: (Number(m[1]) / 1000 + g0) * s, up: (Number(m[2]) / 1000 + b0) * s }] : [];
      });
      // 🔴 ITS PANELS THAT ARE NO PLAIN SHEET (louvres, grilles: `shapedPanelsOf`): their cells empty, and each made as a
      // family of its own shape where the file has it.
      if (shapes && record.item.guid) {
        for (const panel of shapedPanelsOf(shapes, record.item.guid, n(style.panelDepth), [-d[1], d[0]])) {
          const a = (panel.centre[0] - seg.from[0]) * d[0] + (panel.centre[1] - seg.from[1]) * d[1];
          const u = panel.centre[2] - shapeDz - (level.at + (typeof body.base === 'number' ? body.base : 0));
          if (a < -0.01 || a > L + 0.01 || u < -0.01 || u > body.height + 0.01) continue;
          const cellAlong = Math.max(0, ...along.filter((x) => x <= a + 1e-6));
          const cellUp = Math.max(0, ...up.filter((x) => x <= u + 1e-6));
          empty.push({ along: (cellAlong + g0) * s, up: (cellUp + b0) * s });
          shapedPanels.add(panel.gid);
        }
      }
      // 🔴 ITS PANELS THAT ARE ANOTHER SHEET (rac_advanced 13-11: «System Panel:Solid», 60 mm, among its 25 mm glass, all made glass and
      // 4 cm off): a plate thicker or thinner than the wall's usual, or standing elsewhere across it, its cell given a panel of its own —
      // its thickness, and the usual offset moved by how far its middle is from the usual's.
      let panelOffset = -n(style.panelOffset) * s;
      const env: Record<string, string | undefined> = typeof process !== 'undefined' ? process.env : {};
      const others: { along: number; up: number; name: string; thickness: number; offset: number }[] = [];
      if (shapes && record.item.guid) {
        const nrm = [-d[1], d[0]];
        const plates = [...shapes.elements.values()].filter((el) => el.parent === record.item.guid && /^IFCPLATE$/i.test(el.ifcClass) && !shapedPanels.has(el.gid)).flatMap((el) => {
          const pts = shapePoints(shapes, el.gid);
          if (pts.length < 4) return [];
          const ac = pts.map((p) => (p[0] - seg.from![0]) * nrm[0] + (p[1] - seg.from![1]) * nrm[1]);
          const t0 = Math.min(...ac), t1 = Math.max(...ac);
          const c = [0, 1, 2].map((k) => pts.reduce((t, p) => t + p[k], 0) / pts.length);
          return [{ el, thickness: t1 - t0, mid: (t0 + t1) / 2, a: (c[0] - seg.from![0]) * d[0] + (c[1] - seg.from![1]) * d[1], u: c[2] - shapeDz - (level.at + (typeof body.base === 'number' ? body.base : 0)) }];
        });
        if (plates.length > 1) {
          const med = (v: number[]) => [...v].sort((p, q) => p - q)[Math.floor(v.length / 2)]!;
          const usualT = med(plates.map((p) => p.thickness)), usualMid = med(plates.map((p) => p.mid));
          const sign = Number(env.RECIPE_PANEL_ACROSS_SIGN ?? 1);
          // 🔴 ITS PANELS WHERE THE FILE HAS THEM, WHEN ITS STYLE SAYS NOTHING (a client's model 13-11: «B100», a basic wall as the panel, 125 mm,
          // its middle 37 mm off the wall's line and made on it, every panel 4 cm off): the usual panel's middle off the line, measured.
          if (Math.abs(n(style.panelOffset)) < 1e-6 && Math.abs(usualMid) > 0.003) {
            panelOffset = sign * usualMid * s;
            if (env.RECIPE_TRACE) console.error(`[curtain-panel] ${record.item.guid}: its panels ${(usualMid * 1000).toFixed(0)} mm off its line, by the file`);
          }
          for (const p of plates) {
            if (Math.abs(p.thickness - usualT) < 0.005 && Math.abs(p.mid - usualMid) < 0.005) continue;
            if (p.a < -0.01 || p.a > L + 0.01 || p.u < -0.01 || p.u > body.height + 0.01) continue;
            const cellAlong = Math.max(0, ...along.filter((x) => x <= p.a + 1e-6));
            const cellUp = Math.max(0, ...up.filter((x) => x <= p.u + 1e-6));
            others.push({ along: (cellAlong + g0) * s, up: (cellUp + b0) * s, name: (p.el.typeName ?? p.el.name ?? 'panel').replace(/:\d+$/, ''), thickness: p.thickness * s, offset: panelOffset + sign * (p.mid - usualMid) * s });
          }
          if (others.length && env.RECIPE_TRACE) console.error(`[curtain-others] ${record.item.guid}: ${others.length} panel(s) of another sheet (${[...new Set(others.map((o) => `${o.name} ${(o.thickness / s * 1000).toFixed(0)} mm`))].join(', ')})`);
        }
      }
      const attrs: Record<string, string> = {
        CategoryId: CATEGORY.walls,
        Type: nativeOf(record)?.type ?? String(lookRef),
        LocationLine: `${num(f[0] * s)},${num(f[1] * s)},${num(z)};${num(e[0] * s)},${num(e[1] * s)},${num(z)}`,
        Level: level.name,
        BaseOffset: num(base * s),
        Height: num(height * s),
        Curtain: JSON.stringify({
          ...(others.length ? { others } : {}),
          along: along.map((a) => (a + g0) * s),
          up: up.map((u) => (u + b0) * s),
          omit,
          ...(merge.length ? { merge } : {}),
          ...(corners.start || corners.end ? { corners } : {}),
          empty,
          ...(noBorders ? { noBorders: true } : {}),
          mullion: n(style.uprightWidth) > 0 ? { width: n(style.uprightWidth) * s, depth: n(style.depth) * s } : measured ?? { width: 0, depth: n(style.depth) * s },
          // The glass off the bars' middle: the converter counts it toward the wall's inside,
          // the modelling tool's panel offset toward its outside (measured: racbasic's glass 0.032 m off,
          // on the other side, with the sign as it was).
          panel: { thickness: glassOf(record.item.guid ?? undefined, d) ?? n(style.panelDepth) * s, offset: panelOffset },
        }),
      };
      // ITS OUTLINE, where it is not its rectangle (a gable under a roof): the record's, inside
      // the bars like the rest of it, grown by half a bar out from every edge, laid in the
      // wall's plane from the grown start and base.
      const outline = (body as { profile?: [number, number][] }).profile;
      if (Array.isArray(outline) && outline.length >= 3) {
        const area = outline.reduce((sum, p, i) => { const q = outline[(i + 1) % outline.length]; return sum + p[0] * q[1] - q[0] * p[1]; }, 0);
        const out = area > 0 ? 1 : -1; // outward normal of edge (dx, dy) is out * (dy, -dx)
        const k = outline.length;
        const grown = outline.map((p, i) => {
          const prev = outline[(i - 1 + k) % k], next = outline[(i + 1) % k];
          const edgeLine = (a: [number, number], b: [number, number]) => {
            const dx = b[0] - a[0], dy = b[1] - a[1], len = Math.hypot(dx, dy) || 1;
            const nx = (out * dy) / len, ny = (-out * dx) / len;
            // Half a bar: an upright's on an upright edge, a horizontal's otherwise.
            const half = Math.abs(nx) > Math.abs(ny) ? halfUp : halfAcross;
            return { p: [a[0] + nx * half, a[1] + ny * half], d: [dx, dy] };
          };
          const l1 = edgeLine(prev, p), l2 = edgeLine(p, next);
          const den = l1.d[0] * l2.d[1] - l1.d[1] * l2.d[0];
          if (Math.abs(den) < 1e-12) return [l2.p[0], l2.p[1]];
          const t = ((l2.p[0] - l1.p[0]) * l2.d[1] - (l2.p[1] - l1.p[1]) * l2.d[0]) / den;
          return [l1.p[0] + t * l1.d[0], l1.p[1] + t * l1.d[1]];
        });
        const flat: number[] = [];
        for (const [a, up] of grown) {
          // [along, up] from the record's start and base: the start is half an upright before it.
          flat.push((seg.from[0] + d[0] * a) * s, (seg.from[1] + d[1] * a) * s, (level.at + base + halfAcross + up) * s);
        }
        attrs.Profile = JSON.stringify([flat]);
      }
      // 🔴 ONE CURTAIN TYPE, ONE MULLION: the type is made by its first wall, its borders with that wall's mullion; a
      // wall of the same name with another is a variant, «name · W x D» (Conference Center 24-10: the first of its
      // «MaxSpacing» walls has no members, mullion 0, so the type came with no border bars for the ten that have them,
      // 160 members with nothing to be).
      {
        // (And one glass: a wall of it with thinner panels, its own too — Conference 24-10, 79 «Glazed Centered» panels
        // 26 mm for the file's 13, the type made by a wall with thicker ones.)
        const c = JSON.parse(attrs.Curtain) as { mullion: { width: number; depth: number }; panel?: { thickness?: number }; noBorders?: boolean };
        const m = c.mullion;
        const glass = c.panel?.thickness ? `, ${Math.round((c.panel.thickness / s) * 1000)} mm glass` : '';
        const sig = `${Math.round((m.width / s) * 1000)} x ${Math.round((m.depth / s) * 1000)}${glass}${c.noBorders ? ', no borders' : ''}`;
        const seen = curtainTypeMullions.get(attrs.Type);
        if (seen === undefined) curtainTypeMullions.set(attrs.Type, sig);
        else if (seen !== sig) { if (typeof process !== "undefined" && process.env?.RECIPE_TRACE) console.error(`[curtain-type] ${record.item.guid}: ${attrs.Type} first made with ${seen}, this one ${sig}`); attrs.Type = `${attrs.Type} · ${sig}`; }
      }
      if (add(key(record.id), attrs)) curtainCount++;
    }

    // ---- 2b'. Curtain walls the converter left as their pieces: the modelling tool's own all the same. ----
    // 🔴 A CURTAIN WALL IS ONE, WHATEVER RULE MADE IT (Antonio 13-11: «que TODO sean entidades nativas lo más cercanas
    // posibles al IFC original»; Savoyvilla, 7 of its 10 curtain walls refused by the converter's own rule, «no join
    // condition gives its pieces», came in as 280 generic models): an IFCCURTAINWALL with no curtain record, flat, made
    // from its pieces — its line along them, its ends and height where its bars' middles are, a grid line at each of its
    // inner bars, the stretches of line with no bar taken out (or its two panels one, where a panel spans it), a cell
    // with no panel left empty, its bars and glass as the file has them. Its pieces are then its (`seen`), doors aside.
    if (shapes) {
      const env: Record<string, string | undefined> = typeof process !== 'undefined' ? process.env : {};
      const asRun = new Set(records.filter((r) => r.kind === 'run' && r.params.of === 'curtainWall').map((r) => r.item.guid));
      const levelList = [...levels.values()].sort((a, b) => a.at - b.at);
      // (Such a wall is an assembly record of its own — `AssemblyLayer`, «a whole made of parts» — its pieces naming it their parent.)
      // (Such a wall has no record of its own to go by — its assembly records all hang on one item — so it is found by
      // its pieces: a whole with no body and no other record, made of panels and bars only, flat (checked below).)
      const byParent = new Map<string, NonNullable<ReturnType<typeof shapes.elements.get>>[]>();
      for (const el of shapes.elements.values()) if (el.parent) byParent.set(el.parent, [...(byParent.get(el.parent) ?? []), el]);
      const recorded = new Set(records.filter((r) => r.kind !== 'assembly' && r.item?.guid).map((r) => r.item.guid));
      for (const [parent, members] of byParent) {
        if (asRun.has(parent) || recorded.has(parent) || shapes.elements.has(parent)) continue;
        if (!members.some((el) => /^IFCPLATE$/i.test(el.ifcClass)) || !members.every((el) => /^IFC(PLATE|MEMBER|DOOR|WINDOW)$/i.test(el.ifcClass))) continue;
        const cw = { gid: parent, name: null as string | null, typeName: null as string | null };
        const kids = [...shapes.elements.values()].filter((el) => el.parent === cw.gid);
        const plateKids = kids.filter((k) => /^IFCPLATE$/i.test(k.ifcClass));
        const barKids = kids.filter((k) => /^IFCMEMBER$/i.test(k.ifcClass));
        if (!plateKids.length) continue;
        const all = [...plateKids, ...barKids].flatMap((k) => shapePoints(shapes, k.gid));
        if (all.length < 8) continue;
        // Its direction: the plan's principal axis of its pieces.
        const mx = all.reduce((t, p) => t + p[0], 0) / all.length, my = all.reduce((t, p) => t + p[1], 0) / all.length;
        let cxx = 0, cyy = 0, cxy = 0;
        for (const p of all) { cxx += (p[0] - mx) ** 2; cyy += (p[1] - my) ** 2; cxy += (p[0] - mx) * (p[1] - my); }
        const ang = 0.5 * Math.atan2(2 * cxy, cxx - cyy);
        const d = [Math.cos(ang), Math.sin(ang)], nrm = [-d[1], d[0]];
        const boxOf = (gid: string) => {
          const pts = shapePoints(shapes, gid);
          if (!pts.length) return null;
          const t = pts.map((p) => (p[0] - mx) * d[0] + (p[1] - my) * d[1]), a = pts.map((p) => (p[0] - mx) * nrm[0] + (p[1] - my) * nrm[1]), z = pts.map((p) => p[2] - shapeDz);
          const T0 = Math.min(...t), T1 = Math.max(...t);
          // (How much its foot rises from one end to the other: a sill up a ramp is no level bar, its box no section.)
          const footAt = (end: number) => Math.min(...z.filter((_, i) => Math.abs(t[i]! - end) < 0.02));
          return { t0: T0, t1: T1, a0: Math.min(...a), a1: Math.max(...a), z0: Math.min(...z), z1: Math.max(...z), rise: Math.abs(footAt(T1) - footAt(T0)) };
        };
        const plates = plateKids.map((k) => ({ gid: k.gid, b: boxOf(k.gid) })).filter((x): x is { gid: string; b: NonNullable<ReturnType<typeof boxOf>> } => !!x.b);
        // (Its bars are the ones touching its panels: a stray bit of bar off its edge — Savoyvilla's 0i2T…, 5 cm at a corner 20 cm above
        // the glass — would stretch the wall to it. Such a bit is made apart, as its own shape.)
        const P0t = Math.min(...plates.map((x) => x.b.t0)), P1t = Math.max(...plates.map((x) => x.b.t1));
        const P0z = Math.min(...plates.map((x) => x.b.z0)), P1z = Math.max(...plates.map((x) => x.b.z1));
        const strays: string[] = [];
        const bars = barKids.flatMap((k) => {
          const b = boxOf(k.gid);
          if (!b) return [];
          const near = b.t1 > P0t - 0.08 && b.t0 < P1t + 0.08 && b.z1 > P0z - 0.08 && b.z0 < P1z + 0.08;
          if (!near) { strays.push(k.gid); return []; }
          return [b];
        });
        const boxes = [...plates.map((x) => x.b), ...bars];
        const T0 = Math.min(...boxes.map((b) => b.t0)), T1 = Math.max(...boxes.map((b) => b.t1));
        const Z0 = Math.min(...boxes.map((b) => b.z0)), Z1 = Math.max(...boxes.map((b) => b.z1));
        const A0 = Math.min(...boxes.map((b) => b.a0)), A1 = Math.max(...boxes.map((b) => b.a1));
        // (Flat only: a curved or bent one stays its pieces.)
        // (Flat to within its own bars' depth: Savoyvilla's curved ground floor glass, its panels turning 1.5° each, read as
        // one line, would come out a chord.)
        const deepest = Math.max(...boxes.map((b) => b.a1 - b.a0));
        if (A1 - A0 > Math.max(0.1, 1.6 * deepest) || T1 - T0 < 0.2 || Z1 - Z0 < 0.2) continue;
        // (Standing, not lying: DACH's «Cristalera», a sloped glass roof of plates and bars, came as a curtain wall of 24 x 334 mm bars,
        // its pieces 15 cm off — 13-11. A pane standing in a wall is thin across it; a sloped one's plan runs wide.)
        if (plates.some((x) => x.b.a1 - x.b.a0 > 0.12)) continue;
        const flat = (b: { t0: number; t1: number; z0: number; z1: number }) => b.t1 - b.t0 > b.z1 - b.z0;
        const uprights = bars.filter((b) => !flat(b)), rails = bars.filter((b) => flat(b));
        const med = (v: number[]) => (v.length ? [...v].sort((x, y) => x - y)[Math.floor(v.length / 2)] : 0);
        const wU = med(uprights.map((b) => b.t1 - b.t0)), wR = med(rails.map((b) => b.z1 - b.z0));
        const depth = med(bars.map((b) => b.a1 - b.a0));
        const atStart = uprights.some((b) => Math.abs(b.t0 - T0) < 0.01), atEnd = uprights.some((b) => Math.abs(b.t1 - T1) < 0.01);
        const atBottom = rails.some((b) => Math.abs(b.z0 - Z0) < 0.01), atTop = rails.some((b) => Math.abs(b.z1 - Z1) < 0.01);
        // Its line through its bars' middle (its glass's, with none), its span between its border bars' middles.
        const lineA = bars.length ? med(bars.map((b) => (b.a0 + b.a1) / 2)) : med(plates.map((x) => (x.b.a0 + x.b.a1) / 2));
        // (Its span to its border bars' OUTER faces: the modelling tool draws a border mullion inside the wall's edge — Savoyvilla 13-11, every
        // border and every panel 25 mm in, half a bar, when spanned to their middles.)
        const half = env.RECIPE_CW_SPAN === 'middles' ? 1 : 0;
        const t0 = T0 + (atStart ? half * wU / 2 : 0), t1 = T1 - (atEnd ? half * wU / 2 : 0);
        const z0 = Z0 + (atBottom ? half * wR / 2 : 0), z1 = Z1 - (atTop ? half * wR / 2 : 0);
        const L = t1 - t0, H = z1 - z0;
        const near = (v: number[], x: number) => v.some((y) => Math.abs(y - x) < 0.02);
        const along: number[] = [], up: number[] = [];
        // 🔴 A BORDER BAR IS NO LINE (a client's model 13-11: spanned to the border bars' outer faces, each one's middle came half a bar in — a
        // line 25 mm from the end, a cell the modelling tool «cannot make, a panel or mullion too small», and all 14,394 changes rolled back).
        const onTheEnds = (b: { t0: number; t1: number }) => (atStart && Math.abs(b.t0 - T0) < 0.01) || (atEnd && Math.abs(b.t1 - T1) < 0.01);
        const onTheEdges = (b: { z0: number; z1: number }) => (atBottom && Math.abs(b.z0 - Z0) < 0.01) || (atTop && Math.abs(b.z1 - Z1) < 0.01);
        // 🔴 …AND A BAR OF SEVERAL PIECES IS ONE LINE (a client's model 13-11: a mullion, its cap and its back plate side by side, three lines
        // 20 and 30 mm apart, cells the modelling tool refused): the pieces whose stretches across the line touch, one bar, its line their middle.
        const middles = (spans: [number, number][]) => {
          const sorted = [...spans].sort((p, q) => p[0] - q[0]);
          const out: number[] = [];
          let cur: [number, number] | null = null;
          for (const sp of sorted) {
            if (cur && sp[0] <= cur[1] + 0.005) cur[1] = Math.max(cur[1], sp[1]);
            else { if (cur) out.push((cur[0] + cur[1]) / 2); cur = [sp[0], sp[1]]; }
          }
          if (cur) out.push((cur[0] + cur[1]) / 2);
          return out;
        };
        for (const mid of middles(uprights.filter((b) => !onTheEnds(b)).map((b) => [b.t0, b.t1]))) { const m = mid - t0; if (m > 0.02 && m < L - 0.02 && !near(along, m)) along.push(m); }
        for (const mid of middles(rails.filter((b) => !onTheEdges(b)).map((b) => [b.z0, b.z1]))) { const m = mid - z0; if (m > 0.02 && m < H - 0.02 && !near(up, m)) up.push(m); }
        // (And where two panels meet with no bar between — Savoyvilla's 0i2T…, a 20 cm strip of panel on top of the glass: a line
        // there all the same, its stretches with no bar taken out below.)
        for (const p of plates) for (const q of plates) {
          if (p === q) continue;
          if (Math.abs(q.b.z0 - p.b.z1) < 0.06 && Math.min(p.b.t1, q.b.t1) - Math.max(p.b.t0, q.b.t0) > 0.05) { const m = (p.b.z1 + q.b.z0) / 2 - z0; if (m > 0.02 && m < H - 0.02 && !near(up, m)) up.push(m); }
          if (Math.abs(q.b.t0 - p.b.t1) < 0.06 && Math.min(p.b.z1, q.b.z1) - Math.max(p.b.z0, q.b.z0) > 0.05) { const m = (p.b.t1 + q.b.t0) / 2 - t0; if (m > 0.02 && m < L - 0.02 && !near(along, m)) along.push(m); }
        }
        along.sort((x, y) => x - y); up.sort((x, y) => x - y);
        // 🔴 NO CELL NARROWER THAN A BAR (a client's model 13-11: two lines 20–25 mm apart — a double upright, a panel joint by a bar — and the modelling tool
        // refused the whole building): lines nearer than that to each other made one, at their middle; one that near an end, gone.
        const tidy = (v: number[], end: number, least: number) => {
          const out: number[] = [];
          for (const x of v) {
            if (x < least || x > end - least) continue;
            if (out.length && x - out[out.length - 1]! < least) out[out.length - 1] = (out[out.length - 1]! + x) / 2;
            else out.push(x);
          }
          return out;
        };
        const leastCell = Math.max(0.03, 0.5 * Math.max(wU, wR)); // (Half a bar: at a bar and more, Snowdon's storefront lines 64 mm apart, a door's jamb by its upright, came one — 13-11.)
        along.splice(0, along.length, ...tidy(along, L, leastCell));
        up.splice(0, up.length, ...tidy(up, H, leastCell));
        const A = [0, ...along, L], U = [0, ...up, H];
        const omit: { horizontal: boolean; at: number; from: number }[] = [];
        const merge: { horizontal: boolean; at: number; from: number }[] = [];
        // Each stretch of each line, borders too: a bar on it, or it is taken out (two panels one, where one spans it).
        for (let i = 0; i < A.length; i++) for (let j = 0; j + 1 < U.length; j++) {
          const a = A[i], mid = z0 + (U[j] + U[j + 1]) / 2;
          if (uprights.some((b) => Math.abs((b.t0 + b.t1) / 2 - t0 - a) < Math.max(0.02, wU) && b.z0 <= mid && b.z1 >= mid)) continue;
          const spans = i > 0 && i < A.length - 1 && plates.some((x) => x.b.t0 < t0 + a - 0.05 && x.b.t1 > t0 + a + 0.05 && x.b.z0 <= mid && x.b.z1 >= mid);
          (spans ? merge : omit).push({ horizontal: false, at: a * s, from: U[j] * s });
        }
        for (let j = 0; j < U.length; j++) for (let i = 0; i + 1 < A.length; i++) {
          const u = U[j], mid = t0 + (A[i] + A[i + 1]) / 2;
          if (rails.some((b) => Math.abs((b.z0 + b.z1) / 2 - z0 - u) < Math.max(0.02, wR) && b.t0 <= mid && b.t1 >= mid)) continue;
          const spans = j > 0 && j < U.length - 1 && plates.some((x) => x.b.z0 < z0 + u - 0.05 && x.b.z1 > z0 + u + 0.05 && x.b.t0 <= mid && x.b.t1 >= mid);
          (spans ? merge : omit).push({ horizontal: true, at: u * s, from: A[i] * s });
        }
        const noBorders = !atStart && !atEnd && !atBottom && !atTop;
        // 🔴 ITS BARS OF ANOTHER SECTION (Snowdon's storefronts 13-11: a 4" x 6¼" sill and 2½" x 6¼" uprights among 2½" x 5" ones, all
        // made the type's one bar, 151 pieces 3 cm off): each by its middle on the wall (along, up from its foot), and its section.
        const usualW = wU || wR;
        const barsOfTheirOwn = bars.flatMap((b) => {
          const w = flat(b) ? b.z1 - b.z0 : b.t1 - b.t0, dp = b.a1 - b.a0;
          if (Math.abs(w - usualW) < 0.003 && Math.abs(dp - depth) < 0.003) return [];
          if (flat(b) && (b as { rise?: number }).rise! > 0.005) return [];
          return [{ horizontal: flat(b), along: ((b.t0 + b.t1) / 2 - t0) * s, up: ((b.z0 + b.z1) / 2 - z0) * s, width: w * s, depth: dp * s }];
        });
        // A cell no panel is in (a door's, or nothing) left empty; a panel that is no plain sheet made as its shape there.
        const shapedHere = new Set(shapedPanelsOf(shapes, cw.gid, depth || 0.02, nrm).map((p) => p.gid));
        const empty: { along: number; up: number }[] = [];
        // (A cell its panels fill only in part is no rectangle's: a stepped or sloped wall — Savoyvilla's glass under its
        // ramp — kept as its pieces until its outline is given, rather than lose the panels a full cell would hide.)
        let partial = false;
        for (let i = 0; i + 1 < A.length; i++) for (let j = 0; j + 1 < U.length; j++) {
          const ca0 = t0 + A[i], ca1 = t0 + A[i + 1], cz0 = z0 + U[j], cz1 = z0 + U[j + 1];
          const area = (ca1 - ca0) * (cz1 - cz0);
          // (By its panels and its bars both: a full cell is all of it, a stepped top leaves a strip — Savoyvilla's 0i2T…, 18 cm.)
          const covered = Math.min(area, boxes.reduce((sum, b) => sum + Math.max(0, Math.min(ca1, b.t1) - Math.max(ca0, b.t0)) * Math.max(0, Math.min(cz1, b.z1) - Math.max(cz0, b.z0)), 0));
          if (area > 0 && covered > 0.15 * area && covered < 0.95 * area) partial = true;
        }
        // …or, where its pieces' union is one outline, its outline edited to it (the modelling tool's «Edit Profile»): the panels then cut
        // to it as the file's are.
        let outline: number[][] | null = null;
        if (partial) {
          outline = outlineOfBoxes(boxes.map((b) => [b.t0, b.z0, b.t1, b.z1]));
          if (!outline) { if (env.RECIPE_TRACE) console.error(`[curtain-pieces] ${cw.gid}: a cell filled in part and no one outline, kept as its pieces`); continue; }
          // 🔴 ITS CORNERS ON ITS LINES, NOT A HAIR BESIDE THEM (a client's model 13-11: corners 0.4–5 mm from a grid line, a sliver of panel
          // there, «no es posible crear un panel de muro cortina» at the commit, and the whole building rolled back): a corner within
          // a centimetre of a line or an end taken onto it.
          // (Within 10 mm only: taken from 30 mm, Snowdon's stair glazing came with a cell of no area and the modelling tool refused it — 13-11.)
          const onto = (v: number, marks: number[]) => { for (const m of marks) if (Math.abs(v - m) < 0.01) return m; return v; };
          const tMarks = [t0, t1, ...along.map((x) => t0 + x)], zMarks = [z0, z1, ...up.map((x) => z0 + x)];
          outline = outline.map(([t, zz]) => [onto(t, tMarks), onto(zz, zMarks)]);
          outline = outline.filter((q, i) => { const r = outline![(i + outline!.length - 1) % outline!.length]!; return Math.abs(q[0]! - r[0]!) > 1e-6 || Math.abs(q[1]! - r[1]!) > 1e-6; });
        }
        for (let i = 0; i + 1 < A.length; i++) for (let j = 0; j + 1 < U.length; j++) {
          const ct = t0 + (A[i] + A[i + 1]) / 2, cz = z0 + (U[j] + U[j + 1]) / 2;
          const inIt = plates.filter((x) => x.b.t0 <= ct && x.b.t1 >= ct && x.b.z0 <= cz && x.b.z1 >= cz);
          const some = plates.some((x) => x.b.t0 < t0 + A[i + 1] - 0.01 && x.b.t1 > t0 + A[i] + 0.01 && x.b.z0 < z0 + U[j + 1] - 0.01 && x.b.z1 > z0 + U[j] + 0.01 && !shapedHere.has(x.gid));
          if (outline ? !some : !inIt.length || inIt.every((x) => shapedHere.has(x.gid))) empty.push({ along: A[i] * s, up: U[j] * s });
        }
        for (const g of shapedHere) shapedPanels.add(g);
        for (const g of strays) shapedPanels.add(g);
        const glass = med(plates.filter((x) => !shapedHere.has(x.gid)).map((x) => x.b.a1 - x.b.a0).filter((t) => t > 0.002 && t < 0.2));
        const glassA = med(plates.filter((x) => !shapedHere.has(x.gid)).map((x) => (x.b.a0 + x.b.a1) / 2));
        const level = [...levelList].reverse().find((l) => l.at <= z0 + 0.001) ?? levelList[0];
        if (!level) continue;
        const f = [mx + d[0] * t0 + nrm[0] * lineA, my + d[1] * t0 + nrm[1] * lineA];
        const e = [mx + d[0] * t1 + nrm[0] * lineA, my + d[1] * t1 + nrm[1] * lineA];
        const z = z0 * s;
        const named = nativeOf({ item: { attrs: { Name: cw.name ?? (/^IFCMEMBER$/i.test(barKids[0]?.ifcClass ?? '') ? barKids[0].name ?? '' : '') } } });
        const attrs: Record<string, string> = {
          CategoryId: CATEGORY.walls,
          Type: named?.type ?? cw.typeName ?? 'Curtain wall',
          LocationLine: `${num(f[0] * s)},${num(f[1] * s)},${num(z)};${num(e[0] * s)},${num(e[1] * s)},${num(z)}`,
          Level: level.name,
          BaseOffset: num((z0 - level.at) * s),
          Height: num(H * s),
          Curtain: JSON.stringify({
            along: along.map((a) => a * s),
            up: up.map((u) => u * s),
            omit: noBorders ? omit.filter((o) => o.at > 1e-6 && Math.abs(o.at - (o.horizontal ? H : L) * s) > 1e-6) : omit,
            ...(merge.length ? { merge } : {}),
            empty,
            ...(noBorders ? { noBorders: true } : {}),
            ...(barsOfTheirOwn.length ? { bars: barsOfTheirOwn } : {}),
            mullion: { width: (wU || wR) * s, depth: (depth || glass) * s },
            panel: { thickness: (glass || 0.02) * s, offset: (env.RECIPE_CW_OFFSET_SIGN === '-1' ? -1 : 1) * (glassA - lineA) * s },
          }),
        };
        {
          const c = JSON.parse(attrs.Curtain) as { mullion: { width: number; depth: number }; panel?: { thickness?: number }; noBorders?: boolean };
          const sig = `${Math.round((c.mullion.width / s) * 1000)} x ${Math.round((c.mullion.depth / s) * 1000)}${c.panel?.thickness ? `, ${Math.round((c.panel.thickness / s) * 1000)} mm glass` : ''}${c.noBorders ? ', no borders' : ''}`;
          const seenSig = curtainTypeMullions.get(attrs.Type);
          if (seenSig === undefined) curtainTypeMullions.set(attrs.Type, sig);
          else if (seenSig !== sig) attrs.Type = `${attrs.Type} · ${sig}`;
        }
        if (outline) attrs.Profile = JSON.stringify([outline.flatMap(([t, zz]) => [(mx + d[0] * t + nrm[0] * lineA) * s, (my + d[1] * t + nrm[1] * lineA) * s, zz * s])]);
        if (env.RECIPE_CW_DEBUG && cw.gid.includes(env.RECIPE_CW_DEBUG)) console.error(`[cw-debug] t0 ${t0.toFixed(3)} z0 ${z0.toFixed(3)} L ${L.toFixed(3)} H ${H.toFixed(3)}
  plates ${plates.map((x) => `${(x.b.t0 - t0).toFixed(2)}..${(x.b.t1 - t0).toFixed(2)}/${(x.b.z0 - z0).toFixed(2)}..${(x.b.z1 - z0).toFixed(2)}`).join(' ')}
  uprights ${uprights.map((b) => `${(b.t0 - t0).toFixed(2)}..${(b.t1 - t0).toFixed(2)}/${(b.z0 - z0).toFixed(2)}..${(b.z1 - z0).toFixed(2)}`).join(' ')}
  rails ${rails.map((b) => `${(b.t0 - t0).toFixed(2)}..${(b.t1 - t0).toFixed(2)}/${(b.z0 - z0).toFixed(2)}..${(b.z1 - z0).toFixed(2)}`).join(' ')}`);
        if (env.RECIPE_TRACE) console.error(`[curtain-pieces] ${cw.gid}: ${(L).toFixed(2)} x ${H.toFixed(2)} m, ${along.length} + ${up.length} lines, ${omit.length} out, ${merge.length} merged, ${empty.length} empty (${shapedHere.size} shaped), bars ${(wU * 1000).toFixed(0)}/${(wR * 1000).toFixed(0)} x ${(depth * 1000).toFixed(0)} mm, glass ${(glass * 1000).toFixed(0)} mm off ${((glassA - lineA) * 1000).toFixed(0)} mm`);
        if (add(`${picked.fileId}:${cw.gid}:curtainPieces`, attrs)) curtainCount++;
        curtainRead++;
      }
    }

    // ---- 2c. Stairs: the modelling tool's own, one run each - straight, or sketched where the record has
    // its sketch (winders). Its family is the one its name starts with (assembled, precast,
    // cast in place), its risers as many as its rise needs at its type's riser at most.

    let stairCount = 0;
    let stairRead = 0;
    /**
     * 🔴 A STAIR OF SEVERAL FLIGHTS IS ONE STAIR (rac_advanced 12-11: each IfcStair two flights and a landing slab, made as two stairs
     * and the landing a loose shape — its landings named «…:1», not «… Landing 1»): the flights the file puts in one IfcStair, one
     * the modelling tool stair of as many runs, its landings the slabs in it.
     */
    const stairOfFlight = (gid: string | undefined) => {
      const parent = gid && shapes ? shapes.elements.get(gid)?.parent : null;
      // (The IfcStair has no body of its own, so no shape: a flight's parent with none, or an IfcStair.)
      if (!parent || !shapes) return null;
      const of = shapes.elements.get(parent);
      return !of || /^IFCSTAIR$/i.test(of.ifcClass) ? parent : null;
    };
    const flightsOf = new Map<string, number>();
    for (const record of records) if (record.kind === 'stair' && record.params.of === 'stair') { const st = stairOfFlight(record.item.guid ?? undefined); if (st) flightsOf.set(st, (flightsOf.get(st) ?? 0) + 1); }
    const stairGroups = new Map<string, { record: (typeof records)[number]; spec: Record<string, unknown>; level: string; type: string }[]>();
    // 🔴 ITS WIDTH OFF ITS SHAPE, when its style says none (Conference Center 24-10: the grand stair's two runs came
    // with width 0, «Curve length is too small for the modelling tool's tolerance», not made): the span of its own shape and its
    // flights' across its path.
    const widthOfStair = (gid: string | undefined, start: number[], end: number[]): number | null => {
      if (!shapes || !gid) return null;
      const L = Math.hypot(end[0] - start[0], end[1] - start[1]);
      if (!(L > 0)) return null;
      const across = [-(end[1] - start[1]) / L, (end[0] - start[0]) / L];
      const pts = [gid, ...[...shapes.elements.values()].filter((el) => el.parent === gid).map((el) => el.gid)].flatMap((g) => shapePoints(shapes, g));
      if (pts.length < 4) return null;
      const t = pts.map((q) => (q[0] - start[0]) * across[0] + (q[1] - start[1]) * across[1]);
      const w = Math.max(...t) - Math.min(...t);
      return w > 0.3 && w < 10 ? w : null;
    };
    for (const record of records) {
      if (record.kind !== 'stair' || record.params.of !== 'stair') continue;
      stairRead++;
      const body = innerJson<{
        start?: [number, number, number]; end?: [number, number, number]; rise?: number; level?: string;
        sketch?: { boundary?: [number, number][]; risers?: [[number, number], [number, number]][] };
      }>(record, 'stair');
      const lookRef = record.params.lookRef;
      const style = typeof lookRef === 'string' ? styles.get(lookRef)?.params : undefined;
      const level = levels.get(String(body?.level ?? record.params.level ?? ''));
      if (!body?.start || !body.end || !(Number(body.rise) > 0) || !level || !style) continue;
      const n = (v: unknown) => (typeof v === 'number' ? v : Number(v) || 0);
      const rise = Number(body.rise);
      // (A style with no maximum riser: as many as the sketch draws, else the modelling tool's 18 cm. a client's model 24-10: rise / 0, an
      // Infinity that went as null, «could not be converted to Int32», a stair of nothing.)
      const maxRiser = n(style.maxRiser) > 0 ? n(style.maxRiser) : body.sketch?.risers?.length ? rise / (body.sketch.risers.length + 1) : 0.18;
      const risers = Math.max(1, Math.ceil(rise / maxRiser - 1e-6));
      const tread = n(style.tread);
      const p = (q: [number, number]) => [q[0] * s, q[1] * s];
      // 🔴 A FLIGHT THAT STARTS A RISER UNDER ITS RECORD'S BASE (#45, GNI model_193: «Cast-In-Place Stair» second runs, the
      // record's base at the top of the run below — the landing's step counted twice — its shape from a riser lower): its
      // base where its shape starts, and its straight path's start a tread back (lowered alone, r67, its treads came a going
      // off; with it, r68, their error 0.215 → 0.14 m; a tread forward, r69, lost flights).
      let baseAt = level.at + n(record.params.base);
      let lowered = false;
      if (shapes && record.item.guid) {
        const zs = shapePoints(shapes, record.item.guid).map((q) => q[2] - shapeDz), r = rise / risers;
        const low = zs.length ? Math.min(...zs) : baseAt;
        if (baseAt - low > 0.5 * r && baseAt - low < 1.5 * r) {
          if (typeof process !== 'undefined' && process.env?.RECIPE_TRACE) console.error(`[stair-base] ${record.item.guid} ${record.item.name ?? ''}: base ${baseAt.toFixed(3)} → its shape's ${low.toFixed(3)}`);
          baseAt = low;
          lowered = true;
        }
      }
      const spec: Record<string, unknown> = {
        // (Its family, the element's number off its end: the first of «Assembled Stair:Stair», the second of «Stairs : Assembled Stair : Stair», as GNI model_78
        // and 45 name them: read as «Stairs», no family, its default cast in place, 1.35 m³ for 0.18.)
        family: (() => { const parts = String(lookRef).split(':').map((one) => one.trim()).filter((one, k, all) => k < all.length - 1 || !/^\d+$/.test(one)); return parts.length >= 3 && /^(stairs?|escaleras?|treppen?)$/i.test(parts[0]) ? parts[1] : parts[0]; })(),
        base: baseAt * s,
        height: rise * s,
        risers,
        tread: tread * s,
        width: (n(style.width) > 0 ? n(style.width) : widthOfStair(record.item.guid ?? undefined, body.start, body.end) ?? 0) * s,
        // 🔴 ENDING ON A RISER, when its own shape stops a riser under its rise (DACH 24-10: two flights and a landing,
        // the first a tread too long and a riser too high — the landing is that tread).
        endsWithRiser: (() => {
          if (!shapes || !record.item.guid) return false;
          const pts = shapePoints(shapes, record.item.guid);
          if (pts.length < 4) return false;
          const top = Math.max(...pts.map((q) => q[2])) - shapeDz, full = level.at + n(record.params.base) + rise;
          return full - top > 0.5 * (rise / risers) && full - top < 1.5 * (rise / risers);
        })(),
        // Its type's sizes, as the style has them: the modelling tool keeps the risers under the type's
        // maximum (racbasic: a 180 mm template type gave a 3.0 m stair a riser more, 3.22 m).
        sizes: {
          maxRiser: Math.ceil((rise / risers) * 1000 - 1e-6) / 1000 * s,
          minTread: tread * s,
          waist: n(style.waist) * s,
          // (Of an assembled flight only: a cast one is its stepped profile and its waist, no tread nor riser on it —
          // GNI model_156 r55, the contract's 50 / 25 mm defaults on «Monolithic Run» flights, each run 6 cm deep under.)
          treadThickness: style.construction === 'assembled' ? n(style.treadThickness) * s : 0,
          riserThickness: style.construction === 'assembled' ? n(style.riserThickness) * s : 0,
          notchExtension: n(style.notchExtension) * s,
          notchThickness: n(style.notchThickness) * s,
          // (Its nosing, where the style says: the modelling tool's template keeps 20 mm, GNI model_54's treads 2 cm off, 25-10.)
          ...(style.nosing !== undefined && Number.isFinite(Number(style.nosing)) ? { nosing: Number(style.nosing) * s } : {}),
        },
      };
      if (typeof process !== 'undefined' && process.env?.RECIPE_TRACE) console.error(`[stair-end] ${record.item.guid} ${record.item.name ?? ''}: ${risers} risers, ends with riser ${spec.endsWithRiser}`);
      const sketch = body.sketch;
      // 🔴 A RISER LINE TWICE, and the run's first edge none (GNI model_89 25-10: «Assembled Stair», its second riser line
      // also given first, a walk with a step of 0 mm, «actualTreadDepth must be greater than 0», 3 stairs missing): the
      // repeats go, and a first riser that is no edge of its outline is preceded by the outline's edge parallel to it on
      // the side away from the next.
      if (sketch?.boundary && sketch.risers && sketch.risers.length >= 2) {
        const m2 = (q: [number, number][]) => [(q[0][0] + q[1][0]) / 2, (q[0][1] + q[1][1]) / 2];
        const kept = sketch.risers.filter((r, k, all) => k === 0 || Math.hypot(m2(r)[0] - m2(all[k - 1])[0], m2(r)[1] - m2(all[k - 1])[1]) > 0.01);
        const close = (u: [number, number], v: [number, number]) => Math.hypot(u[0] - v[0], u[1] - v[1]) < 0.01;
        const bd = sketch.boundary;
        const isEdge = (r: [number, number][]) => bd.some((q, k) => { const w = bd[(k + 1) % bd.length]; return (close(q, r[0]) && close(w, r[1])) || (close(q, r[1]) && close(w, r[0])); });
        if (kept.length >= 2 && !isEdge(kept[0])) {
          const [r0, r1] = [kept[0], kept[1]], d = [r0[1][0] - r0[0][0], r0[1][1] - r0[0][1]], dl = Math.hypot(d[0], d[1]);
          const n0 = m2(r0), n1 = m2(r1), away = [n0[0] - n1[0], n0[1] - n1[1]];
          let pick: [[number, number], [number, number]] | null = null, nearest = Infinity;
          for (let k = 0; k < bd.length; k++) {
            const q = bd[k], w = bd[(k + 1) % bd.length], e = [w[0] - q[0], w[1] - q[1]], el = Math.hypot(e[0], e[1]);
            if (!(el > 0) || Math.abs((e[0] * d[1] - e[1] * d[0]) / (el * dl)) > 0.02) continue;
            const m = m2([q, w]), off = (m[0] - n0[0]) * away[0] + (m[1] - n0[1]) * away[1];
            if (off > 1e-4 && off < nearest) { nearest = off; pick = [q, w]; }
          }
          if (pick) kept.unshift(pick);
        }
        if (kept.length !== sketch.risers.length && typeof process !== 'undefined' && process.env?.RECIPE_TRACE) console.error(`[stair-sketch] ${record.item.guid}: riser lines ${sketch.risers.length} → ${kept.length}`);
        sketch.risers = kept as [[number, number], [number, number]][];
      }
      if (sketch?.boundary && sketch.boundary.length >= 4 && sketch.risers && sketch.risers.length >= 2) {
        // The outline: its first edge is the first riser; the edge opposite, one tread past the
        // last riser, is the run's end; the edges between are its two sides.
        // (Turned to start at the edge that IS the first riser: DACH's sketched runs start at a side, so their «sides»
        // were the first riser and the end, «stairs require at least two boundaries», 3 not made, 24-10.)
        const first = sketch.risers[0];
        const near = (u: [number, number], v: [number, number]) => Math.hypot(u[0] - v[0], u[1] - v[1]) < 0.01;
        const at = sketch.boundary.findIndex((q, k, all) => {
          const r = all[(k + 1) % all.length];
          return (near(q, first[0]) && near(r, first[1])) || (near(q, first[1]) && near(r, first[0]));
        });
        const b = at > 0 ? [...sketch.boundary.slice(at), ...sketch.boundary.slice(0, at)] : sketch.boundary;
        if (typeof process !== "undefined" && process.env?.RECIPE_STAIR === record.item.guid) console.error(`[stair-sketch] boundary ${JSON.stringify(b)} (turned by ${at}) risers ${JSON.stringify(sketch.risers)} tread ${tread}`);
        const last = sketch.risers[sketch.risers.length - 1];
        const mid = (q: [number, number][]) => [(q[0][0] + q[1][0]) / 2, (q[0][1] + q[1][1]) / 2];
        const lm = mid(last);
        let endEdge = 1, best = Infinity;
        for (let k = 1; k < b.length; k++) {
          const m = mid([b[k], b[(k + 1) % b.length]]);
          const d = Math.abs(Math.hypot(m[0] - lm[0], m[1] - lm[1]) - tread);
          if (d < best) { best = d; endEdge = k; }
        }
        // (Better, the edge parallel to the last riser that lies farthest past it: a style's tread is not the run's
        // last one, DACH's two-riser run, 0.81 m in its style, took a side for its end, 24-10.)
        {
          const ld = [last[1][0] - last[0][0], last[1][1] - last[0][1]], ll = Math.hypot(ld[0], ld[1]);
          const fm = mid(sketch.risers[0]);
          let far = -Infinity, pick = -1;
          for (let k = 1; k < b.length; k++) {
            const e = [b[(k + 1) % b.length][0] - b[k][0], b[(k + 1) % b.length][1] - b[k][1]], el = Math.hypot(e[0], e[1]);
            if (!(el > 0) || Math.abs((e[0] * ld[1] - e[1] * ld[0]) / (el * ll)) > 0.06) continue; // (about 3°: DACH's end edge is 1.7° off its riser)
            const m = mid([b[k], b[(k + 1) % b.length]]);
            const dist = Math.hypot(m[0] - fm[0], m[1] - fm[1]);
            if (dist > far + 1e-6) { far = dist; pick = k; }
          }
          if (pick > 0) endEdge = pick;
        }
        const chain = (from: number, to: number) => {
          const out: number[][][] = [];
          for (let k = from; k !== to; k = (k + 1) % b.length) out.push([p(b[k]), p(b[(k + 1) % b.length])]);
          return out;
        };
        const sides = [...chain(1, endEdge), ...chain((endEdge + 1) % b.length, 0)];
        if (typeof process !== "undefined" && process.env?.RECIPE_STAIR === record.item.guid) console.error(`[stair-sketch] end edge ${endEdge} of ${b.length}`);
        // the modelling tool counts every riser line as a riser: the end edge is not one (the run ends on a
        // tread), so it goes as the walk line's end only (measured: with it, 17 risers, 3.19 m).
        const riserLines = sketch.risers.map(([a, c]) => [p(a), p(c)]);
        const endLine = [p(b[endEdge]), p(b[(endEdge + 1) % b.length])];
        // The walk line: through every riser's middle, first to last - the modelling tool refuses one that goes
        // on past the last riser ("the path must connect the start and end riser lines").
        void endLine;
        const walk = riserLines.map(([a, c]) => [(a[0] + c[0]) / 2, (a[1] + c[1]) / 2]);
        spec.sketch = { boundary: sides, risers: riserLines, path: walk };
        // (Should the modelling tool refuse the sketch: straight from its first riser to its last, as wide as its first.)
        spec.path = [walk[0], walk[walk.length - 1]];
        if (!spec.width) spec.width = Math.hypot(riserLines[0][1][0] - riserLines[0][0][0], riserLines[0][1][1] - riserLines[0][0][1]);
        if (typeof process !== 'undefined' && process.env?.RECIPE_TRACE) {
          const len = (q: number[][]) => Math.hypot(q[1][0] - q[0][0], q[1][1] - q[0][1]) / s;
          console.error(`[stair] ${record.item.guid} ${record.item.name ?? ''}: ${sides.length} sides (shortest ${(Math.min(...sides.map(len)) * 1000).toFixed(2)} mm), ${riserLines.length} risers (shortest ${(Math.min(...riserLines.map(len)) * 1000).toFixed(2)} mm), walk ${walk.length} points (shortest step ${(Math.min(...walk.slice(1).map((q, k) => len([walk[k], q]))) * 1000).toFixed(2)} mm)`);
        }
        // Its going is what the riser lines say, the shortest between two in a row that are
        // parallel; the style's (racbasic: 0.375 against the modelling tool's 0.25) is the winders' too.
        let going = Infinity;
        for (let k = 0; k + 1 < sketch.risers.length; k++) {
          const [a1, a2] = sketch.risers[k], [b1, b2] = sketch.risers[k + 1];
          const d1 = [a2[0] - a1[0], a2[1] - a1[1]], d2 = [b2[0] - b1[0], b2[1] - b1[1]];
          const l1 = Math.hypot(d1[0], d1[1]), l2 = Math.hypot(d2[0], d2[1]);
          if (Math.abs((d1[0] * d2[1] - d1[1] * d2[0]) / (l1 * l2)) > 1e-3) continue;
          going = Math.min(going, Math.abs(((b1[0] - a1[0]) * d1[1] - (b1[1] - a1[1]) * d1[0]) / l1));
        }
        if (Number.isFinite(going)) {
          spec.tread = going * s;
          (spec.sizes as Record<string, number>).minTread = going * s;
          // (Its straight path, should it be used, a tread back when lowered a riser, as a straight flight's: model_128 r76.)
          if (lowered) {
            const q = spec.path as number[][], L = Math.hypot(q[1][0] - q[0][0], q[1][1] - q[0][1]);
            if (L > 0) spec.path = [[q[0][0] - ((q[1][0] - q[0][0]) / L) * going * s, q[0][1] - ((q[1][1] - q[0][1]) / L) * going * s], q[1]];
          }
        }
      } else {
        // (Lowered a riser, its start a tread back along its path.)
        let from: [number, number] = [body.start[0], body.start[1]];
        if (lowered && tread > 0) {
          const dx = body.end[0] - body.start[0], dy = body.end[1] - body.start[1], L = Math.hypot(dx, dy);
          if (L > 0) from = [from[0] - (tread * dx) / L, from[1] - (tread * dy) / L];
        }
        spec.path = [p(from), p([body.end[0], body.end[1]])];
        // (A style with no tread: its path by its risers. Conference's grand stair, «7" max riser 11" tread», came
        // with tread 0, its riser lines on one another, «curve too short»: 5.588 m / 20 = 0.2794 m, its 11".)
        if (!(tread > 0)) {
          const going = Math.hypot(body.end[0] - body.start[0], body.end[1] - body.start[1]) / risers;
          spec.tread = going * s;
          (spec.sizes as Record<string, number>).minTread = going * s;
        }
        if (typeof process !== 'undefined' && process.env?.RECIPE_TRACE) console.error(`[stair] ${record.item.guid} ${record.item.name ?? ''}: straight, ${Math.hypot(body.end[0] - body.start[0], body.end[1] - body.start[1]).toFixed(3)} m, rise ${rise}, ${risers} risers, width ${n(style.width)}, measured ${widthOfStair(record.item.guid ?? undefined, body.start, body.end)}`);
      }
      // ITS LANDINGS: the slabs the file names after this stair ("…:725045 Landing 1" for
      // "…:725045 Run 1"). The converter has each as its cross-section on a vertical plane pushed
      // its depth (its type's thickness): in plan, the section's span across by that depth, on the
      // side the run is; its top is the section's top.
      const stairName = String(record.item.attrs.Name ?? '');
      const stem = stairName.replace(/ Run \d+$/, '');
      const landings: Record<string, unknown>[] = [];
      for (const slab of records) {
        if (slab.kind !== 'extrusion' || stem === stairName) continue;
        if (!new RegExp(`^${stem.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')} Landing \\d+$`).test(String(slab.item.attrs.Name ?? ''))) continue;
        const sb = innerJson<ExtrusionBody & { on?: { origin?: number[]; u?: number[]; v?: number[] } }>(slab, 'extrusion');
        const on = sb?.on;
        const pts = (sb?.profile?.outline?.curves ?? []).flatMap((c) => (c.from ? [c.from] : []));
        const depth = thicknessOf(slab.params.lookRef);
        const slabLevel = levels.get(String(sb?.level ?? slab.params.level ?? ''));
        if (!on?.origin || !on.u || !on.v || Math.abs(on.v[2] ?? 0) < 0.99 || !pts.length || !depth || !slabLevel) continue;
        const [a0, a1] = [Math.min(...pts.map((q) => q[0])), Math.max(...pts.map((q) => q[0]))];
        const [v0, v1] = [Math.min(...pts.map((q) => q[1])), Math.max(...pts.map((q) => q[1]))];
        const O = on.origin, u = on.u;
        let nrm = [u[1], -u[0]];
        const mid = [(body.start[0] + body.end[0]) / 2, (body.start[1] + body.end[1]) / 2];
        const across = (mid[0] - O[0]) * nrm[0] + (mid[1] - O[1]) * nrm[1];
        if (across < 0) nrm = [-nrm[0], -nrm[1]];
        const D = depth / s;
        const corner = (a: number, b: number) => [(O[0] + u[0] * a + nrm[0] * b) * s, (O[1] + u[1] * a + nrm[1] * b) * s];
        landings.push({
          outline: [corner(a0, 0), corner(a1, 0), corner(a1, D), corner(a0, D)],
          top: (slabLevel.at + n(slab.params.base) + O[2] + v1) * s,
          thickness: (v1 - v0) * s,
        });
      }
      if (landings.length) spec.landings = landings;
      const attrs: Record<string, string> = {
        CategoryId: CATEGORY.stairs,
        Type: nativeOf(record)?.type ?? String(lookRef),
        Level: level.name,
        Stairs: JSON.stringify(spec),
      };
      if (typeof process !== 'undefined' && (process.env?.RECIPE_STAIR === record.item.guid || process.env?.RECIPE_STAIR === "*")) console.error(`[stair-spec] ${attrs.Stairs} style ${JSON.stringify(style)}`);
      const ofStair = stairOfFlight(record.item.guid ?? undefined);
      if (ofStair && (flightsOf.get(ofStair) ?? 0) > 1) {
        if (!stairGroups.has(ofStair)) stairGroups.set(ofStair, []);
        stairGroups.get(ofStair)!.push({ record, spec, level: level.name, type: attrs.Type });
        continue;
      }
      if (add(key(record.id), attrs)) stairCount++;
    }
    for (const [stairGid, flights] of stairGroups) {
      const runs = flights.map((f) => f.spec).sort((a, b) => Number(a.base) - Number(b.base));
      const base = Number(runs[0].base), top = Math.max(...runs.map((r) => Number(r.base) + Number(r.height)));
      // Its landings: the slabs in it, each by its box in plan, its top and how thick it is.
      const landings = shapes ? [...shapes.elements.values()].filter((el) => el.parent === stairGid && /^IFCSLAB/i.test(el.ifcClass)).flatMap((el) => {
        const q = shapePoints(shapes, el.gid);
        if (q.length < 4) return [];
        const [x0, x1, y0, y1] = [Math.min(...q.map((v) => v[0])), Math.max(...q.map((v) => v[0])), Math.min(...q.map((v) => v[1])), Math.max(...q.map((v) => v[1]))];
        const [z0, z1] = [Math.min(...q.map((v) => v[2])) - shapeDz, Math.max(...q.map((v) => v[2])) - shapeDz];
        return [{ outline: [[x0 * s, y0 * s], [x1 * s, y0 * s], [x1 * s, y1 * s], [x0 * s, y1 * s]], top: z1 * s, thickness: (z1 - z0) * s }];
      }) : [];
      // 🔴 ITS STRINGERS, THE MEMBERS IN IT (rac_advanced 12-11: its 36 «Stringer - Paint - 50 mm Width» lost, the stair 10 cm narrow):
      // the members the file puts in the stair are its side stringers — as wide as they stand out past its flights, as deep as
      // the thinnest stretch of them (a landing's, level) is tall.
      const partsOf = (re: RegExp) => (shapes ? [...shapes.elements.values()].filter((el) => el.parent === stairGid && re.test(el.ifcClass)) : []);
      const box = (els: { gid: string }[]) => {
        const q = els.flatMap((el) => shapePoints(shapes!, el.gid));
        return q.length ? [Math.min(...q.map((v) => v[0])), Math.max(...q.map((v) => v[0])), Math.min(...q.map((v) => v[1])), Math.max(...q.map((v) => v[1]))] : null;
      };
      const members = partsOf(/^IFCMEMBER/i);
      let stringers: { width: number; depth: number } | null = null;
      if (members.length) {
        const fb = box(partsOf(/^IFCSTAIRFLIGHT/i)), mb = box(members);
        const out = fb && mb ? [fb[0] - mb[0], mb[1] - fb[1], fb[2] - mb[2], mb[3] - fb[3]].filter((d) => d > 0.005) : [];
        const tall: number[] = [];
        for (const el of members) {
          const at = new Map<string, number[]>();
          for (const v of shapePoints(shapes!, el.gid)) { const k = `${Math.round(v[0] / 0.02)}|${Math.round(v[1] / 0.02)}`; const z = at.get(k) ?? [Infinity, -Infinity]; at.set(k, [Math.min(z[0], v[2]), Math.max(z[1], v[2])]); }
          for (const [z0, z1] of at.values()) if (z1 - z0 > 0.05) tall.push(z1 - z0);
        }
        // (Its depth across its slope: the tallest it stands, along its flights, times the cosine of their pitch — a cut end
        // is lower; a level stretch, at its own depth, is no taller than the sloped one so measured.)
        const byCm = new Map<number, number>(); for (const t of tall) { const k = Math.round(t * 100); byCm.set(k, (byCm.get(k) ?? 0) + 1); }
        const r0 = runs[0] as { tread?: number; height?: number; risers?: number };
        const pitch = r0.tread && r0.height && r0.risers ? Math.atan(r0.height / r0.risers / r0.tread) : 0;
        // Each member across its pitch, along its longer side in plan: the spread of its points square to its slope; a level
        // one (a landing's), its height. The thinnest is the stringer's depth.
        const across = members.map((el) => {
          const q = shapePoints(shapes!, el.gid);
          if (q.length < 4) return Infinity;
          const dx = Math.max(...q.map((v) => v[0])) - Math.min(...q.map((v) => v[0])), dy = Math.max(...q.map((v) => v[1])) - Math.min(...q.map((v) => v[1]));
          const along = q.map((v) => (dx >= dy ? v[0] : v[1]));
          const zs = q.map((v) => v[2]);
          const spread = (a: number) => { const t = q.map((_, k) => -Math.sin(a) * along[k] + Math.cos(a) * zs[k]); return Math.max(...t) - Math.min(...t); };
          return Math.min(spread(pitch), spread(-pitch), spread(0));
        }).filter((d) => d > 0.05 && d < 2);
        // (A member that turns — flight, landing, flight in one — has no one slope to be square to: then the height most of it stands.)
        const mostly = tall.length ? [...byCm].sort((p, q) => q[1] - p[1] || q[0] - p[0])[0][0] / 100 : 0;
        const fit = across.length ? Math.min(...across) : 0;
        const depth = Math.round((fit > 0 && fit < 0.6 ? fit : mostly) * 1000) / 1000;
        if (out.length && depth > 0) stringers = { width: Math.min(...out) * s, depth: depth * s };
        if (typeof process !== 'undefined' && process.env?.RECIPE_TRACE) console.error(`[stair-stringers] ${stairGid}: ${members.length} member(s), out ${out.map((d) => d.toFixed(3)).join('/')}, depth ${depth.toFixed(3)} of ${[...byCm].sort((p, q) => q[1] - p[1]).map(([k, n]) => `${k}cm×${n}`).join(' ')}`);
      }
      const spec = {
        ...runs[0],
        ...(stringers ? { sizes: { ...((runs[0] as { sizes?: object }).sizes ?? {}), stringerWidth: stringers.width, stringerDepth: stringers.depth } } : {}),
        base,
        height: top - base,
        risers: runs.reduce((t, r) => t + Number(r.risers), 0),
        runs: runs.map((r) => ({ path: r.path, risers: r.risers, tread: r.tread, width: r.width, endsWithRiser: r.endsWithRiser, base: r.base, height: r.height, sketch: r.sketch })),
        ...(landings.length ? { landings } : {}),
      };
      delete (spec as Record<string, unknown>).sketch;
      const attrs: Record<string, string> = { CategoryId: CATEGORY.stairs, Type: flights[0].type, Level: flights[0].level, Stairs: JSON.stringify(spec) };
      if (typeof process !== 'undefined' && process.env?.RECIPE_TRACE) console.error(`[stair-group] ${stairGid}: ${runs.length} flight(s), ${landings.length} landing(s), ${spec.risers} risers, ${(top - base) / s} m`);
      // (Its key the stair's own: its parts — the flights, the landing slabs — are its, not shapes of their own.)
      if (add(`${picked.fileId}:${stairGid}:stair`, attrs)) stairCount++;
    }
    // ---- 2c. Railings: the modelling tool's own, along the file's path. ----
    // 🔴 A RAILING IS A RAILING (rac_advanced 12-11: its 22 came in as shapes, generic models): the converter's run of it — its path, its
    // base, its height and its type — as the modelling tool's railing, of the model's type of that name, or one of its height.
    // 🔴 ONE ON A STAIR GOES ON THAT STAIR (rac_advanced 12-11: its stairs' railings flat at each flight's foot, the original's up their
    // slope): the stair the file puts it in, its key, for the modelling tool to host it there.
    const stairKeyOf = new Map<string, string>();
    for (const record of records) {
      if (record.kind !== 'stair' || record.params.of !== 'stair') continue;
      const st = stairOfFlight(record.item.guid ?? undefined);
      if (st && !stairKeyOf.has(st)) stairKeyOf.set(st, (flightsOf.get(st) ?? 0) > 1 ? `${picked.fileId}:${st}:stair` : key(record.id));
    }
    let railingCount = 0, railingRead = 0;
    for (const record of records) {
      if (record.kind !== 'run' || record.params.of !== 'railing') continue;
      railingRead++;
      const body = innerJson<RunBody & { height?: number }>(record, 'run');
      const curves = body?.run?.line?.curves ?? [];
      const level = levels.get(String(body?.level ?? record.params.level ?? ''));
      if (!curves.length || !level || curves.some((cv) => cv.kind !== 'segment' || !cv.from || !cv.to)) continue;
      const pts = [curves[0].from!, ...curves.map((cv) => cv.to!)].map((q) => [q[0] * s, q[1] * s]);
      const lookRef = String(record.params.lookRef ?? record.params.type ?? '');
      // (Its type the native one the file names, «Family:Type:Id», when it came from the modelling tool; else its style's name.)
      const typeName = nativeOf(record)?.type ?? lookRef.split(':').pop() ?? lookRef;
      const parent = record.item.guid && shapes ? shapes.elements.get(record.item.guid)?.parent : null;
      const onStair = parent ? stairKeyOf.get(parent) : undefined;
      const attrs: Record<string, string> = {
        CategoryId: CATEGORY.railings,
        Type: typeName,
        Level: level.name,
        Railing: JSON.stringify({ path: pts, base: (level.at + (Number(body?.base ?? record.params.base) || 0)) * s, height: (Number(body?.height ?? record.params.height) || 0) * s, ...(onStair ? { stair: onStair } : {}) }),
      };
      if (add(key(record.id), attrs)) railingCount++;
    }
    if (typeof process !== 'undefined' && process.env?.RECIPE_TRACE) console.error(`[railings] ${railingCount} of ${railingRead}`);

    // ---- 3. Floors, foundation slabs, roofs and ceilings: slabs by their boundary loops. ----
    // Read and written per kind: each is its own row of the rules table.
    const slabTypeWidths = new Map<string, number>();
    const slabRead = { floor: 0, foundation: 0, roof: 0, ceiling: 0 };
    const slabMade = { floor: 0, foundation: 0, roof: 0, ceiling: 0 };
    // 🔴 A SHAFT DRAWN IN THE MODELLER IS A VOID FORM (`opening.shaft`, a void that cuts what it crosses, the modelling tool's Opening): no
    // thing of its own, and a hole in each slab its height goes through (Antonio 1-11, the guion: «her the modelling tool has the opening.
    // Native»). Written as a thing, it came as a solid box in the shaft, the floor whole around it.
    const voidForms = records.flatMap((one) => {
      if (one.kind !== 'extrusion' || one.params.of !== 'form') return [];
      const its = innerJson<ExtrusionBody & { void?: boolean; depth?: number }>(one, 'extrusion');
      const on = levels.get(String(its?.level ?? one.params.level ?? ''));
      const outline = (its?.profile?.outline?.curves ?? []).flatMap((c) => (c.from ? [c.from] : []));
      if (!its?.void || !on || outline.length < 3) return [];
      const from = on.at + (Number(one.params.base) || 0);
      return [{ guid: one.item.guid, outline, from, to: from + (Number(its.depth ?? one.params.depth) || 0) }];
    });
    for (const record of records) {
      const of = record.params.of;
      if (record.kind !== 'extrusion' || (of !== 'slab' && of !== 'roof' && of !== 'covering')) continue;
      let kind = of === 'covering' ? 'ceiling' : of === 'roof' ? 'roof' : slabKind(record);
      if (kind === 'other') continue;
      // 🔴 A RAMP IS NO FLOOR: the modelling tool makes no ramp through its API, and a ramp's sloped flight as a floor came to nothing
      // (Savoyvilla 24-10: its 4 flights missing, a client model's made from their shapes all twins). Left to its shape.
      if (shapes && record.item.guid && /^IFCRAMP(FLIGHT)?$/i.test(shapes.elements.get(record.item.guid)?.ifcClass ?? '')) continue;
      const body = innerJson<ExtrusionBody>(record, 'extrusion');
      // 🔴 A PROFILE DRAWN STANDING UP IS NO FLOOR'S OUTLINE (GNI model_120 r55: 11 stepped footings «Fundament 60 x 60 x
      // 1.20», their L section on a vertical workplane, laid flat at the origin by the modelling tool or lost): left to its shape.
      const on = (body as { on?: { u?: number[]; v?: number[]; origin?: number[] } } | null)?.on;
      // 🔴 A ROOF BY EXTRUSION AS THE CONVERTER READS ONE (`extruded`: its top line drawn in a plane standing up, pushed from where it
      // starts to where it ends; rac_advanced's butterfly roof «Generic - 400mm», 12-11): the modelling tool's own roof by extrusion. Taken for a
      // profile standing up, it was left to its two faces' shapes.
      const extruded = (body as { extruded?: { line?: { curves?: CurveJson[] }; from?: number; to?: number } } | null)?.extruded;
      if (kind === 'roof' && on && extruded?.line?.curves?.length && typeof extruded.from === 'number' && typeof extruded.to === 'number') {
        const lvl = levels.get(String(body?.level ?? record.params.level ?? ''));
        const u = on.u ?? [1, 0, 0], o = on.origin ?? [0, 0, 0];
        const along = [u[1], -u[0]];
        const pts = [extruded.line.curves[0].from!, ...extruded.line.curves.map((cv) => cv.to!)].filter(Boolean);
        const at = (d: number, z: number, t: number) => [(o[0] + u[0] * d + along[0] * t) * s, (o[1] + u[1] * d + along[1] * t) * s, ((lvl?.at ?? 0) + z) * s];
        if (lvl && pts.length >= 2 && typeof record.params.lookRef === 'string') {
          const profile = pts.map((p) => at(p[0], p[1], extruded.from!));
          const plan = [at(pts[0][0], 0, extruded.from), at(pts[pts.length - 1][0], 0, extruded.from), at(pts[pts.length - 1][0], 0, extruded.to), at(pts[0][0], 0, extruded.from === extruded.to ? extruded.to + 1 : extruded.to)].flat();
          const xattrs: Record<string, string> = {
            CategoryId: CATEGORY.roofs,
            Type: nativeOf(record)?.type ?? String(record.params.lookRef),
            Profile: JSON.stringify([plan]),
            Level: lvl.name,
            Extrusion: JSON.stringify({ profile, along, length: (extruded.to - extruded.from) * s }),
          };
          const w = thicknessOf(String(record.params.lookRef));
          if (w) xattrs['Type.Width'] = num(w);
          slabRead.roof++;
          if (add(key(record.id), xattrs)) slabMade.roof++;
          if (typeof process !== 'undefined' && process.env?.RECIPE_TRACE) console.error(`[roof-extruded] ${record.item.guid} ${record.params.lookRef}: ${pts.length} corner(s), ${(extruded.to - extruded.from).toFixed(3)} m along`);
          continue;
        }
      }
      if (on && (Math.abs(on.u?.[2] ?? 0) > 1e-3 || Math.abs(on.v?.[2] ?? 0) > 1e-3)) continue;
      // 🔴 A ONE-PLANE ROOF WHOSE LOW SIDE IS A CORNER, NO EDGE (GNI model_98 r55: «FB 100 leer», 14 pieces of a 2-3° deck
      // as IfcSlab, each a slope toward a vertex of its outline; no edge to put the modelling tool's footprint slope on, made flat, 14
      // «off» at 4 to 20 cm): a sloped floor — the modelling tool's slope arrow takes any direction. (Measured r61: model_98 96.5 → 98.4,
      // the 8 off → twin; on nothing else of Duplex, Savoyvilla, racbasic, DACH, Schependomlaan, GNI 18/28/166.)
      if (kind === 'roof' && !gableOf(record)) {
        const pl = (body as { slope?: { toward?: number; by?: number }; slopes?: unknown[] } | null);
        const cs = body?.profile?.outline?.curves ?? [];
        if (pl?.slope && typeof pl.slope.by === 'number' && Math.abs(pl.slope.by) > 1e-3 && typeof pl.slope.toward === 'number' && !(Array.isArray(pl.slopes) && pl.slopes.some((x) => typeof x === 'number')) && cs.length >= 3) {
          const d = [Math.cos(pl.slope.toward), Math.sin(pl.slope.toward)];
          const pts = cs.map((cv) => cv.from!).filter(Boolean);
          const proj = pts.map((p) => p[0] * d[0] + p[1] * d[1]), lo = Math.min(...proj);
          const eave = pts.some((_, i) => Math.abs(proj[i] - lo) < 0.01 && Math.abs(proj[(i + 1) % pts.length] - lo) < 0.01);
          if (!eave) {
            kind = 'floor';
            if (typeof process !== 'undefined' && process.env?.RECIPE_TRACE) console.error(`[roof-as-floor] ${record.item.guid} ${record.params.lookRef}: its low side a corner, a sloped floor`);
          }
        }
      }
      slabRead[kind as keyof typeof slabRead]++;
      if (typeof process !== 'undefined' && process.env?.RECIPE_SLAB === record.item.guid) console.error(`[slab] ${record.item.guid}: params ${JSON.stringify(record.params).slice(0, 600)} body ${JSON.stringify(body).slice(0, 1500)}`);
      const base =
        typeof record.params.base === 'number' ? record.params.base : 0;
      const level = levels.get(String(body?.level ?? record.params.level ?? ''));
      const lookRef = record.params.lookRef;
      const loopOf = (curves?: CurveJson[]): number[] | null => {
        if (!curves?.length) return null;
        const flat: number[] = [];
        for (const curve of curves) {
          if (curve.kind !== 'segment' || !curve.from) return null;
          flat.push(curve.from[0] * s, curve.from[1] * s, base * s);
        }
        return flat.length >= 9 ? flat : null;
      };
      let outer = loopOf(body?.profile?.outline?.curves) as number[];
      if (typeof lookRef !== 'string' || !level || !outer) continue;
      // 🔴 AND THE REST OF IT, WHEN THE FILE WRITES IT IN PIECES (a client's model 13-11: a ceiling of two rectangles side by side, the reader's
      // `regions`, came as its first — 13.6 m of 32.2, 93 ceilings over 30 cm off): its regions joined to its outline where they touch.
      const regionLoops = ((body as { regions?: { outline?: { curves?: CurveJson[] }; holes?: { curves?: CurveJson[] }[] }[] } | null)?.regions ?? []);
      const extraLoops: number[][] = [];
      if (regionLoops.length > 0) {
        const toPts = (l: number[]) => { const q: number[][] = []; for (let k = 0; k + 2 < l.length; k += 3) q.push([l[k] / s, l[k + 1] / s]); return q; };
        const fromPts = (q: number[][]) => q.flatMap((p) => [p[0]! * s, p[1]! * s, base * s]);
        const pieces = [outer, ...regionLoops.map((r) => loopOf(r.outline?.curves)).filter((l): l is number[] => !!l)].map(toPts);
        const joined = unionOfLoops(pieces);
        const ccw = (q: number[][]) => q.reduce((a, p, i) => { const r = q[(i + 1) % q.length]!; return a + p[0]! * r[1]! - r[0]! * p[1]!; }, 0) / 2;
        const outers = joined.filter((q) => ccw(q) > 0).sort((x, y) => ccw(y) - ccw(x));
        if (outers.length > 0) {
          outer = fromPts(outers[0]!);
          for (const q of [...outers.slice(1), ...joined.filter((q) => ccw(q) < 0)]) extraLoops.push(fromPts(q));
          for (const r of regionLoops) for (const h of r.holes ?? []) { const l = loopOf(h.curves); if (l) extraLoops.push(l); }
          if (typeof process !== 'undefined' && process.env?.RECIPE_TRACE) console.error(`[slab-regions] ${record.item.guid} ${record.item.name ?? ''}: ${pieces.length} pieces → ${outers.length} outline(s), ${joined.length - outers.length} hole(s)`);
        }
      }
      const loops: number[][] = [outer, ...extraLoops];
      // A gable's holes lie ON its face, each corner at the slope's height there: the modelling tool cuts a
      // roof's hole square to the face from where the loop is, and a loop left at the level
      // slid sideways up the slope and across the ridge ("overlapping lines").
      const holeGable = kind === 'roof' ? gableOf(record) : null;
      for (const hole of body?.profile?.holes ?? []) {
        const inner = loopOf(hole?.curves);
        if (inner && holeGable)
          for (let k = 0; k + 2 < inner.length; k += 3) inner[k + 2] = holeGable.zAt(inner[k] / s, inner[k + 1] / s) * s;
        if (inner) loops.push(inner);
      }
      // 🔴 THE OPENINGS THAT VOID IT (the converter since 24-10, `extrusion.cuts`: shafts and stair wells, lost before):
      // each cut straight down through it a hole of its loop, its outline's plan; one at a slant is not a hole.
      const cuts = [...((body as { cuts?: { outline?: number[][]; through?: number[] }[] } | null)?.cuts ?? [])];
      const slabFrom = level.at + base, slabTo = slabFrom + (Number(record.params.depth) || 0);
      for (const shaft of voidForms) if (shaft.from < slabTo - 1e-3 && slabFrom < shaft.to - 1e-3) cuts.push({ outline: shaft.outline, through: [0, 0, shaft.to - shaft.from] });
      for (const cut of cuts) {
        const t = cut.through, o = cut.outline;
        if (!Array.isArray(o) || o.length < 3 || !Array.isArray(t) || Math.abs(t[2]) < 0.99 * Math.hypot(t[0], t[1], t[2])) continue;
        const pts = o.filter((p, k) => k === 0 || Math.hypot(p[0] - o[k - 1][0], p[1] - o[k - 1][1]) > 1e-4);
        if (pts.length > 3 && Math.hypot(pts[0][0] - pts[pts.length - 1][0], pts[0][1] - pts[pts.length - 1][1]) < 1e-4) pts.pop();
        if (pts.length < 3) continue;
        // (Only one wholly inside its outline: a hole across its edge, and the modelling tool refuses the whole floor.)
        const inside = (x: number, y: number) => {
          let c = false;
          for (let i = 0, j = outer.length / 3 - 1; i < outer.length / 3; j = i++) {
            const xi = outer[3 * i] / s, yi = outer[3 * i + 1] / s, xj = outer[3 * j] / s, yj = outer[3 * j + 1] / s;
            if ((yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) c = !c;
          }
          return c;
        };
        if (!pts.every((p) => inside(p[0], p[1]))) { if (typeof process !== 'undefined' && process.env?.RECIPE_TRACE) console.error(`[slab-cut] ${record.item.guid}: a cut across its edge, left`); continue; }
        // 🔴 (Nor one that touches its edge or another hole, by box, 1 cm to spare — DACH r39: 13 floors «the input curve
        // loops cannot compose a valid boundary», their cuts over the holes they already had, all 13 missing.)
        const box = (q: number[][]) => [Math.min(...q.map((p) => p[0])), Math.min(...q.map((p) => p[1])), Math.max(...q.map((p) => p[0])), Math.max(...q.map((p) => p[1]))];
        const flatPts = (l: number[]) => { const q: number[][] = []; for (let k = 0; k + 2 < l.length; k += 3) q.push([l[k] / s, l[k + 1] / s]); return q; };
        const mine = box(pts);
        // (By its real shape where the boxes meet: a shaft beside a stepped stair well is inside the well's box and clear of it, a client's model 1-11.)
        const inLoop = (q: number[][], x: number, y: number) => { let c = false; for (let i = 0, j = q.length - 1; i < q.length; j = i++) if ((q[i][1] > y) !== (q[j][1] > y) && x < ((q[j][0] - q[i][0]) * (y - q[i][1])) / (q[j][1] - q[i][1]) + q[i][0]) c = !c; return c; };
        const toEdge = (p: number[], a: number[], b: number[]) => { const dx = b[0] - a[0], dy = b[1] - a[1], u = Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / (dx * dx + dy * dy || 1))); return Math.hypot(p[0] - (a[0] + u * dx), p[1] - (a[1] + u * dy)); };
        const nearLoop = (q: number[][], r: number[][]) => q.some((p) => inLoop(r, p[0], p[1]) || r.some((a, k) => toEdge(p, a, r[(k + 1) % r.length]) < 0.01));
        const clashes = loops.slice(1).some((l) => { const other = flatPts(l), b = box(other); return mine[0] < b[2] + 0.01 && b[0] < mine[2] + 0.01 && mine[1] < b[3] + 0.01 && b[1] < mine[3] + 0.01 && (nearLoop(pts, other) || nearLoop(other, pts)); });
        const outerPts = flatPts(outer);
        const nearEdge = pts.some((p) => outerPts.some((a, k) => {
          const b = outerPts[(k + 1) % outerPts.length], dx = b[0] - a[0], dy = b[1] - a[1], L2 = dx * dx + dy * dy || 1;
          const u = Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / L2));
          return Math.hypot(p[0] - (a[0] + u * dx), p[1] - (a[1] + u * dy)) < 0.01;
        }));
        if (clashes || nearEdge) { if (typeof process !== 'undefined' && process.env?.RECIPE_TRACE) console.error(`[slab-cut] ${record.item.guid}: a cut ${clashes ? 'over another hole' : 'at its edge'}, left`); continue; }
        const inner = pts.flatMap((p) => [p[0] * s, p[1] * s, (holeGable ? holeGable.zAt(p[0], p[1]) : base) * s]);
        loops.push(inner);
        if (typeof process !== 'undefined' && process.env?.RECIPE_TRACE) console.error(`[slab-cut] ${record.item.guid} ${record.item.name ?? ''}: a hole of ${pts.length} corners`);
      }
      const attrs: Record<string, string> = {
        CategoryId:
          kind === 'roof' ? CATEGORY.roofs
          : kind === 'ceiling' ? CATEGORY.ceilings
          : kind === 'foundation' ? CATEGORY.structuralFoundations
          : CATEGORY.floors,
        Type: nativeOf(record)?.type ?? lookRef,
        Profile: JSON.stringify(loops),
        Level: level.name,
      };
      let width = thicknessOf(lookRef);
      // 🔴 A ROOF AS THICK AS ITS LAYERS SAY, where the file declares them (DACH 24-10: a 40 mm board at 72°, «VS_Dach
      // GK 40», came as «Roof 2780 mm», its height for its thickness: four roofs 24 to 70 times their volume).
      if (kind === 'roof' && shapes && record.item.guid) {
        const layers = shapes.elements.get(record.item.guid)?.layers;
        const sum = layers?.reduce((t, l) => t + (l.thickness > 0 ? l.thickness : 0), 0) ?? 0;
        if (sum > 0 && (!width || Math.abs(sum * s - width) > 0.2 * width)) width = sum * s;
        // 🔴 A FLAT ROOF AS THICK AS ITS BODY, where that is more than its layers (12-11, rac_advanced's «Concrete Deck - Tapered Insulation»:
        // its layers 0.25 m, its tapered insulation up to 0.40; made by its layers it came 15 cm short of its top). (Its falls themselves are
        // the modelling tool's shape editing, not made yet.)
        const slopes = (body as { slopes?: unknown[] } | null)?.slopes;
        if (!(Array.isArray(slopes) && slopes.some((x) => typeof x === 'number'))) {
          const q = shapePoints(shapes, record.item.guid);
          if (q.length) {
            const h = (Math.max(...q.map((p) => p[2])) - Math.min(...q.map((p) => p[2]))) * s;
            if (width && h > width * 1.05 && h < width * 3) width = h;
          }
        }
      }
      // 🔴 A ROOF OF GLASS IS GLAZING, NOT A SLAB (rac_advanced 12-11: its three «Sloped Glazing», each 14 panels and 40 bars in
      // the file, came as solid roofs, not a pane of glass among them): the modelling tool's own sloped glazing, a bar where the file has each.
      if (kind === 'roof' && shapes && record.item.guid) {
        const glazing = glazingOf(record.item.guid);
        if (glazing) {
          attrs.Glazing = JSON.stringify(glazing);
          if (typeof process !== 'undefined' && process.env?.RECIPE_TRACE) console.error(`[glazing] ${record.item.guid} ${record.item.name ?? ''}: ${glazing.bars.length} bar(s), ${glazing.panels} panel(s), bar ${(glazing.mullion.width / s * 1000).toFixed(0)} x ${(glazing.mullion.depth / s * 1000).toFixed(0)} mm`);
        }
      }
      if (width) attrs['Type.Width'] = num(width);
      // 🔴 ONE TYPE, ONE WIDTH, as a wall's (GNI model_78's «Foundation Slab», 50, 15 and 12 cm: made by the first, the
      // others 3 and 4 times their volume). The name the file uses at another thickness is a variant of its own.
      if (width) {
        const seen = slabTypeWidths.get(attrs.Type);
        if (seen === undefined) slabTypeWidths.set(attrs.Type, width);
        else if (Math.abs(seen - width) > 0.001) attrs.Type = `${attrs.Type} · ${Math.round((width / s) * 1000)} mm`;
      }
      // 🔴 CUT BY THE WALLS THAT STAND IN IT (GNI model_176 30-10: «SLA - 001», 200 mm of structure and a 100 mm finish
      // short of every wall, its walls standing on the structure): Join Geometry, each wall cutting, as the modelling tool's walls cut
      // a floor's finish; the floor whole under them, 10 cm too many at every wall before.
      if (kind === 'floor' && shapes && record.item.guid) {
        const q = shapePoints(shapes, record.item.guid);
        if (q.length) {
          const fb = [0, 1, 2].map((k) => Math.min(...q.map((p) => p[k]))).concat([0, 1, 2].map((k) => Math.max(...q.map((p) => p[k]))));
          const cutters = segs.flatMap((sg) => {
            const w = sg.record.item.guid ? shapePoints(shapes, sg.record.item.guid) : [];
            if (w.length < 4) return [];
            const wb = [0, 1, 2].map((k) => Math.min(...w.map((p) => p[k]))).concat([0, 1, 2].map((k) => Math.max(...w.map((p) => p[k]))));
            // (On a step of the floor's own shape: its finish stops there. A floor that goes on whole through a wall that
            // stands in it — Savoyvilla's 2, 98.2 → 97.7 cut — has no such level; its file did not cut it.)
            const standsIn = wb[2] > fb[2] + 0.01 && wb[2] < fb[5] - 0.01 && wb[5] > fb[5] && q.some((p) => Math.abs(p[2] - wb[2]) < 0.005);
            const over = wb[0] < fb[3] - 0.01 && fb[0] < wb[3] - 0.01 && wb[1] < fb[4] - 0.01 && fb[1] < wb[4] - 0.01;
            if (!standsIn || !over) return [];
            const k = `${key(sg.record.id)}#${sg.i}`, before = made.get(k);
            return before ? [k, before] : [k];
          });
          if (cutters.length) {
            attrs.CutBy = [...new Set(cutters)].join('|');
            if (typeof process !== 'undefined' && process.env?.RECIPE_TRACE) console.error(`[floor-cut] ${record.item.guid} ${record.item.name ?? ''}: cut by ${cutters.length} wall(s)`);
          }
        }
      }
      if (kind === 'roof' || kind === 'ceiling') {
        // A footprint roof and a ceiling are placed by their BOTTOM face: the record's base as
        // it stands. A roof also carries which edges slope, and by how much (rise over run).
        attrs.BaseOffset = num(base * s);
        // A CEILING HANGS from the level above its own by its `drop` (the converter's covering):
        // its bottom is that level less the drop and its thickness (racbasic: 2.70 - 0.50 - 0.05
        // = 2.15, which a base of 0 put on the floor).
        const drop = Number(record.params.drop ?? (body as { said?: { drop?: string } } | null)?.said?.drop);
        if (kind === 'ceiling' && Number.isFinite(drop) && width) {
          const above = [...levels.values()].filter((one) => one.at > level.at + 1e-6).sort((a, b) => a.at - b.at)[0];
          if (above) attrs.BaseOffset = num((above.at - drop - width / s - level.at) * s);
        }
        const slopes = (body as { slopes?: (number | null)[] } | null)?.slopes;
        if (kind === 'roof' && Array.isArray(slopes) && slopes.some((x) => typeof x === 'number')) {
          attrs.Slopes = JSON.stringify(slopes.map((x) => (typeof x === 'number' ? x : null)));
          // 🔴 ITS BASE IS THE TOP AT THE EAVES (measured below), and the modelling tool's footprint roof stands on its bottom there:
          // down by its thickness measured plumb, t·√(1+p²) (DACH: all 15 sloped roofs 0.17 m off their slope, 23-10).
          const p = Math.max(...slopes.filter((x): x is number => typeof x === 'number').map((x) => Math.abs(x)));
          if (width && p > 0) attrs.BaseOffset = num(base * s - width * Math.sqrt(1 + p * p));
          // 🔴 ITS EAVES CUT AS THE FILE CUTS THEM (GNI model_28 25-10: a 30° hip roof «Ziegeldach 360», its top at the
          // eaves right, its lowest point 0.29 m higher than a plumb cut's — a 15 cm cut square to the slope and a level
          // soffit, the modelling tool's «Two Cut - Square» with that fascia depth; set on its base, the ridge went 0.29 m high).
          // Its lowest points inside its outline: square; at it: plumb. The fascia from how far above them its top is.
          const roofPts = shapes && record.item.guid ? shapePoints(shapes, record.item.guid) : [];
          if (width && p > 0 && roofPts.length >= 4) {
            const zs = roofPts.map((q) => q[2] - shapeDz), lowest = Math.min(...zs);
            const top = level.at + base, plumbLow = top - (width / s) * Math.sqrt(1 + p * p);
            const drop = top - lowest;
            if (lowest - plumbLow > 0.01 && drop > 0.01) {
              const low = roofPts.filter((_, k) => zs[k] < lowest + 0.002);
              const box = (ps: number[][]) => [Math.min(...ps.map((q) => q[0])), Math.min(...ps.map((q) => q[1])), Math.max(...ps.map((q) => q[0])), Math.max(...ps.map((q) => q[1]))];
              const [ax0, ay0, ax1, ay1] = box(roofPts), [lx0, ly0, lx1, ly1] = box(low);
              const square = lx0 - ax0 > 0.01 && ly0 - ay0 > 0.01 && ax1 - lx1 > 0.01 && ay1 - ly1 > 0.01;
              attrs.EaveCut = square ? 'TwoCutSquare' : 'TwoCutPlumb';
              attrs.FasciaDepth = num((square ? drop * Math.sqrt(1 + p * p) : drop) * s);
            }
            if (typeof process !== 'undefined' && process.env?.RECIPE_TRACE) console.error(`[roof-eave] ${record.item.guid} ${lookRef}: plumb low ${plumbLow.toFixed(3)}, its lowest ${lowest.toFixed(3)} → ${attrs.EaveCut ?? 'plumb'}${attrs.FasciaDepth ? `, fascia ${(Number(attrs.FasciaDepth) / s).toFixed(3)}` : ''}`);
          }
          if (typeof process !== 'undefined' && process.env?.RECIPE_TRACE) console.error(`[roof] ${record.item.guid} ${lookRef}: slopes ${JSON.stringify(slopes)} base ${base} width ${width} edges ${loops[0] ? loops[0].length / 3 : 0} profile ${JSON.stringify(loops[0]?.map((v) => +v.toFixed(2)))}`);
        }
        // A GABLE - four edges, two opposite ones sloping - is the modelling tool's ROOF BY EXTRUSION: its
        // ridge profile drawn across, pushed along the eaves. A footprint roof cannot be it: its
        // one base is the bottom at every eave, and the record's base is the TOP at the eaves
        // (measured on racbasic: footprint 0.29 m high, the roof's thickness up its slope), so
        // two slopes put the bottoms at two heights.
        const gable = kind === 'roof' ? gableOf(record) : null;
        if (gable) {
          const { A, n, u, W, ridge, si, ti, tj, L } = gable;
          const point = (d: number, z: number) => [(A[0] + n[0] * d) * s, (A[1] + n[1] * d) * s, z * s];
          attrs.Extrusion = JSON.stringify({
            profile: [point(0, ti), point(ridge, ti + si * ridge), point(W, tj)],
            along: [u[0], u[1]],
            length: L * s,
          });
          delete attrs.Slopes;
        }
        // 🔴 A ROOF THAT IS ONE SLOPED SLAB (GNI model_18 25-10: «Titanzink - Eindeckung», 30°, its pieces as IfcSlab, made
        // flat — the slope it said went unread): a mono-pitch, its slope on the edge at the low side, square to the slope.
        // The record's `base` is its bottom there, where the modelling tool's footprint stands; `by` is the angle, the modelling tool wants rise/run.
        const plane = (body as { slope?: { toward?: number; by?: number } } | null)?.slope;
        const curves = body?.profile?.outline?.curves ?? [];
        if (kind === 'roof' && !gable && !attrs.Slopes && plane && typeof plane.by === 'number' && Math.abs(plane.by) > 1e-3 && typeof plane.toward === 'number' && curves.length >= 3) {
          const d = [Math.cos(plane.toward), Math.sin(plane.toward)];
          const pts = curves.map((cv) => cv.from!).filter(Boolean);
          const proj = pts.map((p) => p[0] * d[0] + p[1] * d[1]);
          const lo = Math.min(...proj);
          const eaves = pts.map((_, i) => Math.abs(proj[i] - lo) < 0.01 && Math.abs(proj[(i + 1) % pts.length] - lo) < 0.01);
          if (pts.length === curves.length && eaves.some(Boolean)) {
            attrs.Slopes = JSON.stringify(eaves.map((low) => (low ? Math.tan(Math.abs(plane.by!)) : null)));
            attrs.BaseOffset = num(base * s);
            // 🔴 ITS BOTTOM FROM ITS SHAPE WHERE `base` IS ITS HIGH SIDE'S (31-10, GNI model_154's «Roof_Generic-125mm», 30°, up by
            // exactly its rise; model_78, 123, 143...), as a sloped floor's (model_54): `base` is at either side, as the file wrote it.
            const body3 = shapes && record.item.guid ? shapePoints(shapes, record.item.guid) : [];
            if (body3.length >= 4) {
              const lowest = Math.min(...body3.map((q) => q[2])) - shapeDz;
              if (level.at + base - lowest > 0.5 * Math.tan(Math.abs(plane.by!)) * (Math.max(...proj) - lo)) attrs.BaseOffset = num((lowest - level.at) * s);
            }
          }
          if (typeof process !== 'undefined' && process.env?.RECIPE_TRACE) console.error(`[roof-plane] ${record.item.guid} ${lookRef}: ${(plane.by * 180 / Math.PI).toFixed(1)}° toward ${(plane.toward * 180 / Math.PI).toFixed(1)}°, eaves ${JSON.stringify(eaves)}`);
        }
      } else if (width) {
        // A slab's `base` is its BOTTOM face, relative to its level; the modelling tool places a floor by its
        // TOP face (height offset from level), and ignores the profile's z.
        attrs.HeightOffset = num(base * s + width);
        // 🔴 A SLOPED ONE (DACH's gravel, 5°: made flat at its high side, 24-10): its arrow from its lowest corner up
        // the slope and the slope itself; its top then at that corner, the slope's rise lower than at its high side.
        const slope = (body as { slope?: { toward?: number; by?: number } } | null)?.slope;
        const outline = body?.profile?.outline?.curves ?? [];
        if (slope && typeof slope.by === 'number' && Math.abs(slope.by) > 1e-4 && typeof slope.toward === 'number' && outline.length >= 3) {
          const d = [Math.cos(slope.toward), Math.sin(slope.toward)];
          const pts = outline.map((cv) => cv.from!).filter(Boolean);
          const proj = pts.map((p) => p[0] * d[0] + p[1] * d[1]);
          const lo = Math.min(...proj), hi = Math.max(...proj);
          const tail = pts[proj.indexOf(lo)];
          // (`by` is the angle — model_18's 30° came as 0.5236 — and the modelling tool's slope rise over run: alike at 5°, not at 30°.)
          const rise = Math.tan(slope.by);
          if (hi - lo > 1e-3) {
            attrs.Slope = num(rise);
            attrs.SlopeArrow = JSON.stringify([tail[0] * s, tail[1] * s, (tail[0] + d[0] * (hi - lo)) * s, (tail[1] + d[1] * (hi - lo)) * s]);
            attrs.HeightOffset = num(base * s + width - rise * (hi - lo) * s);
            // 🔴 ITS TOP AT ITS LOW CORNER FROM ITS SHAPE, where there is one: `base` is its bottom at its low side in
            // some files and at its high side in others (GNI model_54 25-10: «Roof_metal» at 7.6°, 0.40 m low, the
            // rise taken off a base that was already the low one). Its lowest point and its thickness, plumb.
            const body3 = shapes && record.item.guid ? shapePoints(shapes, record.item.guid) : [];
            if (body3.length >= 4) {
              const lowest = Math.min(...body3.map((q) => q[2])) - shapeDz;
              attrs.HeightOffset = num((lowest - level.at) * s + width * Math.sqrt(1 + rise * rise));
              if (typeof process !== 'undefined' && process.env?.RECIPE_TRACE) console.error(`[slab-slope] ${record.item.guid} ${lookRef}: lowest ${lowest.toFixed(3)} level ${level.at.toFixed(3)} base ${base.toFixed(3)} rise ${(rise * (hi - lo)).toFixed(3)}: top at its low corner ${(lowest + width * Math.sqrt(1 + rise * rise) / s).toFixed(3)} (by base ${(level.at + base + width / s - rise * (hi - lo)).toFixed(3)})`);
            }
          }
        }
      }
      if (add(key(record.id), attrs)) slabMade[kind as keyof typeof slabMade]++;
    }

    // ---- 4. Columns (members), by picked type or by style name. ----
    let columnCount = 0;
    let columnRead = 0;
    for (const record of records) {
      if (record.kind !== 'member' || record.params.of !== 'column') continue;
      columnRead++;
      const body = innerJson<MemberBody>(record, 'member');
      const at = body?.start;
      if (!at || at.length !== 3) continue;
      const named = trustStyleNames ? familyAndType(record.params.lookRef) : null;
      if (trustStyleNames && !named) continue;
      if (!named && !columnType) continue; // no way to name a type for it
      const family = named ?? {
        family: columnType!.family,
        type: columnType!.type,
      };
      const level = levels.get(String(body?.level ?? ''));
      if (
        add(
          key(record.id),
          {
            ...(columnType && !named
              ? { CategoryId: columnType.categoryId }
              : {}),
            Family: family.family,
            Type: family.type,
            ...(level ? { Level: level.name } : {}),
          },
          {
            position: [at[0] * s, at[1] * s, at[2] * s],
            rotationDeg: (Number(body?.roll ?? 0) || 0) * DEGREES,
          },
        )
      )
        columnCount++;
    }

    // ---- 5. Free-standing instances, opt-in, by style name. ----
    let instanceCount = 0;
    let instanceRead = 0;
    let hostedWaiting = 0;
    let hostedCount = 0;
    for (const record of records) {
      if (record.kind !== 'familyInstance') continue;
      if (record.params.host || innerJson<InstanceBody>(record, 'instance')?.host) {
        // 🔴 A HOSTED DOOR OR WINDOW, IN THE WALL IT IS IN (Antonio 15-11, the modelling tool video: «faltan las puertas»): placed as
        // an existing the modelling tool type, in the wall this run made for its host (the applier finds it by its source key), at the
        // point the record has. The type: its own style name when style names are trusted, else the recipe's door or
        // window type. With neither, counted and not guessed (the applier refuses a type it does not have).
        const body = innerJson<InstanceBody & { hole?: string }>(record, 'instance');
        const hostId = String(record.params.host ?? body?.host ?? '');
        // 🔴 WHERE IT STANDS IS ITS HOLE'S (Designer 15-11: a door's `placement` is [0,0,0]; its `hostedCut` says `along`, metres
        // from the start of its host's line to the hole's edge, and `width`): the middle of the hole, on the host's line, in
        // the segment of the run it falls in (each segment is its own wall in the modelling tool, `<run>#<i>`).
        const hole = body?.hole ? records.find((one) => one.id === body.hole) : undefined;
        const hostRun = records.find((one) => one.id === hostId);
        let at = body?.placement?.at;
        let hostKey = key(hostId);
        if (hole && hostRun) {
          const along = Number(hole.params.along), width = Number(hole.params.width ?? 0);
          const pieces = segs.filter((sg) => sg.record === hostRun);
          let left = along + width / 2;
          for (const sg of pieces) {
            const len = Math.hypot(sg.to[0] - sg.from[0], sg.to[1] - sg.from[1]);
            if (left <= len + 1e-9 || sg === pieces[pieces.length - 1]) {
              const t = len > 0 ? Math.min(1, Math.max(0, left / len)) : 0;
              const level = levels.get(String(innerJson<RunBody>(hostRun, 'run')?.level ?? ''));
              at = [sg.from[0] + (sg.to[0] - sg.from[0]) * t, sg.from[1] + (sg.to[1] - sg.from[1]) * t, (level?.at ?? 0) + Number(hole.params.sill ?? 0)];
              hostKey = `${key(hostId)}#${sg.i}`;
              break;
            }
            left -= len;
          }
        }
        const said = `${String(record.params.type ?? '')} ${record.item.category ?? ''} ${record.item.name ?? ''}`;
        const isWindow = /window|ventana/i.test(said) && !/door|puerta/i.test(said);
        const named = trustStyleNames ? familyAndType(record.params.lookRef ?? record.params.type) : null;
        const chosen = isWindow ? windowType : doorType;
        if (!hostId || !at || at.length !== 3 || (!named && !chosen)) {
          hostedWaiting++;
          continue;
        }
        // (Its level: its host's, so it stands on the floor the wall stands on.)
        const hostRecord = records.find((one) => one.id === hostId);
        const hostLevel = hostRecord ? levels.get(String(innerJson<RunBody>(hostRecord, 'run')?.level ?? '')) : undefined;
        if (
          add(
            key(record.id),
            {
              CategoryId: named ? (isWindow ? '-2000014' : '-2000023') : chosen!.categoryId,
              Family: named ? named.family : chosen!.family,
              Type: named ? named.type : chosen!.type,
              ...(hostLevel ? { Level: hostLevel.name } : {}),
            },
            { position: [at[0] * s, at[1] * s, at[2] * s], host: hostKey },
          )
        )
          hostedCount++;
        continue;
      }
      // Read whether or not they are asked for: the row shows what the model holds.
      instanceRead++;
      if (!includeInstances) continue;
      const body = innerJson<InstanceBody>(record, 'instance');
      const at = body?.placement?.at;
      if (!at || at.length !== 3) continue;
      const named = familyAndType(record.params.type);
      if (!named) continue;
      const right = body?.placement?.right;
      const rotation = right ? Math.atan2(right[1], right[0]) * DEGREES : 0;
      if (
        add(
          key(record.id),
          { Family: named.family, Type: named.type },
          { position: [at[0] * s, at[1] * s, at[2] * s], rotationDeg: rotation },
        )
      )
        instanceCount++;
    }

    // ---- 5a'. REINFORCING BARS AS REBAR (13-11: school_str's 619, DACH's 195, all generic models where the modelling tool has them as rebar in
    // their host): each bar by its axis (feet) and its diameter; the applier finds the host it lies in and the bar type of that size.
    let rebarCount = 0;
    if (shapes && env0.RECIPE_REBAR !== '0')
      for (const el of shapes.elements.values()) {
        if (!el.rebar || el.rebar.path.length < 2) continue;
        const attrs: Record<string, string> = {
          CategoryId: CATEGORY.rebar,
          Type: (el.typeName ?? el.objectType ?? el.name ?? 'Rebar').replace(/^.*?:\s*/, '').trim() || 'Rebar',
          Rebar: JSON.stringify({
            diameter: 2 * el.rebar.radius * s,
            path: el.rebar.path.map((p) => [p[0] * s, p[1] * s, p[2] * s]),
            // (The others of its set, when it is one: the applier lays them out as the modelling tool's bar set.)
            ...((el.rebar.paths?.length ?? 0) > 1 ? { others: el.rebar.paths!.slice(1).map((one) => one.map((p) => [p[0] * s, p[1] * s, p[2] * s])) } : {}),
          }),
        };
        if (add(`${picked.fileId}:${el.gid}:rebar`, attrs)) rebarCount++;
      }
    if (rebarCount && env0.RECIPE_TRACE) console.error(`[rebar] ${rebarCount} bar(s) as rebar`);

    // ---- 5b. Everything else with a body, as FAMILIES made from the file's own shapes. ----
    // 🔴 (Antonio, 21-10: «llegar al 100 %… comparar el brep o la mesh y que sea igual… definiendo familias»).
    // Whatever no step above builds natively (doors and windows, furniture, fixtures, proxies, columns, railings,
    // the parts of nothing written) is a family: one per shape, defined from the file's own geometry in the
    // element's frame, placed where the file has each. Doors and windows in the wall whose opening they fill.
    if (shapedPanels.size && typeof process !== 'undefined' && process.env?.RECIPE_TRACE) console.error(`[shaped-panels] ${shapedPanels.size} curtain panel(s) made as families of their shape`);
    const shaped = shapes ? familiesFromShapes(shapes, seen, picked.fileId, shapedPanels).filter((one) => !voidForms.some((shaft) => shaft.guid && one.key.includes(shaft.guid))) : [];
    if (typeof process !== 'undefined' && process.env?.RECIPE_TRACE) { const by: Record<string, number> = {}; for (const one of shaped) by[one.attrs.ShapeCategory] = (by[one.attrs.ShapeCategory] ?? 0) + 1; console.error(`[shaped-categories] ${JSON.stringify(by)}`); }
    // (RECIPE_GID=<gid>: what one shaped element is sent as, its shape left out.)
    if (typeof process !== 'undefined' && process.env?.RECIPE_GID)
      for (const one of shaped.filter((x) => x.key.includes(process.env!.RECIPE_GID!))) console.error(`[shaped] ${one.key} at ${one.at} turn ${one.rotationDeg} host ${one.host} ${JSON.stringify({ ...one.attrs, Shape: one.attrs.Shape ? '…' : undefined })}`);
    let shapeCount = 0;
    // 🔴 A FAMILY'S SHAPE GOES WITH ITS FIRST INSTANCE ONLY; when that one is kept (a rerun, a checkpoint), the shape
    // goes with whichever of its others are written (Conference's checkpoint 24-10: «family '36" x 84" (7)': not in
    // this model, and its shape did not come», 4 doors missing).
    const definition = new Map<string, Record<string, string>>();
    for (const one of shaped) {
      if (!one.attrs.Family || definition.has(one.attrs.Family)) continue;
      const def: Record<string, string> = {};
      for (const k of ['Shape', 'Prism']) if (one.attrs[k]) def[k] = one.attrs[k];
      if (Object.keys(def).length) definition.set(one.attrs.Family, def);
    }
    const firstKept = new Set<string>();
    for (const one of shaped) {
      const fam = one.attrs.Family;
      if (!fam || !definition.has(fam) || !(one.attrs.Shape || one.attrs.Prism)) continue;
      if (wouldKeep(one.key, one.host && made.get(one.host) ? { ...one.attrs, HostMade: made.get(one.host)! } : one.attrs, {
        position: [one.at[0] * s, one.at[1] * s, (one.at[2] - shapeDz) * s], rotationDeg: one.rotationDeg, ...(one.host ? { host: one.host } : {}),
      })) firstKept.add(fam);
    }
    for (const one of shaped) {
      const fam = one.attrs.Family;
      const placed = { position: [one.at[0] * s, one.at[1] * s, (one.at[2] - shapeDz) * s] as [number, number, number], rotationDeg: one.rotationDeg, ...(one.host ? { host: one.host } : {}) };
      const plain = one.host && made.get(one.host) ? { ...one.attrs, HostMade: made.get(one.host)! } : one.attrs;
      // (Only on one written anyway: a kept one keeps its print.)
      const withDef = fam && firstKept.has(fam) && !(one.attrs.Shape || one.attrs.Prism) && !wouldKeep(one.key, plain, placed) ? { ...one.attrs, ...definition.get(fam)! } : one.attrs;
      if (
        add(one.key, one.host && made.get(one.host) ? { ...withDef, HostMade: made.get(one.host)! } : withDef, {
          position: [one.at[0] * s, one.at[1] * s, (one.at[2] - shapeDz) * s],
          rotationDeg: one.rotationDeg,
          ...(one.host ? { host: one.host } : {}),
        })
      )
        shapeCount++;
    }
    // The openings nothing fills, cut in their walls (the modelling tool's Wall Opening): racbasic's kitchen niche left its
    // timber wall twice the IFC's volume (21-10).
    if (shapes) {
      for (const o of openingsFromShapes(shapes, seen, picked.fileId)) {
        // 🔴 Not where its wall's outline has its holes already (racbasic r52: the SIP gable wall, its hole in its
        // outline, cut again by the box of its opening once the wall's axis was right, 1.19 m³ → 0.88).
        const outline = written.get(o.host)?.Profile;
        if (outline) { try { const loops = JSON.parse(outline) as number[][];
          const pts: number[][] = [];
          for (let k = 0; k + 2 < o.box.length; k += 3) pts.push([o.box[k] * s, o.box[k + 1] * s, (o.box[k + 2] - shapeDz) * s]);
          const range = (q: number[][], i: number) => [Math.min(...q.map((p) => p[i])), Math.max(...q.map((p) => p[i]))];
          const mine = [0, 1, 2].map((i) => range(pts, i));
          const onAHole = loops.slice(1).some((l) => {
            const q: number[][] = [];
            for (let k = 0; k + 2 < l.length; k += 3) q.push([l[k], l[k + 1], l[k + 2]]);
            return q.length >= 3 && [0, 1, 2].every((i) => { const r = range(q, i); return r[0] < mine[i][1] + 0.03 && mine[i][0] < r[1] + 0.03; });
          });
          if (onAHole) { if (typeof process !== 'undefined' && process.env?.RECIPE_TRACE) console.error(`[opening] ${o.key}: its wall's outline has its holes`); continue; } } catch { /* read as none */ } }
        add(o.key, { WallOpening: o.box.map((v, i) => num((i % 3 === 2 ? v - shapeDz : v) * s)).join(','), ...(made.get(o.host) ? { HostMade: made.get(o.host)! } : {}) }, { host: o.host });
      }
    }
    // The rooms, last: each where its space's floor is, bounded by the walls as the modelling tool bounds a room (21-10: the
    // originals hold 14 and 91 of them, and nothing made one).
    if (shapes) {
      for (const r of roomsFromShapes(shapes, picked.fileId)) {
        add(r.key, { Room: '1', Name: r.name, Number: r.number, Height: num(r.height * s) }, { position: [r.at[0] * s, r.at[1] * s, (r.at[2] - shapeDz) * s] });
      }
    }

    // ---- 6. What the applier cannot create yet: counted, so the person sees
    // what the model holds and what still waits. ----
    // Only what no step above reads. A stair's landing goes with its stair, so a slab that is
    // neither floor, foundation, roof nor ceiling waits only when it is not a landing.
    let bodiesWaiting = 0;
    const slabbed = new Set(['slab', 'roof', 'covering']);
    for (const record of records) {
      const of = record.params.of;
      if (
        record.kind === 'footing' ||
        record.kind === 'ramp' ||
        (record.kind === 'stair' && of !== 'stair') ||
        (record.kind === 'extrusion' && !slabbed.has(String(of))) ||
        (record.kind === 'extrusion' &&
          of === 'slab' &&
          slabKind(record) === 'other' &&
          !/ Landing \d+$/.test(String(record.item.attrs.Name ?? ''))) ||
        (record.kind === 'run' && of !== 'wall' && of !== 'curtainWall')
      )
        bodiesWaiting++;
    }

    flushFocus();

    // ---- 7. What this recipe made before and whose record is gone now. ----
    let removed = 0;
    for (const [sourceKey, madeId] of made) {
      if (!sourceKey.startsWith(`${picked.fileId}:`) || seen.has(sourceKey))
        continue;
      operation.remove(madeId);
      removed++;
    }

    if (operation.length === 0) {
      throw new UpToDate(
        `Up to date: "${picked.name}" holds ${kept} element(s) this recipe already made, ` +
          `${hostedWaiting + bodiesWaiting} waiting on the applier, and nothing is left to remove.`,
      );
    }

    // The run's one line names every kind it writes, not only the first three (Antonio, 17-10).
    const words = [
      levelCount ? `${levelCount} level(s)` : '',
      wallCount ? `${wallCount} wall(s)` : '',
      curtainCount ? `${curtainCount} curtain wall(s)` : '',
      slabMade.floor ? `${slabMade.floor} floor(s)` : '',
      slabMade.foundation ? `${slabMade.foundation} foundation slab(s)` : '',
      slabMade.roof ? `${slabMade.roof} roof(s)` : '',
      slabMade.ceiling ? `${slabMade.ceiling} ceiling(s)` : '',
      stairCount ? `${stairCount} stair(s)` : '',
      columnCount ? `${columnCount} column(s)` : '',
      instanceCount ? `${instanceCount} instance(s)` : '',
      hostedCount ? `${hostedCount} door(s) and window(s)` : '',
      shapeCount ? `${shapeCount} family instance(s)` : '',
      changed ? `${changed} changed` : '',
      removed ? `${removed} gone` : '',
    ].filter(Boolean);
    return {
      title: `${to === 'ifc' ? 'IFC' : 'Model'} to native model: ${words.join(', ')}`,
      verb: operation.summary,
      targets: operation.length,
      payload: new Blob([(await operation.build(context.opId)) as BlobPart]),
      // One per row of `sharedRules`, in its order. Read: what the model holds (what this recipe
      // made before included); written: what this run writes.
      ruleTallies: [
        { read: levels.size, written: levelCount },
        { read: segs.length + wallSkipped, written: wallCount },
        { read: curtainRead, written: curtainCount },
        { read: slabRead.floor + slabRead.foundation, written: slabMade.floor + slabMade.foundation },
        { read: slabRead.roof, written: slabMade.roof },
        { read: slabRead.ceiling, written: slabMade.ceiling },
        { read: stairRead, written: stairCount },
        { read: columnRead, written: columnCount },
        { read: instanceRead + hostedCount, written: instanceCount + hostedCount },
        { read: shaped.length, written: shapeCount },
        { read: removed, written: removed },
        { read: hostedWaiting + bodiesWaiting, written: 0 },
      ],
    };
  };
}

const sharedSchema = {
  type: 'object',
  properties: {
    columnType: {
      type: 'object',
      title: 'Column type',
      // the modelling tool's id of the Columns category: `Category` is a name in the
      // language of whoever installed the modelling tool, and cannot be compared.
      'x-existing': {
        of: 'family-type',
        from: 'target',
        where: { CategoryId: '-2001330' },
      },
    },
    // (Doors and windows hosted in the model's walls: the type each gets, from those the native model has.)
    doorType: {
      type: 'object',
      title: 'Door type',
      'x-existing': { of: 'family-type', from: 'target', where: { CategoryId: '-2000023' } },
    },
    windowType: {
      type: 'object',
      title: 'Window type',
      'x-existing': { of: 'family-type', from: 'target', where: { CategoryId: '-2000014' } },
    },
    trustStyleNames: {
      type: 'boolean',
      title: "Use the model's own style names as Family:Type",
      default: false,
    },
    includeInstances: {
      type: 'boolean',
      title: 'Also bring free-standing instances (needs style names)',
      default: false,
    },
    createLevels: {
      type: 'boolean',
      title: "Carry the model's levels (ensured by name)",
      default: true,
    },
  },
};

// One row per step of the run, in the order of its `ruleTallies` (Antonio, 17-10: the table
// still said stairs, roofs and curtain walls waited, long after the applier built them).
const sharedRules = [
  { reads: 'Levels (datums)', writes: 'The same level in the modelling tool, ensured by name' },
  { reads: 'Wall runs, one per straight segment', writes: 'A native wall: line, type (made from its width when missing), level, height, joins; its edited profile or its top on a roof' },
  { reads: 'Curtain wall runs', writes: "The modelling tool's curtain wall: its grid lines, mullions and panels" },
  { reads: 'Slabs: floors and foundation slabs', writes: 'A native floor or foundation slab from the profile, holes included' },
  { reads: 'Roofs', writes: 'A footprint roof with its sloping edges, or a roof by extrusion for a gable' },
  { reads: 'Ceilings (coverings)', writes: 'A native ceiling from the profile, hung at its drop' },
  { reads: 'Stairs', writes: 'A native stair: a straight or sketched run, with its landings' },
  { reads: 'Column records (members)', writes: 'A native column at each, on its level' },
  { reads: 'Free-standing family instances', writes: 'When turned on: a new instance of the same-named type, placed and turned' },
  { reads: 'Everything else with a body: doors, windows, furniture, fixtures, proxies, columns, railings', writes: "A family made from the file's own shape, one per shape, placed where the file has it (doors and windows in their wall)" },
  { reads: 'Things this recipe made whose record is gone', writes: 'That element removed' },
  { reads: 'Hosted doors/windows with no type to give them, footings, ramps, other bodies', writes: 'Nothing yet - read and counted (hosted doors and windows go in their wall as the Door/Window type chosen)' },
];

const sharedDoc = `
## How to use it

In the modelling tool, with the That Open plugin: **That Open > Select recipe**, pick this
one and its source, then **Update**. It runs there and then: the model
is read, and the modelling tool gets the building in one transaction (Ctrl+Z undoes all of
it). Apply it again whenever the source changes: only the difference is
written. Publish to That Open as usual, and the document's history shows the
step, with the recipe and the version of the source it read.

## What it does

It reads the platform's records and builds in the modelling tool the building they
describe - levels, walls, curtain walls, floors, roofs, ceilings, stairs,
columns and (opting in) free-standing instances, levels first. Everything is
made NATIVELY: real walls on real levels, never imported meshes.

## What it carries per thing

Walls: the location line per straight segment, the type by its exact name
(with its width, so a missing type is created by duplication), the level by
name, base offset, height and which ends join; an edited profile, or a top
attached to a roof. Curtain walls: the modelling tool's own system, its grid lines,
mullions and panels. Floors, foundation slabs and ceilings: the boundary
loops, holes included. Roofs: by footprint with their sloping edges, or by
extrusion for a gable. Stairs: a straight or sketched run, with its landings.
Columns and instances: point, rotation, level, type. Levels: name and
elevation - ENSURED, so a level the model already has is simply used.

## It reconciles, it does not push

Apply it again and it writes only the difference: new records are made, a
changed one is made again from its new version, and one that is gone has its
element removed. It only ever touches what it made itself; elements a person
made in the modelling tool are invisible to it. What it made is remembered with the
model's That Open data.

## What still waits

Hosted doors and windows (the converter does not record their category and
family yet), footings and ramps (the applier does not create them yet). They
are read and counted, and their rule row says so.

## Units and axes

Records are metres and radians, Z up; the modelling tool gets feet and degrees. Types are
matched exactly by name; the modelling tool refuses the whole apply when a loadable type is
missing (system types are created from their width instead).
`;

export const platformModelToNative: Recipe<Settings> = {
  name: 'frag-to-revit',
  title: 'Platform model to native model',
  description:
    'Builds in the modelling tool the platform records of a .frag: levels, walls, curtain walls, floors, roofs, ceilings, stairs, columns, instances.',
  to: 'revit',
  inputs: ['frag-model'],
  source: { kind: 'project-file', extensions: ['frag'] },
  settingsSchema: sharedSchema,
  rules: sharedRules,
  doc: sharedDoc,
  run: sharedRun('frag'),
};

export const ifcToNative: Recipe<Settings> = {
  ...platformModelToNative,
  name: 'ifc-to-revit',
  title: 'IFC to native model',
  description:
    'Builds an IFC of the project in the modelling tool as native elements: levels, walls, floors, roofs, stairs, curtain walls, columns, instances.',
  inputs: ['ifc-model'],
  source: { kind: 'project-file', extensions: ['ifc'] },
  doc:
    `
## Point it at the IFC

It reads the IFC file itself, the version uploaded last. Its first step
converts it into the platform's records - what each element is, not only its
shape - and the modelling tool gets those. Nothing has to be prepared before.
` + sharedDoc,
  run: sharedRun('ifc'),
};
