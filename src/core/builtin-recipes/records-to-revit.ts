/**
 * The platform's own records become Revit change requests: one engine, two
 * recipes. `frag-to-revit` reads a model made or edited here (Designer);
 * `ifc-to-revit` reads the frag an IFC was converted into. Same records,
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
 * resolved to names; changes are written in Revit's own terms - feet,
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
import { extentAcross, familiesFromShapes, openingsFromShapes, pointsOf as shapePoints, roofOverWall, roomsFromShapes, shapedPanelsOf, wallTopOf } from './shapes-to-families';

/** Revit's own category ids, printed from RevitAPI.dll - never guessed. */
const CATEGORY = {
  levels: '-2000240',
  walls: '-2000011',
  floors: '-2000032',
  roofs: '-2000035',
  ceilings: '-2000038',
  structuralFoundations: '-2001300',
  stairs: '-2000120',
};

/**
 * The native family and type a record's element had where it was authored, when the file says:
 * an IFC exported from Revit names every element "Family:Type:ElementId". A model that came FROM
 * Revit goes back with its own type names; anything else keeps the record's style name.
 */
function nativeOf(record: { item: { attrs: Record<string, string> } }): { family: string; type: string } | null {
  const name = record.item.attrs.Name;
  if (typeof name !== 'string') return null;
  const first = name.indexOf(':');
  const last = name.lastIndexOf(':');
  if (first <= 0 || last <= first) return null;
  const type = name.slice(first + 1, last).trim();
  return type ? { family: name.slice(0, first).trim(), type } : null;
}

/**
 * What a slab record is in Revit, by the family it came from: a floor, a roof made by its
 * footprint, a foundation slab, or something this recipe does not make as a slab (a pad, a stair's
 * landing). Without a native name it is a floor, as before.
 */
function slabKind(record: { item: { attrs: Record<string, string> } }): 'floor' | 'roof' | 'foundation' | 'other' {
  const native = nativeOf(record);
  const predefined = record.item.attrs.PredefinedType;
  if (!native) return 'floor';
  if (/escalera|stair|landing|descansillo/i.test(native.family) || predefined === 'LANDING') return 'other';
  if (/plataforma|^pad\b|building pad/i.test(native.family)) return 'other';
  if (/cubierta|roof/i.test(native.family) || predefined === 'ROOF') return 'roof';
  if (/cimentaci|foundation/i.test(native.family) || predefined === 'BASESLAB') return 'foundation';
  return 'floor';
}

/** A family type of the target, as the target publishes it. */
interface RevitType {
  categoryId: string;
  family: string;
  type: string;
}

interface Settings {
  /** The Revit type columns get, when style names are not trusted. */
  columnType?: RevitType;
  /**
   * Trust the records' own style names: `lookRef` "Family:Type" becomes the
   * change's Family and Type verbatim, for columns and instances. Revit
   * matches a type exactly and refuses the whole request when one is missing
   * - right for a model that came FROM this Revit, wrong for anything else.
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
// high and 6 to 34 mm wide at their foot, and Revit deletes each wall as «line too short»).
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
    // WHICH FRAME THE COORDINATES ARE IN. An IFC exported from Revit in shared coordinates says
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
    // it a new document got racbasic turned 37° and Revit rolled the request back (17-10).
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

    const { columnType, trustStyleNames, includeInstances } = context.settings;
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
    const prints = new Map<string, string>();
    const made = whatItMadeBefore(context, prints);
    context.progress('Writing the changes for Revit');
    const operation = new OperationBuilder({
      project: context.projectId,
      document: context.target.docId ?? '',
      baseCommit: context.target.version ?? 0,
      author,
    });
    // Records are metres; Revit is feet. Plane [x, y] + height is Revit
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
    const add = (
      sourceKey: string,
      attrs: Record<string, string>,
      placement?: { position?: [number, number, number]; rotationDeg?: number; host?: string },
    ) => {
      seen.add(sourceKey);
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
        if (
          add(key(datumId), {
            CategoryId: CATEGORY.levels,
            Name: level.name,
            Elevation: num(level.at * s),
          })
        )
          levelCount++;
      }
    }

    // ---- 2. Walls: one add per straight segment of each wall run. ----
    let wallCount = 0;
    let wallSkipped = 0;
    /** Each wall type's width, as the first wall of it said it (see «one type, one width» below). */
    const wallTypeWidths = new Map<string, number>();
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

