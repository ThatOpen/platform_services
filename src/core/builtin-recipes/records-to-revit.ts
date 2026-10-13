/**
 * The platform's own records become Revit change requests: one engine, two
 * recipes. `frag-to-revit` reads a model made or edited here (Designer);
 * `ifc-to-revit` reads the frag an IFC was converted into. Same records,
 * same rules - the only difference is where the file came from, and the
 * recipe saying so to the person.
 *
 * WHOLE BUILDINGS, not demos: levels, walls, floors, columns and
 * free-standing instances all become proposals, in that order, in ONE
 * operation - levels first because walls stand on them, by name. The applier
 * materialises each natively (Wall.Create, Floor.Create, Level ensured by
 * name) and makes missing wall/floor types from the carried `Type.Width`.
 * What the applier cannot create yet - stairs, roofs, footings, curtain
 * pieces, hosted doors and windows - is READ and TALLIED, and the rules
 * table says so; those rows light up as the applier grows, without the
 * recipes changing shape.
 *
 * CONVENTIONS, stated once: records are metres and radians, plane [x, y]
 * with height as the third coordinate, levels referenced as `datum:N` and
 * resolved to names; proposals are written in Revit's own terms - feet,
 * degrees, types by exact name. Record ids are DOCUMENT-scoped, so every
 * reconcile key carries the source file's id next to them.
 */
