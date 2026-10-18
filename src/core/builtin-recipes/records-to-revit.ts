/**
 * The platform's own records become Revit change requests: one engine, two
 * recipes. `frag-to-revit` reads a model made or edited here (Designer);
 * `ifc-to-revit` reads the frag an IFC was converted into. Same records,
 * same rules - the only difference is where the file came from, and the
 * recipe saying so to the person.
 *
 * WHOLE BUILDINGS, not demos: levels, walls, curtain walls, stairs, floors,
 * roofs, ceilings, columns and free-standing instances all become proposals,
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
 * resolved to names; proposals are written in Revit's own terms - feet,
 * degrees, types by exact name. Record ids are DOCUMENT-scoped, so every
 * reconcile key carries the source file's id next to them.
 */
import type { Recipe, RecipeContext, RecipeStep } from '../recipes';
import { OperationBuilder } from '../op-builder';
import {
  FEET_PER_METRE,
  innerJson,
  levelsOf,
  readPickedFrag,
  recordsOf,
  stylesOf,
  whatItMadeBefore,
  type PickedFile,
} from './shared';

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
  /** The Revit type proposed columns get, when style names are not trusted. */
  columnType?: RevitType;
  /**
   * Trust the records' own style names: `lookRef` "Family:Type" becomes the
   * proposal's Family and Type verbatim, for columns and instances. Revit
   * matches a type exactly and refuses the whole request when one is missing
   * - right for a model that came FROM this Revit, wrong for anything else.
   * (Walls and floors always go by their style name: system types are named
   * identity, and the applier makes a missing one from the carried width.)
   */
  trustStyleNames?: boolean;
  /** Also propose free-standing family instances (furniture, equipment). Needs trustStyleNames. */
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