    // WHERE A WALL MEETS ANOTHER IT ENDS ON THE OTHER'S LINE, as Revit draws it: the records
    // carry each wall's line cut back to the faces it meets, and say which ends meet (`meetsAt`).
    // Such an end goes back to where its line crosses the line of the wall it meets, and Revit,
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
    const sameLevel = (a: Seg, b: Seg) => {
      const la = innerJson<RunBody>(a.record, 'run'), lb = innerJson<RunBody>(b.record, 'run');
      const za = [la!.base!, la!.base! + la!.height!], zb = [lb!.base!, lb!.base! + lb!.height!];
      const ea = levels.get(String(la?.level ?? a.record.params.level))!.at, eb = levels.get(String(lb?.level ?? b.record.params.level))!.at;
      return Math.min(ea + za[1], eb + zb[1]) > Math.max(ea + za[0], eb + zb[0]); // they overlap in height
    };
    // How far a cut-back end may be from the wall it meets, and travel to reach its line: a
    // metre. A thick wall met at an angle, or one that runs through, leaves the cut further back
    // than a thickness (racbasic's retaining walls: 0.56 m).
    const REACH = 1.0;
    const extended = new Map<Seg, { from: [number, number]; to: [number, number] }>();
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
          if (process.env?.RECIPE_WALL?.split(",").includes(a.record.item.guid ?? "")) console.error(`[cut-by?] ${a.record.item.guid} by ${b.record.item.guid}: off ${off.toFixed(3)}, along ${lo.toFixed(2)}..${hi.toFixed(2)}, shape ${ta}`);
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
    // upright width read 0, so Revit drew no mullion, and 397 of its 1245 members had nothing to be): the median bar
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
      // Revit, joining it, trimmed its ends and moved its neighbours — Savoyvilla's 13 arcs, twins as families, off.)
      let { from: f, to: e } = sg.arcMid ? { from: sg.from, to: sg.to } : extended.get(sg)!;
      // (A stub its joins trimmed to nothing — Savoyvilla 24-10: two 12 cm walls, both ends cut back by half their
      // 12 cm, «LocationLine is missing or not two points» — keeps its own line.)
      if (Math.hypot(e[0] - f[0], e[1] - f[1]) < 0.01) ({ from: f, to: e } = sg);
      // 🔴 A SQUARE END WHERE THE FILE'S SHAPE ENDS, UNJOINED. Which wall runs through a corner is Revit's join order,
      // which the API cannot set (13-10): racbasic's corner walls came out the other way round, 0.2 m long and short.
      // The file's own shape says where each end is; a square end goes exactly there and is left unjoined, so the
      // corner is the file's whatever Revit would choose. A slanted end (a mitre) keeps Revit's join.
      const exact = new Set<string>();
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
            return end.length >= 2 && Math.max(...end) - Math.min(...end) > 0.9 * thick;
          };
          const f0 = f;
          if (square(lo)) { f = [f0[0] + d[0] * lo, f0[1] + d[1] * lo]; exact.add('start'); }
          if (square(hi)) { e = [f0[0] + d[0] * hi, f0[1] + d[1] * hi]; exact.add('end'); }
        }
      }
      // A run's `base` is RELATIVE to its level (run:0 of racbasic: Level 2 at 3.0 m,
      // base -0.3, built 2.7..9.2), so it is Revit's base offset as it stands.
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
      // Which ends Revit may join: only those that meet another wall where it was authored.
      // Every end the record says meets another wall may join it, moved or not: Revit's cleanup
      // there is part of the wall (racbasic's foundation wall reaches 0.101 m past its line).
      const joins = sg.arcMid ? [] : [f !== sg.from || sg.joinStart ? 'start' : '', e !== sg.to || sg.joinEnd ? 'end' : ''].filter((end) => Boolean(end) && !exact.has(end));
      if (joins.length) attrs.JoinEnds = joins.join(',');
      // How each joined end meets: a mitre where the record wants one (Revit's Wall Joins).
      const mitres = joins.filter((end) => record.params[end === 'start' ? 'wantedAtStart' : 'wantedAtEnd'] === 'mitre');
      if (mitres.length) attrs.Mitre = mitres.join(',');
      // (Which wall goes on through a corner is NOT said here: reordering Revit's
      // ElementsAtJoin by the record's cut-back ends left 628523 as it was and broke two
      // more, measured 13-10. Revit's join order still waits for a way to set it.)
      // Its top tied to a level, as it was authored: the height then follows the level.
      const top = levels.get(String(record.params.topLevel ?? ''));
      if (top) {
        attrs.TopLevel = top.name;
        attrs.TopOffset = num((level.at + base + height - top.at) * s);
      }
      // AN ELEVATION THAT IS NOT A RECTANGLE (Revit's Edit Profile, or a top cut by a roof the
      // converter already folded in): the outline, [along, up] from the line's start and the
      // base, laid in the wall's vertical plane. Its first and last stations go where the ends
      // went, so an end extended to a meeting carries the outline with it.
      const given = (body as { profile?: [number, number][] }).profile;
      let profile = Array.isArray(given) ? withoutSlivers(given) : given;
      // 🔴 (A rectangle over its whole line and height says nothing a plain wall does not — and a wall by its outline is
      // one Revit will not mitre nor join: Schependomlaan 24-10, 40 «HSB-element» walls squared at their mitred ends.)
      // (Only where it wants a mitre: elsewhere its outline keeps its ends where the file has them, and as a plain wall
      // Revit trimmed Conference's partitions a thickness short at their joins, 12 walls off, r35.)
      const mitred = record.params.wantedAtStart === 'mitre' || record.params.wantedAtEnd === 'mitre';
      if (mitred && Array.isArray(profile) && profile.length === 4) {
        const L0 = Math.hypot(sg.to[0] - sg.from[0], sg.to[1] - sg.from[1]), h0 = body.height!;
        const at = (v: number, end: number) => (Math.abs(v) < 1e-4 ? 'lo' : Math.abs(v - end) < 1e-3 ? 'hi' : null);
        const corners = profile.map(([a, z]) => [at(a, L0), at(z, h0)]);
        if (corners.every(([a, z]) => a && z) && new Set(corners.map(([a, z]) => `${a}${z}`)).size === 4) profile = undefined;
      }
      if (!sg.arcMid && Array.isArray(profile) && profile.length >= 3 && sg.i === 0 && !segs.some((o) => o !== sg && o.record === record)) {
        const L = Math.hypot(sg.to[0] - sg.from[0], sg.to[1] - sg.from[1]);
        const dir = [(sg.to[0] - sg.from[0]) / L, (sg.to[1] - sg.from[1]) / L];
        const flat: number[] = [];
        // Where the ends went, along the line: an end vertex keeps following its edge that is
        // not upright (a sloped top goes on sloping), or Revit, trimming back to the joint,
        // leaves the slope's end off (racbasic's CL_W1 493612: 3 cm at each end).
        const ext0 = -((f[0] - sg.from[0]) * dir[0] + (f[1] - sg.from[1]) * dir[1]);
        const ext1 = (e[0] - sg.to[0]) * dir[0] + (e[1] - sg.to[1]) * dir[1];
        profile.forEach(([a, up], k) => {
          const atStart = Math.abs(a) < 1e-6, atEnd = Math.abs(a - L) < 1e-6;
          let along = a, height = up;
          if (atStart || atEnd) {
            along = atStart ? -ext0 : L + ext1;
            const sloped = [profile[(k - 1 + profile.length) % profile.length], profile[(k + 1) % profile.length]]
              .find(([b]) => Math.abs(b - a) > 1e-6);
            if (sloped) height = up + ((sloped[1] - up) / (sloped[0] - a)) * (along - a);
          }
          const p = [sg.from[0] + along * dir[0], sg.from[1] + along * dir[1]];
          flat.push(p[0] * s, p[1] * s, (level.at + base + height) * s);
        });
        attrs.Profile = JSON.stringify([flat]);
        delete attrs.TopLevel;
        delete attrs.TopOffset;
      }
      // Its top attached to a roof (Revit's Attach Top), when that roof is made too.
      const attachedTo = record.params.topAttachedTo;
      // ON A ROOF'S TOP FACE (a gable end): Revit attaches a wall to a roof's underside only, and
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
      // 🔴 ITS TOP AS ITS SHAPE DRAWS IT, when nothing above said it (an edited profile Revit exported as polygonal
      // openings with nothing in them: racbasic's 530178, 6.3 m³ for 1.2; see `wallTopOf`).
      if (!attrs.Profile && !attrs.AttachTop && shapeOfWall) {
        // (Its whole outline first, when nothing is hosted in it and the outline is the wall: a top read alone stands
        // on a flat foot, and Savoyvilla's wall beside the ramp, cut from below by it, came 7.7 m³ for 3.6, 24-10.)
        const hostedIn = [...shapes!.elements.values()].filter((o) => o.host === record.item.guid && !/^IFCOPENINGELEMENT$/i.test(o.ifcClass));
        let whole = wallTopOf(shapes!, record.item.guid!, f, e, true);
        // (Never an edge of millimetres — Schependomlaan's balcony upstands, «la línea es demasiado corta», and Revit
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
            // (Any of them in it at all: a hole two windows share, cut as a rectangle, and Revit deleted both — racbasic
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
          const flat: number[] = [];
          const loopOf = (loop: [number, number][]) => loop.flatMap(([along, z]) => [(f[0] + along * dir[0]) * s, (f[1] + along * dir[1]) * s, (z - shapeDz) * s]);
          attrs.Profile = JSON.stringify([loopOf(whole.outline), ...(whole.holes ?? []).map(loopOf)]);
          delete attrs.TopLevel;
          delete attrs.TopOffset;
          pieceProfiles = (whole.pieces ?? []).map((p) => JSON.stringify([loopOf(p)]));
        }
      } else if (attrs.Profile && shapeOfWall && !attrs.AttachTop) {
        // 🔴 A PROFILE THE CONVERTER GAVE, AND THE HOLES ITS FACE SHOWS (racbasic 24-10: a SIP gable wall that is mostly
        // one pentagonal window, 6.3 m³ for 1.2: the gable came, the window, a non-rectangular opening, never did).
        // Only for a wall whose hosted things are empty openings; the applier cuts what Revit's outline will not take.
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
            if (process.env?.RECIPE_WALL?.split(",").includes(record.item.guid ?? "")) console.error(`[arc-bands] ${JSON.stringify({ b0, bm, b1, sag, spread })}`);
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
      // one-layer type has not; racbasic's partitions 6 cm off the original everywhere, 21-10). Revit lists them
      // from the exterior, the side left of the line; the file stacks them from the line's right, and a usage
      // against its axis is the same type flipped (one type for every wall of it, as in Revit).
      const declared = record.item.guid ? shapes?.elements.get(record.item.guid) : undefined;
      if (declared?.layers && declared.layers.length > 1) {
        attrs['Type.Layers'] = JSON.stringify([...declared.layers].reverse().map((l) => [+num(l.thickness * s), l.material ?? '', l.function ?? '']));
        if (declared.layersFlipped) attrs.FlipLayers = '1';
      }
      if (typeof process !== 'undefined' && process.env?.RECIPE_WALL?.split(",").includes(record.item.guid ?? "")) console.error(`[wall-attrs] ${JSON.stringify(attrs).slice(0, 1500)}`);
      if (add(`${key(record.id)}#${sg.i}`, attrs)) wallCount++;
      // Its other pieces (a wall the file cut through, top to bottom), each a wall of the same type by its outline.
      pieceProfiles.forEach((profile, k) => { if (add(`${key(record.id)}#${sg.i}p${k + 1}`, { ...attrs, Profile: profile })) wallCount++; });
    }

    // ---- 2b. Curtain walls: Revit's own system, its grid line by line. ----
    // A run of the converter spans the curtain wall INSIDE its border bars: half a bar short at
    // each end, at the bottom and at the top (measured on racbasic: every wall 0.04 m short and
    // 0.04 m low, its lines 0.02 m early, against Revit's own). Revit's wall spans the bars'
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
      const measured = n(style.uprightWidth) > 0 ? null : mullionOf(record.item.guid, d);
      const halfUp = (n(style.uprightWidth) || (measured ? measured.width / s : 0)) / 2;
      const halfAcross = (n(style.horizontalWidth) || (measured ? measured.width / s : 0)) / 2;
      // 🔴 A SIDE WITH NO BAR (Savoyvilla 24-10: its entrance glass has none at its foot, Revit's type a bar on every
      // side: the panels 25 mm high, the uprights 25 mm low): the sides whose border the file's own members do not run
      // along, not grown by half a bar and their border bars taken away. Only for a wall the file gives members for,
      // and not one by its outline.
      const bare = { start: false, end: false, bottom: false, top: false };
      if (shapes && record.item.guid && !Array.isArray((body as { profile?: unknown }).profile)) {
        const kids = [...shapes.elements.values()].filter((el) => el.parent === record.item.guid);
        const boxOf = (gid: string) => {
          const pts = shapePoints(shapes, gid);
          if (!pts.length) return null;
          const t = pts.map((p) => (p[0] - seg.from![0]) * d[0] + (p[1] - seg.from![1]) * d[1]), zz = pts.map((p) => p[2]);
          return { t0: Math.min(...t), t1: Math.max(...t), z0: Math.min(...zz), z1: Math.max(...zz) };
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
      const along = body.lines?.along ?? ruled(L, n(style.alongSpacing), style.alongJustify);
      const up = body.lines?.up ?? ruled(body.height, n(style.upSpacing), style.upJustify);
      // «horizontal@<up mm>:<along mm>»: the segment of that line starting there is not there.
      const omit = (body.omitted ?? []).flatMap((one) => {
        const m = /^(horizontal|vertical)@(-?[\d.]+):(-?[\d.]+)$/.exec(one);
        if (!m) return [];
        const horizontal = m[1] === 'horizontal';
        const at = Number(m[2]) / 1000 + (horizontal ? b0 : g0);
        const from = Number(m[3]) / 1000 + (horizontal ? g0 : b0);
        return [{ horizontal, at: at * s, from: from * s }];
      });
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
      const attrs: Record<string, string> = {
        CategoryId: CATEGORY.walls,
        Type: nativeOf(record)?.type ?? String(lookRef),
        LocationLine: `${num(f[0] * s)},${num(f[1] * s)},${num(z)};${num(e[0] * s)},${num(e[1] * s)},${num(z)}`,
        Level: level.name,
        BaseOffset: num(base * s),
        Height: num(height * s),
        Curtain: JSON.stringify({
          along: along.map((a) => (a + g0) * s),
          up: up.map((u) => (u + b0) * s),
          omit,
          empty,
          ...(noBorders ? { noBorders: true } : {}),
          mullion: n(style.uprightWidth) > 0 ? { width: n(style.uprightWidth) * s, depth: n(style.depth) * s } : measured ?? { width: 0, depth: n(style.depth) * s },
          // The glass off the bars' middle: the converter counts it toward the wall's inside,
          // Revit's panel offset toward its outside (measured: racbasic's glass 0.032 m off,
          // on the other side, with the sign as it was).
          panel: { thickness: glassOf(record.item.guid, d) ?? n(style.panelDepth) * s, offset: -n(style.panelOffset) * s },
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

    // ---- 2c. Stairs: Revit's own, one run each - straight, or sketched where the record has
    // its sketch (winders). Its family is the one its name starts with (assembled, precast,
    // cast in place), its risers as many as its rise needs at its type's riser at most.
    let stairCount = 0;
    let stairRead = 0;
    // 🔴 ITS WIDTH OFF ITS SHAPE, when its style says none (Conference Center 24-10: the grand stair's two runs came
    // with width 0, «Curve length is too small for Revit's tolerance», not made): the span of its own shape and its
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
      // (A style with no maximum riser: as many as the sketch draws, else Revit's 18 cm. BLOXHUB 24-10: rise / 0, an
      // Infinity that went as null, «could not be converted to Int32», a stair of nothing.)
      const maxRiser = n(style.maxRiser) > 0 ? n(style.maxRiser) : body.sketch?.risers?.length ? rise / (body.sketch.risers.length + 1) : 0.18;
      const risers = Math.max(1, Math.ceil(rise / maxRiser - 1e-6));
      const tread = n(style.tread);
      const p = (q: [number, number]) => [q[0] * s, q[1] * s];
      const spec: Record<string, unknown> = {
        family: String(lookRef).split(':')[0],
        base: (level.at + n(record.params.base)) * s,
        height: rise * s,
        risers,
        tread: tread * s,
        width: (n(style.width) > 0 ? n(style.width) : widthOfStair(record.item.guid, body.start, body.end) ?? 0) * s,
        // 🔴 ENDING ON A RISER, when its own shape stops a riser under its rise (DACH 24-10: two flights and a landing,
        // the first a tread too long and a riser too high — the landing is that tread).
        endsWithRiser: (() => {
          if (!shapes || !record.item.guid) return false;
          const pts = shapePoints(shapes, record.item.guid);
          if (pts.length < 4) return false;
          const top = Math.max(...pts.map((q) => q[2])) - shapeDz, full = level.at + n(record.params.base) + rise;
          return full - top > 0.5 * (rise / risers) && full - top < 1.5 * (rise / risers);
        })(),
        // Its type's sizes, as the style has them: Revit keeps the risers under the type's
        // maximum (racbasic: a 180 mm template type gave a 3.0 m stair a riser more, 3.22 m).
        sizes: {
          maxRiser: Math.ceil((rise / risers) * 1000 - 1e-6) / 1000 * s,
          minTread: tread * s,
          waist: n(style.waist) * s,
          treadThickness: n(style.treadThickness) * s,
          riserThickness: n(style.riserThickness) * s,
          notchExtension: n(style.notchExtension) * s,
          notchThickness: n(style.notchThickness) * s,
        },
      };
      if (typeof process !== 'undefined' && process.env?.RECIPE_TRACE) console.error(`[stair-end] ${record.item.guid} ${record.item.name ?? ''}: ${risers} risers, ends with riser ${spec.endsWithRiser}`);
      const sketch = body.sketch;
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
        // Revit counts every riser line as a riser: the end edge is not one (the run ends on a
        // tread), so it goes as the walk line's end only (measured: with it, 17 risers, 3.19 m).
        const riserLines = sketch.risers.map(([a, c]) => [p(a), p(c)]);
        const endLine = [p(b[endEdge]), p(b[(endEdge + 1) % b.length])];
        // The walk line: through every riser's middle, first to last - Revit refuses one that goes
        // on past the last riser ("the path must connect the start and end riser lines").
        void endLine;
        const walk = riserLines.map(([a, c]) => [(a[0] + c[0]) / 2, (a[1] + c[1]) / 2]);
        spec.sketch = { boundary: sides, risers: riserLines, path: walk };
        if (typeof process !== 'undefined' && process.env?.RECIPE_TRACE) {
          const len = (q: number[][]) => Math.hypot(q[1][0] - q[0][0], q[1][1] - q[0][1]) / s;
          console.error(`[stair] ${record.item.guid} ${record.item.name ?? ''}: ${sides.length} sides (shortest ${(Math.min(...sides.map(len)) * 1000).toFixed(2)} mm), ${riserLines.length} risers (shortest ${(Math.min(...riserLines.map(len)) * 1000).toFixed(2)} mm), walk ${walk.length} points (shortest step ${(Math.min(...walk.slice(1).map((q, k) => len([walk[k], q]))) * 1000).toFixed(2)} mm)`);
        }
        // Its going is what the riser lines say, the shortest between two in a row that are
        // parallel; the style's (racbasic: 0.375 against Revit's 0.25) is the winders' too.
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
        }
      } else {
        spec.path = [p([body.start[0], body.start[1]]), p([body.end[0], body.end[1]])];
        // (A style with no tread: its path by its risers. Conference's grand stair, «7" max riser 11" tread», came
        // with tread 0, its riser lines on one another, «curve too short»: 5.588 m / 20 = 0.2794 m, its 11".)
        if (!(tread > 0)) {
          const going = Math.hypot(body.end[0] - body.start[0], body.end[1] - body.start[1]) / risers;
          spec.tread = going * s;
          (spec.sizes as Record<string, number>).minTread = going * s;
        }
        if (typeof process !== 'undefined' && process.env?.RECIPE_TRACE) console.error(`[stair] ${record.item.guid} ${record.item.name ?? ''}: straight, ${Math.hypot(body.end[0] - body.start[0], body.end[1] - body.start[1]).toFixed(3)} m, rise ${rise}, ${risers} risers, width ${n(style.width)}, measured ${widthOfStair(record.item.guid, body.start, body.end)}`);
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
      if (typeof process !== 'undefined' && process.env?.RECIPE_STAIR === record.item.guid) console.error(`[stair-spec] ${attrs.Stairs}`);
      if (add(key(record.id), attrs)) stairCount++;
    }

    // ---- 3. Floors, foundation slabs, roofs and ceilings: slabs by their boundary loops. ----
    // Read and written per kind: each is its own row of the rules table.
    const slabRead = { floor: 0, foundation: 0, roof: 0, ceiling: 0 };
    const slabMade = { floor: 0, foundation: 0, roof: 0, ceiling: 0 };
    for (const record of records) {
      const of = record.params.of;
      if (record.kind !== 'extrusion' || (of !== 'slab' && of !== 'roof' && of !== 'covering')) continue;
      const kind = of === 'covering' ? 'ceiling' : of === 'roof' ? 'roof' : slabKind(record);
      if (kind === 'other') continue;
      // 🔴 A RAMP IS NO FLOOR: Revit makes no ramp through its API, and a ramp's sloped flight as a floor came to nothing
      // (Savoyvilla 24-10: its 4 flights missing, BLOXHUB's made from their shapes all twins). Left to its shape.
      if (shapes && record.item.guid && /^IFCRAMP(FLIGHT)?$/i.test(shapes.elements.get(record.item.guid)?.ifcClass ?? '')) continue;
      slabRead[kind]++;
      const body = innerJson<ExtrusionBody>(record, 'extrusion');
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
      const outer = loopOf(body?.profile?.outline?.curves);
      if (typeof lookRef !== 'string' || !level || !outer) continue;
      const loops: number[][] = [outer];
      // A gable's holes lie ON its face, each corner at the slope's height there: Revit cuts a
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
      const cuts = (body as { cuts?: { outline?: number[][]; through?: number[] }[] } | null)?.cuts ?? [];
      for (const cut of cuts) {
        const t = cut.through, o = cut.outline;
        if (!Array.isArray(o) || o.length < 3 || !Array.isArray(t) || Math.abs(t[2]) < 0.99 * Math.hypot(t[0], t[1], t[2])) continue;
        const pts = o.filter((p, k) => k === 0 || Math.hypot(p[0] - o[k - 1][0], p[1] - o[k - 1][1]) > 1e-4);
        if (pts.length > 3 && Math.hypot(pts[0][0] - pts[pts.length - 1][0], pts[0][1] - pts[pts.length - 1][1]) < 1e-4) pts.pop();
        if (pts.length < 3) continue;
        // (Only one wholly inside its outline: a hole across its edge, and Revit refuses the whole floor.)
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
        const clashes = loops.slice(1).some((l) => { const b = box(flatPts(l)); return mine[0] < b[2] + 0.01 && b[0] < mine[2] + 0.01 && mine[1] < b[3] + 0.01 && b[1] < mine[3] + 0.01; });
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
      }
      if (width) attrs['Type.Width'] = num(width);
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
          // 🔴 ITS BASE IS THE TOP AT THE EAVES (measured below), and Revit's footprint roof stands on its bottom there:
          // down by its thickness measured plumb, t·√(1+p²) (DACH: all 15 sloped roofs 0.17 m off their slope, 23-10).
          const p = Math.max(...slopes.filter((x): x is number => typeof x === 'number').map((x) => Math.abs(x)));
          if (width && p > 0) attrs.BaseOffset = num(base * s - width * Math.sqrt(1 + p * p));
          if (typeof process !== 'undefined' && process.env?.RECIPE_TRACE) console.error(`[roof] ${record.item.guid} ${lookRef}: slopes ${JSON.stringify(slopes)} base ${base} width ${width} edges ${loops[0] ? loops[0].length / 3 : 0} profile ${JSON.stringify(loops[0]?.map((v) => +v.toFixed(2)))}`);
        }
        // A GABLE - four edges, two opposite ones sloping - is Revit's ROOF BY EXTRUSION: its
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
      } else if (width) {
        // A slab's `base` is its BOTTOM face, relative to its level; Revit places a floor by its
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
          if (hi - lo > 1e-3) {
            attrs.Slope = num(slope.by);
            attrs.SlopeArrow = JSON.stringify([tail[0] * s, tail[1] * s, (tail[0] + d[0] * (hi - lo)) * s, (tail[1] + d[1] * (hi - lo)) * s]);
            attrs.HeightOffset = num(base * s + width - slope.by * (hi - lo) * s);
          }
        }
      }
      if (add(key(record.id), attrs)) slabMade[kind]++;
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
    for (const record of records) {
      if (record.kind !== 'familyInstance') continue;
      if (record.params.host) {
        // A hosted door or window needs its category and family recorded by
        // the converter before it can be asked for; counted, not guessed.
        hostedWaiting++;
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

    // ---- 5b. Everything else with a body, as FAMILIES made from the file's own shapes. ----
    // 🔴 (Antonio, 21-10: «llegar al 100 %… comparar el brep o la mesh y que sea igual… definiendo familias»).
    // Whatever no step above builds natively (doors and windows, furniture, fixtures, proxies, columns, railings,
    // the parts of nothing written) is a family: one per shape, defined from the file's own geometry in the
    // element's frame, placed where the file has each. Doors and windows in the wall whose opening they fill.
    if (shapedPanels.size && typeof process !== 'undefined' && process.env?.RECIPE_TRACE) console.error(`[shaped-panels] ${shapedPanels.size} curtain panel(s) made as families of their shape`);
    const shaped = shapes ? familiesFromShapes(shapes, seen, picked.fileId, shapedPanels) : [];
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
    // The openings nothing fills, cut in their walls (Revit's Wall Opening): racbasic's kitchen niche left its
    // timber wall twice the IFC's volume (21-10).
    if (shapes) {
      for (const o of openingsFromShapes(shapes, seen, picked.fileId)) {
        add(o.key, { WallOpening: o.box.map((v, i) => num((i % 3 === 2 ? v - shapeDz : v) * s)).join(','), ...(made.get(o.host) ? { HostMade: made.get(o.host)! } : {}) }, { host: o.host });
      }
    }
    // The rooms, last: each where its space's floor is, bounded by the walls as Revit bounds a room (21-10: the
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
      shapeCount ? `${shapeCount} family instance(s)` : '',
      changed ? `${changed} changed` : '',
      removed ? `${removed} gone` : '',
    ].filter(Boolean);
    return {
      title: `${to === 'ifc' ? 'IFC' : 'Model'} to Revit: ${words.join(', ')}`,
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
        { read: instanceRead, written: instanceCount },
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
      // Revit's id of the Columns category: `Category` is a name in the
      // language of whoever installed Revit, and cannot be compared.
      'x-existing': {
        of: 'family-type',
        from: 'target',
        where: { CategoryId: '-2001330' },
      },
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
  { reads: 'Levels (datums)', writes: 'The same level in Revit, ensured by name' },
  { reads: 'Wall runs, one per straight segment', writes: 'A native wall: line, type (made from its width when missing), level, height, joins; its edited profile or its top on a roof' },
  { reads: 'Curtain wall runs', writes: "Revit's curtain wall: its grid lines, mullions and panels" },
  { reads: 'Slabs: floors and foundation slabs', writes: 'A native floor or foundation slab from the profile, holes included' },
  { reads: 'Roofs', writes: 'A footprint roof with its sloping edges, or a roof by extrusion for a gable' },
  { reads: 'Ceilings (coverings)', writes: 'A native ceiling from the profile, hung at its drop' },
  { reads: 'Stairs', writes: 'A native stair: a straight or sketched run, with its landings' },
  { reads: 'Column records (members)', writes: 'A Revit column at each, on its level' },
  { reads: 'Free-standing family instances', writes: 'When turned on: a new instance of the same-named type, placed and turned' },
  { reads: 'Everything else with a body: doors, windows, furniture, fixtures, proxies, columns, railings', writes: "A family made from the file's own shape, one per shape, placed where the file has it (doors and windows in their wall)" },
  { reads: 'Things this recipe made whose record is gone', writes: 'That element removed' },
  { reads: 'Hosted doors/windows, footings, ramps, other bodies', writes: 'Nothing yet - read and counted' },
];

const sharedDoc = `
## How to use it

In Revit, with the That Open plugin: **That Open > Select recipe**, pick this
one and its source, then **Update**. It runs there and then: the model
is read, and Revit gets the building in one transaction (Ctrl+Z undoes all of
it). Apply it again whenever the source changes: only the difference is
written. Publish to That Open as usual, and the document's history shows the
step, with the recipe and the version of the source it read.

## What it does

It reads the platform's records and builds in Revit the building they
describe - levels, walls, curtain walls, floors, roofs, ceilings, stairs,
columns and (opting in) free-standing instances, levels first. Everything is
made NATIVELY: real walls on real levels, never imported meshes.

## What it carries per thing

Walls: the location line per straight segment, the type by its exact name
(with its width, so a missing type is created by duplication), the level by
name, base offset, height and which ends join; an edited profile, or a top
attached to a roof. Curtain walls: Revit's own system, its grid lines,
mullions and panels. Floors, foundation slabs and ceilings: the boundary
loops, holes included. Roofs: by footprint with their sloping edges, or by
extrusion for a gable. Stairs: a straight or sketched run, with its landings.
Columns and instances: point, rotation, level, type. Levels: name and
elevation - ENSURED, so a level the model already has is simply used.

## It reconciles, it does not push

Apply it again and it writes only the difference: new records are made, a
changed one is made again from its new version, and one that is gone has its
element removed. It only ever touches what it made itself; elements a person
made in Revit are invisible to it. What it made is remembered with the
model's That Open data.

## What still waits

Hosted doors and windows (the converter does not record their category and
family yet), footings and ramps (the applier does not create them yet). They
are read and counted, and their rule row says so.

## Units and axes

Records are metres and radians, Z up; Revit gets feet and degrees. Types are
matched exactly by name; Revit refuses the whole apply when a loadable type is
missing (system types are created from their width instead).
`;

export const fragToRevit: Recipe<Settings> = {
  name: 'frag-to-revit',
  title: 'Platform model to Revit',
  description:
    'Builds in Revit the platform records of a .frag: levels, walls, curtain walls, floors, roofs, ceilings, stairs, columns, instances.',
  to: 'revit',
  inputs: ['frag-model'],
  source: { kind: 'project-file', extensions: ['frag'] },
  settingsSchema: sharedSchema,
  rules: sharedRules,
  doc: sharedDoc,
  run: sharedRun('frag'),
};

export const ifcToRevit: Recipe<Settings> = {
  ...fragToRevit,
  name: 'ifc-to-revit',
  title: 'IFC to Revit',
  description:
    'Builds an IFC of the project in Revit as native elements: levels, walls, floors, roofs, stairs, curtain walls, columns, instances.',
  inputs: ['ifc-model'],
  source: { kind: 'project-file', extensions: ['ifc'] },
  doc:
    `
## Point it at the IFC

It reads the IFC file itself, the version uploaded last. Its first step
converts it into the platform's records - what each element is, not only its
shape - and Revit gets those. Nothing has to be prepared before.
` + sharedDoc,
  run: sharedRun('ifc'),
};