import type { Recipe, RecipeContext } from '../recipes';
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
    const { picked, contents } = await readPickedFrag(
      context,
      context.input as PickedFile | undefined,
    );
    const records = recordsOf(contents.items);
    if (records.length === 0) {
      throw new Error(
        to === 'ifc'
          ? `"${picked.name}" carries no platform records: it was imported without the editable converter. ` +
            'Process the IFC with the editable converter first; a plain import only has IFC attributes, and guessing geometry is not this recipe.'
          : `"${picked.name}" carries no platform records, so there is nothing semantic to convert.`,
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
      operation.add(attrs, { ...placement, source: sourceKey });
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

    // ---- 1. Levels: named identity, ensured on the target. ----
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
        else levelCount++;
      }
    }

    // ---- 2. Walls: one add per straight segment of each wall run. ----
    let wallCount = 0;
    let wallSkipped = 0;
    for (const record of records) {
      if (record.kind !== 'run' || record.params.of !== 'wall') continue;
      const body = innerJson<RunBody>(record, 'run');
      const curves = body?.run?.line?.curves ?? [];
      const base = typeof body?.base === 'number' ? body.base : 0;
      const height = body?.height;
      const level = levels.get(String(body?.level ?? record.params.level ?? ''));
      const lookRef = record.params.lookRef;
      if (typeof lookRef !== 'string' || typeof height !== 'number' || !level) {
        wallSkipped++;
        continue;
      }
      curves.forEach((curve, i) => {
        if (curve.kind !== 'segment' || !curve.from || !curve.to) {
          wallSkipped++;
          return;
        }
        // A run's `base` is RELATIVE to its level (run:0 of racbasic: Level 2 at 3.0 m,
        // base -0.3, built 2.7..9.2), so it is Revit's base offset as it stands.
        const z = (level.at + base) * s;
        const line =
          `${num(curve.from[0] * s)},${num(curve.from[1] * s)},${num(z)};` +
          `${num(curve.to[0] * s)},${num(curve.to[1] * s)},${num(z)}`;
        const attrs: Record<string, string> = {
          CategoryId: CATEGORY.walls,
          Type: nativeOf(record)?.type ?? lookRef,
          LocationLine: line,
          Level: level.name,
          BaseOffset: num(base * s),
          Height: num(height * s),
        };
        // Its top tied to a level, as it was authored: the height then follows the level.
        const top = levels.get(String(record.params.topLevel ?? ''));
        if (top) {
          attrs.TopLevel = top.name;
          attrs.TopOffset = num((level.at + base + height - top.at) * s);
        }
        const width = thicknessOf(lookRef);
        if (width) attrs['Type.Width'] = num(width);
        if (add(`${key(record.id)}#${i}`, attrs)) wallCount++;
      });
    }

    // ---- 3. Floors: slabs by their boundary loops. ----
    let floorCount = 0;
    let floorSkipped = 0;
    for (const record of records) {
      const of = record.params.of;
      if (record.kind !== 'extrusion' || (of !== 'slab' && of !== 'roof' && of !== 'covering')) continue;
      const kind = of === 'covering' ? 'ceiling' : of === 'roof' ? 'roof' : slabKind(record);
      if (kind === 'other') continue;
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
      if (typeof lookRef !== 'string' || !level || !outer) {
        floorSkipped++;
        continue;
      }
      const loops: number[][] = [outer];
      for (const hole of body?.profile?.holes ?? []) {
        const inner = loopOf(hole?.curves);
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
        const slopes = (body as { slopes?: (number | null)[] } | null)?.slopes;
        if (kind === 'roof' && Array.isArray(slopes) && slopes.some((x) => typeof x === 'number'))
          attrs.Slopes = JSON.stringify(slopes.map((x) => (typeof x === 'number' ? x : null)));
      } else if (width) {
        // A slab's `base` is its BOTTOM face, relative to its level; Revit places a floor by its
        // TOP face (height offset from level), and ignores the profile's z.
        attrs.HeightOffset = num(base * s + width);
      }
      if (add(key(record.id), attrs)) floorCount++;
    }

    // ---- 4. Columns (members), by picked type or by style name. ----
    let columnCount = 0;
    for (const record of records) {
      if (record.kind !== 'member' || record.params.of !== 'column') continue;
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
    let hostedWaiting = 0;
    for (const record of records) {
      if (record.kind !== 'familyInstance') continue;
      if (record.params.host) {
        // A hosted door or window needs its category and family recorded by
        // the converter before it can be asked for; counted, not guessed.
        hostedWaiting++;
        continue;
      }
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
    let bodiesWaiting = 0;
    for (const record of records) {
      if (
        record.kind === 'stair' ||
        record.kind === 'footing' ||
        record.kind === 'ramp' ||
        (record.kind === 'extrusion' && record.params.of !== 'slab') ||
        (record.kind === 'run' && record.params.of !== 'wall')
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

    const words = [
      levelCount ? `${levelCount} level(s)` : '',
      wallCount ? `${wallCount} wall(s)` : '',
      floorCount ? `${floorCount} floor(s)` : '',
      columnCount ? `${columnCount} column(s)` : '',
      instanceCount ? `${instanceCount} instance(s)` : '',
      removed ? `${removed} gone` : '',
    ].filter(Boolean);
    return {
      title: `${to === 'ifc' ? 'IFC' : 'Model'} to Revit: ${words.join(', ')}`,
      verb: operation.summary,
      targets: operation.length,
      payload: new Blob([(await operation.build(context.opId)) as BlobPart]),
      ruleTallies: [
        { read: levels.size, proposed: levelCount },
        { read: wallCount + wallSkipped, proposed: wallCount },
        { read: floorCount + floorSkipped, proposed: floorCount },
        { read: columnCount, proposed: columnCount },
        { read: instanceCount, proposed: instanceCount },
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

const sharedRules = [
  { reads: 'Levels (datums)', proposes: 'The same level on the target, ensured by name' },
  { reads: 'Wall runs, one per straight segment', proposes: 'A native wall: curve, type (made from its width when missing), level, height' },
  { reads: 'Slabs with their boundary', proposes: 'A native floor from the profile, holes included' },
  { reads: 'Column records (members)', proposes: 'A Revit column at each, on its level' },
  { reads: 'Free-standing family instances (when turned on)', proposes: 'A new instance of the same-named type, placed and turned' },
  { reads: 'Things this recipe made whose record is gone', proposes: 'That element removed' },
  { reads: 'Hosted doors/windows, stairs, roofs, footings, curtain pieces', proposes: 'Nothing yet - each waits on the applier or the converter growing' },
];

const sharedDoc = `
## What it does

It reads the platform's records out of a .frag and asks a Revit document for
the building they describe - levels, walls, floors, columns and (opting in)
free-standing instances, in one operation, levels first. Nothing changes in
Revit until the owner of that document accepts the request there, and the
applier materialises everything NATIVELY: real walls on real levels, never
imported meshes.

## What it carries per thing

Walls: the location line per straight segment, the type by its exact name
(with its width, so a missing type is created by duplication), the level by
name, base offset and height. Floors: the boundary loops, holes included.
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
family yet), stairs, roofs, footings and curtain walls (the applier does not
create them yet). They are read and counted, and their rule row says so.

## Units and axes

Records are metres and radians, Z up; proposals are written in Revit's feet
and degrees. Types are matched exactly by name; Revit refuses the whole
request when a loadable type is missing (system types are created from their
width instead).
`;

export const fragToRevit: Recipe<Settings> = {
  name: 'frag-to-revit',
  title: 'Platform model to Revit',
  description:
    'Turns the platform records of a .frag - levels, walls, floors, columns, instances - into change requests for a Revit document.',
  to: 'revit',
  inputs: ['frag-model'],
  source: { kind: 'project-file', extensions: ['frag'] },
  runtime: 'browser',
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
    'Turns an IFC - through the frag the platform converted it into - into native Revit change requests: levels, walls, floors, columns, instances.',
  inputs: ['ifc-model'],
  doc:
    `
## Point it at the converted frag

It reads the .frag your IFC was PROCESSED into (the IFC document's view). A
plain IFC import carries only IFC attributes and is refused by name - the
editable converter is what gives an IFC real records.
` + sharedDoc,
  run: sharedRun('ifc'),
};