function sharedRun(to: 'frag' | 'ifc') {
  return async (context: RecipeContext<Settings>) => {
    const { picked, contents, site } = await readPickedFrag(
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
        'Free-standing instances can only be proposed by their style names: turn trustStyleNames on.',
      );
    }

    const levels = levelsOf(records);
    const styles = stylesOf(records);
    const author = `recipe:${to}-to-revit`;
    const made = await whatItMadeBefore(context, author);
    const head = await context.targetDoc.latest();
    const operation = new OperationBuilder({
      project: context.projectId,
      document: context.targetDoc.docId,
      baseCommit: head?.version ?? 0,
      author,
    });
    // Records are metres; Revit is feet. Plane [x, y] + height is Revit
    // [x, y, z] directly - both are Z up in these records.
    const s = FEET_PER_METRE;
    const key = (recordId: string) => `${picked.fileId}:${recordId}`;
    const seen = new Set<string>();

    /** Adds once per source key; an already-made thing is left alone (kept). */
    let kept = 0;
    const add = (
      sourceKey: string,
      attrs: Record<string, string>,
      placement?: { position?: [number, number, number]; rotationDeg?: number },
    ) => {
      seen.add(sourceKey);
      if (made.has(sourceKey)) {
        kept++;
        return false;
      }
      operation.add(
        sharedFrame ? { ...attrs, Frame: 'shared', ...(sharedAt ? { SharedAt: sharedAt } : {}) } : attrs,
        { ...placement, source: sourceKey },
      );
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

    // ---- 1. Levels: named identity, ensured on the target. ----
    // Counted as PROPOSED only when asked for: one this recipe made before is kept, not proposed
    // (the rules table shows read against proposed - Antonio, 17-10).
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
    interface Seg {
      record: (typeof records)[number];
      i: number;
      from: [number, number];
      to: [number, number];
      width: number;
      joinStart: boolean;
      joinEnd: boolean;
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
      const segments = curves.filter((curve) => curve.kind === 'segment' && curve.from && curve.to);
      wallSkipped += curves.length - segments.length;
      segments.forEach((curve, i) =>
        segs.push({
          record, i, width,
          from: [...curve.from!] as [number, number],
          to: [...curve.to!] as [number, number],
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
          if (b === a || !sameLevel(a, b)) continue;
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

    for (const sg of segs) {
      const { record } = sg;
      const body = innerJson<RunBody>(record, 'run')!;
      const base = typeof body.base === 'number' ? body.base : 0;
      const height = body.height!;
      const level = levels.get(String(body.level ?? record.params.level ?? ''))!;
      const lookRef = record.params.lookRef as string;
      const { from: f, to: e } = extended.get(sg)!;
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
      };
      // Which ends Revit may join: only those that meet another wall where it was authored.
      // Every end the record says meets another wall may join it, moved or not: Revit's cleanup
      // there is part of the wall (racbasic's foundation wall reaches 0.101 m past its line).
      const joins = [f !== sg.from || sg.joinStart ? 'start' : '', e !== sg.to || sg.joinEnd ? 'end' : ''].filter(Boolean);
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
      const profile = (body as { profile?: [number, number][] }).profile;
      if (Array.isArray(profile) && profile.length >= 3 && sg.i === 0 && !segs.some((o) => o !== sg && o.record === record)) {
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
      // Its top attached to a roof (Revit's Attach Top), when that roof is proposed too.
      const attachedTo = record.params.topAttachedTo;
      // ON A ROOF'S TOP FACE (a gable end): Revit attaches a wall to a roof's underside only, and
      // the original is that wall with its profile edited to the gable. So is this one: its
      // outline is the roof's top over its line - each eave, the ridge where the line crosses it.
      const onTop = record.params.topAttachedAt === 'top' || (body as { topAttachedAt?: string }).topAttachedAt === 'top';
      const gable = typeof attachedTo === 'string' && onTop && !attrs.Profile && roofRecords.has(attachedTo) ? gableOf(roofRecords.get(attachedTo)!) : null;
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
      if (typeof attachedTo === 'string' && !attrs.Profile) attrs.AttachTop = key(attachedTo);
      const width = thicknessOf(lookRef);
      if (width) attrs['Type.Width'] = num(width);
      if (add(`${key(record.id)}#${sg.i}`, attrs)) wallCount++;
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
      const halfUp = n(style.uprightWidth) / 2, halfAcross = n(style.horizontalWidth) / 2;
      const L = Math.hypot(seg.to[0] - seg.from[0], seg.to[1] - seg.from[1]);
      const d = [(seg.to[0] - seg.from[0]) / L, (seg.to[1] - seg.from[1]) / L];
      const f = [seg.from[0] - d[0] * halfUp, seg.from[1] - d[1] * halfUp];
      const e = [seg.to[0] + d[0] * halfUp, seg.to[1] + d[1] * halfUp];
      const base = (typeof body.base === 'number' ? body.base : 0) - halfAcross;
      const height = body.height + 2 * halfAcross;
      const z = (level.at + base) * s;
      const along = body.lines?.along ?? ruled(L, n(style.alongSpacing), style.alongJustify);
      const up = body.lines?.up ?? ruled(body.height, n(style.upSpacing), style.upJustify);
      // «horizontal@<up mm>:<along mm>»: the segment of that line starting there is not there.
      const omit = (body.omitted ?? []).flatMap((one) => {
        const m = /^(horizontal|vertical)@(-?[\d.]+):(-?[\d.]+)$/.exec(one);
        if (!m) return [];
        const horizontal = m[1] === 'horizontal';
        const at = Number(m[2]) / 1000 + (horizontal ? halfAcross : halfUp);
        const from = Number(m[3]) / 1000 + (horizontal ? halfUp : halfAcross);
        return [{ horizontal, at: at * s, from: from * s }];
      });
      // «panel@<along mm>,<up mm>»: that cell is no glass (a door stands in it).
      const empty = (body.omitted ?? []).flatMap((one) => {
        const m = /^panel@(-?[\d.]+),(-?[\d.]+)$/.exec(one);
        return m ? [{ along: (Number(m[1]) / 1000 + halfUp) * s, up: (Number(m[2]) / 1000 + halfAcross) * s }] : [];
      });
      const attrs: Record<string, string> = {
        CategoryId: CATEGORY.walls,
        Type: nativeOf(record)?.type ?? String(lookRef),
        LocationLine: `${num(f[0] * s)},${num(f[1] * s)},${num(z)};${num(e[0] * s)},${num(e[1] * s)},${num(z)}`,
        Level: level.name,
        BaseOffset: num(base * s),
        Height: num(height * s),
        Curtain: JSON.stringify({
          along: along.map((a) => (a + halfUp) * s),
          up: up.map((u) => (u + halfAcross) * s),
          omit,
          empty,
          mullion: { width: n(style.uprightWidth) * s, depth: n(style.depth) * s },
          // The glass off the bars' middle: the converter counts it toward the wall's inside,
          // Revit's panel offset toward its outside (measured: racbasic's glass 0.032 m off,
          // on the other side, with the sign as it was).
          panel: { thickness: n(style.panelDepth) * s, offset: -n(style.panelOffset) * s },
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
      if (add(key(record.id), attrs)) curtainCount++;
    }

    // ---- 2c. Stairs: Revit's own, one run each - straight, or sketched where the record has
    // its sketch (winders). Its family is the one its name starts with (assembled, precast,
    // cast in place), its risers as many as its rise needs at its type's riser at most.
    let stairCount = 0;
    let stairRead = 0;
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
      const risers = Math.max(1, Math.ceil(rise / n(style.maxRiser) - 1e-6));
      const tread = n(style.tread);
      const p = (q: [number, number]) => [q[0] * s, q[1] * s];
      const spec: Record<string, unknown> = {
        family: String(lookRef).split(':')[0],
        base: (level.at + n(record.params.base)) * s,
        height: rise * s,
        risers,
        tread: tread * s,
        width: n(style.width) * s,
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
      const sketch = body.sketch;
      if (sketch?.boundary && sketch.boundary.length >= 4 && sketch.risers && sketch.risers.length >= 2) {
        // The outline: its first edge is the first riser; the edge opposite, one tread past the
        // last riser, is the run's end; the edges between are its two sides.
        const b = sketch.boundary;
        const last = sketch.risers[sketch.risers.length - 1];
        const mid = (q: [number, number][]) => [(q[0][0] + q[1][0]) / 2, (q[0][1] + q[1][1]) / 2];
        const lm = mid(last);
        let endEdge = 1, best = Infinity;
        for (let k = 1; k < b.length; k++) {
          const m = mid([b[k], b[(k + 1) % b.length]]);
          const d = Math.abs(Math.hypot(m[0] - lm[0], m[1] - lm[1]) - tread);
          if (d < best) { best = d; endEdge = k; }
        }
        const chain = (from: number, to: number) => {
          const out: number[][][] = [];
          for (let k = from; k !== to; k = (k + 1) % b.length) out.push([p(b[k]), p(b[(k + 1) % b.length])]);
          return out;
        };
        const sides = [...chain(1, endEdge), ...chain((endEdge + 1) % b.length, 0)];
        // Revit counts every riser line as a riser: the end edge is not one (the run ends on a
        // tread), so it goes as the walk line's end only (measured: with it, 17 risers, 3.19 m).
        const riserLines = sketch.risers.map(([a, c]) => [p(a), p(c)]);
        const endLine = [p(b[endEdge]), p(b[(endEdge + 1) % b.length])];
        // The walk line: through every riser's middle, first to last - Revit refuses one that goes
        // on past the last riser ("the path must connect the start and end riser lines").
        void endLine;
        const walk = riserLines.map(([a, c]) => [(a[0] + c[0]) / 2, (a[1] + c[1]) / 2]);
        spec.sketch = { boundary: sides, risers: riserLines, path: walk };
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
      if (add(key(record.id), attrs)) stairCount++;
    }

    // ---- 3. Floors, foundation slabs, roofs and ceilings: slabs by their boundary loops. ----
    // Read and proposed per kind: each is its own row of the rules table.
    const slabRead = { floor: 0, foundation: 0, roof: 0, ceiling: 0 };
    const slabMade = { floor: 0, foundation: 0, roof: 0, ceiling: 0 };
    for (const record of records) {
      const of = record.params.of;
      if (record.kind !== 'extrusion' || (of !== 'slab' && of !== 'roof' && of !== 'covering')) continue;
      const kind = of === 'covering' ? 'ceiling' : of === 'roof' ? 'roof' : slabKind(record);
      if (kind === 'other') continue;
      slabRead[kind]++;
      const body = innerJson<ExtrusionBody>(record, 'extrusion');
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
      const width = thicknessOf(lookRef);
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
        if (kind === 'roof' && Array.isArray(slopes) && slopes.some((x) => typeof x === 'number'))
          attrs.Slopes = JSON.stringify(slopes.map((x) => (typeof x === 'number' ? x : null)));
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

    // ---- 7. What this recipe made before and whose record is gone now. ----
    let removed = 0;
    for (const [sourceKey, madeId] of made) {
      if (!sourceKey.startsWith(`${picked.fileId}:`) || seen.has(sourceKey))
        continue;
      operation.remove(madeId);
      removed++;
    }

    if (operation.length === 0) {
      throw new Error(
        `Nothing new to ask for: "${picked.name}" holds ${kept} element(s) this recipe already made, ` +
          `${hostedWaiting + bodiesWaiting} waiting on the applier, and nothing is left to remove.`,
      );
    }

    // The plan's one line names every kind it proposes, not only the first three (Antonio, 17-10).
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
      removed ? `${removed} gone` : '',
    ].filter(Boolean);
    return {
      title: `${to === 'ifc' ? 'IFC' : 'Model'} to Revit: ${words.join(', ')}`,
      verb: operation.summary,
      targets: operation.length,
      payload: new Blob([(await operation.build(context.opId)) as BlobPart]),
      // One per row of `sharedRules`, in its order. Read: what the model holds (what this recipe
      // made before included); proposed: what this request asks for.
      ruleTallies: [
        { read: levels.size, proposed: levelCount },
        { read: segs.length + wallSkipped, proposed: wallCount },
        { read: curtainRead, proposed: curtainCount },
        { read: slabRead.floor + slabRead.foundation, proposed: slabMade.floor + slabMade.foundation },
        { read: slabRead.roof, proposed: slabMade.roof },
        { read: slabRead.ceiling, proposed: slabMade.ceiling },
        { read: stairRead, proposed: stairCount },
        { read: columnRead, proposed: columnCount },
        { read: instanceRead, proposed: instanceCount },
        { read: removed, proposed: removed },
        { read: hostedWaiting + bodiesWaiting, proposed: 0 },
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
      title: 'Also propose free-standing instances (needs style names)',
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
  { reads: 'Levels (datums)', proposes: 'The same level on the target, ensured by name' },
  { reads: 'Wall runs, one per straight segment', proposes: 'A native wall: line, type (made from its width when missing), level, height, joins; its edited profile or its top on a roof' },
  { reads: 'Curtain wall runs', proposes: "Revit's curtain wall: its grid lines, mullions and panels" },
  { reads: 'Slabs: floors and foundation slabs', proposes: 'A native floor or foundation slab from the profile, holes included' },
  { reads: 'Roofs', proposes: 'A footprint roof with its sloping edges, or a roof by extrusion for a gable' },
  { reads: 'Ceilings (coverings)', proposes: 'A native ceiling from the profile, hung at its drop' },
  { reads: 'Stairs', proposes: 'A native stair: a straight or sketched run, with its landings' },
  { reads: 'Column records (members)', proposes: 'A Revit column at each, on its level' },
  { reads: 'Free-standing family instances', proposes: 'When turned on: a new instance of the same-named type, placed and turned' },
  { reads: 'Things this recipe made whose record is gone', proposes: 'That element removed' },
  { reads: 'Hosted doors/windows, footings, ramps, other bodies', proposes: 'Nothing yet - read and counted' },
];

const sharedDoc = `
## What it does

It reads the platform's records out of a .frag and asks a Revit document for
the building they describe - levels, walls, curtain walls, floors, roofs,
ceilings, stairs, columns and (opting in) free-standing instances, in one
operation, levels first. Nothing changes in
Revit until the owner of that document accepts the request there, and the
applier materialises everything NATIVELY: real walls on real levels, never
imported meshes.

## What it carries per thing

Walls: the location line per straight segment, the type by its exact name
(with its width, so a missing type is created by duplication), the level by
name, base offset, height and which ends join; an edited profile, or a top
attached to a roof. Curtain walls: Revit's own system, its grid lines,
mullions and panels. Floors, foundation slabs and ceilings: the boundary
loops, holes included. Roofs: by footprint with their sloping edges, or by
extrusion for a gable. Stairs: a straight or sketched run, with its landings.
Columns and instances: point, rotation, level, type. Levels: name and
elevation - ENSURED, so a level the target already has is simply used.

## It reconciles, it does not push

Run it again and it asks only for the difference: new records become new
proposals, and a record that is gone asks for its element to be removed. What
it already made is left alone (changing an existing wall through a proposal
is the next step, not this one). It can only ever remove what it asked for
itself; elements a person made in Revit are invisible to it. It keeps nothing
of its own - what it made is read back from its own applied requests.

## What still waits

Hosted doors and windows (the converter does not record their category and
family yet), footings and ramps (the applier does not create them yet). They
are read and counted, and their rule row says so.

## Units and axes

Records are metres and radians, Z up; proposals are written in Revit's feet
and degrees. Types are matched exactly by name; Revit refuses the whole
request when a loadable type is missing (system types are created from their
width instead).
`;

/** The steps a person follows, from nothing to the model in Revit and back here. */
const revitSteps = (source: string): RecipeStep[] => [
  {
    kind: 'app',
    says: 'Open Revit with the That Open plugin.',
    more: 'If the plugin is not installed, get it, install it with Revit closed, and open Revit again.',
  },
  {
    kind: 'connect',
    says: 'Choose the Revit model: the one open in Revit, or one already in this project.',
    more: 'The open one is added as a new document (a new project from any template will do). One of the project is opened in Revit for you.',
  },
  { kind: 'target', says: 'Choose that Revit document.' },
  { kind: 'source', says: source },
  { kind: 'plan', says: 'Plan: see what it will ask Revit for.', more: 'Nothing is written.' },
  { kind: 'queue', says: 'Send the request to Revit.' },
  {
    kind: 'apply',
    says: 'Apply it in Revit.',
    more: 'With the button, or in Revit: That Open > Proposals > Apply. What Revit cannot build is left out and said.',
  },
  { kind: 'see', says: 'See it here.', more: 'Revit syncs it, and the document shows its new version.' },
];

export const fragToRevit: Recipe<Settings> = {
  name: 'frag-to-revit',
  title: 'Platform model to Revit',
  description:
    'Turns the platform records of a .frag - levels, walls, curtain walls, floors, roofs, ceilings, stairs, columns, instances - into change requests for a Revit document.',
  to: 'revit',
  inputs: ['frag-model'],
  source: { kind: 'project-file', extensions: ['frag'] },
  runtime: 'browser',
  settingsSchema: sharedSchema,
  rules: sharedRules,
  steps: revitSteps('Choose the platform model (.frag) to bring in.'),
  doc: sharedDoc,
  run: sharedRun('frag'),
};

export const ifcToRevit: Recipe<Settings> = {
  ...fragToRevit,
  name: 'ifc-to-revit',
  title: 'IFC to Revit',
  description:
    'Turns an IFC, as you uploaded it, into native Revit change requests: levels, walls, floors, roofs, stairs, curtain walls, columns, instances.',
  inputs: ['ifc-model'],
  source: { kind: 'project-file', extensions: ['ifc'] },
  steps: revitSteps('Choose the IFC to bring in.'),
  doc:
    `
## Point it at the IFC

It reads the IFC file itself. Its first step converts it, in this app, into
the platform's records - what each element is, not only its shape - and the
proposals are written from those. Nothing has to be prepared before.
` + sharedDoc,
  run: sharedRun('ifc'),
};
