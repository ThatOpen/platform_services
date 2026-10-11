/**
 * The platform's own records become Revit change requests: one engine, two
 * recipes. `frag-to-revit` reads a model made or edited here (Designer);
 * `ifc-to-revit` reads the frag an IFC was converted into. Same records,
 * same rules - the only difference is where the file came from, and the
 * recipe saying so to the person.
 *
 * WHAT IT PROPOSES TODAY, honestly: the Revit add-in's applier creates
 * point-placed family instances and edits/removes by id - nothing else yet.
 * So columns (member records) and free-standing family instances become
 * proposals; walls, slabs, stairs and everything with a body are READ and
 * TALLIED but propose nothing, and the rules table says so. As the applier
 * grows (walls and floors by native creation are agreed), rules light up here
 * without the recipes changing shape.
 */
import type { Recipe, RecipeContext } from '../recipes';
import { OperationBuilder } from '../op-builder';
import {
  FEET_PER_METRE,
  innerJson,
  levelNames,
  readPickedFrag,
  recordsOf,
  whatItMadeBefore,
  type OurRecord,
  type PickedFile,
} from './shared';

/** A family type of the target, as the target publishes it. */
interface RevitType {
  categoryId: string;
  family: string;
  type: string;
}

interface Settings {
  /** The Revit type every proposed column gets. */
  columnType?: RevitType;
  /**
   * Trust the records' own style names instead: `lookRef`
   * "Family:Type" becomes the proposal's Family and Type verbatim. Revit
   * matches a type exactly and refuses the whole request when one is missing
   * - right for a model that came FROM this Revit, wrong for anything else.
   */
  trustStyleNames?: boolean;
  /** Also propose free-standing family instances (furniture, equipment). Needs trustStyleNames. */
  includeInstances?: boolean;
}

/** The saved member's inner JSON (`params.member`). */
interface MemberBody {
  of?: string;
  lookRef?: string;
  start?: [number, number, number];
  end?: [number, number, number];
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

const DEGREES = 180 / Math.PI;

/** "Family:Type" as the styles name things; null when it does not split. */
function familyAndType(lookRef: unknown): { family: string; type: string } | null {
  if (typeof lookRef !== 'string') return null;
  const colon = lookRef.indexOf(':');
  if (colon <= 0 || colon === lookRef.length - 1) return null;
  return { family: lookRef.slice(0, colon), type: lookRef.slice(colon + 1) };
}

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
    if (!columnType && !trustStyleNames) {
      throw new Error(
        'Choose the Revit column type, or trust the model style names.',
      );
    }
    if (includeInstances && !trustStyleNames) {
      throw new Error(
        'Free-standing instances can only be proposed by their style names: turn trustStyleNames on.',
      );
    }

    const levels = levelNames(records);
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
    const sourceKey = (record: OurRecord) => `${picked.fileId}:${record.id}`;

    let columns = 0;
    let instances = 0;
    let bodies = 0;
    const seen = new Set<string>();
    const propose = (
      record: OurRecord,
      attrs: Record<string, string>,
      position: [number, number, number],
      rotationDeg: number,
    ) => {
      const key = sourceKey(record);
      seen.add(key);
      const existing = made.get(key);
      if (existing) {
        operation.set(existing, {}, { position, rotationDeg, source: key });
      } else {
        operation.add(attrs, { position, rotationDeg, source: key });
      }
    };

    for (const record of records) {
      if (record.kind === 'member' && record.params.of === 'column') {
        const body = innerJson<MemberBody>(record, 'member');
        const at = body?.start;
        if (!at || at.length !== 3) continue;
        const named = trustStyleNames ? familyAndType(record.params.lookRef) : null;
        // A style name that does not split names nothing proposable.
        if (trustStyleNames && !named) continue;
        const family = named ?? {
          family: columnType!.family,
          type: columnType!.type,
        };
        const level = levels.get(String(body?.level ?? ''));
        propose(
          record,
          {
            ...(columnType && !trustStyleNames
              ? { CategoryId: columnType.categoryId }
              : {}),
            Family: family.family,
            Type: family.type,
            ...(level ? { Level: level } : {}),
          },
          [at[0] * s, at[1] * s, at[2] * s],
          (Number(body?.roll ?? 0) || 0) * DEGREES,
        );
        columns++;
        continue;
      }
      if (
        includeInstances &&
        record.kind === 'familyInstance' &&
        !record.params.host
      ) {
        const body = innerJson<InstanceBody>(record, 'instance');
        const at = body?.placement?.at;
        if (!at || at.length !== 3 || body?.host) continue;
        const named = familyAndType(record.params.type);
        if (!named) continue;
        const right = body?.placement?.right;
        const rotation = right ? Math.atan2(right[1], right[0]) * DEGREES : 0;
        propose(
          record,
          { Family: named.family, Type: named.type },
          [at[0] * s, at[1] * s, at[2] * s],
          rotation,
        );
        instances++;
        continue;
      }
      // Everything with a body the applier cannot create yet: counted, so the
      // person sees what the model holds and what still waits on the applier.
      if (
        record.kind === 'run' ||
        record.kind === 'extrusion' ||
        record.kind === 'stair' ||
        record.kind === 'footing' ||
        record.kind === 'ramp'
      ) {
        bodies++;
      }
    }

    // What this recipe made before and whose record is gone now.
    let removed = 0;
    for (const [key, madeId] of made) {
      if (!key.startsWith(`${picked.fileId}:`) || seen.has(key)) continue;
      operation.remove(madeId);
      removed++;
    }

    if (operation.length === 0) {
      throw new Error(
        `Nothing the Revit applier can do yet: "${picked.name}" has ${bodies} element(s) with a body ` +
          '(walls, slabs, stairs...) and no column or free-standing instance. Those arrive as the applier grows.',
      );
    }

    const words = [
      columns ? `${columns} column(s)` : '',
      instances ? `${instances} instance(s)` : '',
      removed ? `${removed} gone` : '',
    ].filter(Boolean);
    return {
      title: `${to === 'ifc' ? 'IFC' : 'Model'} to Revit: ${words.join(', ')}`,
      verb: operation.summary,
      targets: operation.length,
      payload: new Blob([(await operation.build(context.opId)) as BlobPart]),
      ruleTallies: [
        { read: columns, proposed: columns },
        { read: instances, proposed: instances },
        { read: removed, proposed: removed },
        { read: bodies, proposed: 0 },
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
  },
};

const sharedRules = [
  {
    reads: 'Column records (members) with no proposal yet',
    proposes: 'A new Revit column at each, on its level',
  },
  {
    reads: 'Free-standing family instances (when turned on)',
    proposes: 'A new instance of the same-named type, placed and turned',
  },
  {
    reads: 'Things this recipe made whose record is gone',
    proposes: 'That element removed',
  },
  {
    reads: 'Walls, slabs, stairs and every element with a body',
    proposes: 'Nothing yet - waits on the Revit applier growing',
  },
];

export const fragToRevit: Recipe<Settings> = {
  name: 'frag-to-revit',
  title: 'Platform model to Revit',
  description:
    'Turns the platform records of a .frag into change requests for a Revit document.',
  to: 'revit',
  inputs: ['frag-model'],
  source: { kind: 'project-file', extensions: ['frag'] },
  runtime: 'browser',
  settingsSchema: sharedSchema,
  rules: sharedRules,
  doc: `
## What it does

It reads a .frag made or edited on the platform and asks a Revit document for
the elements its records describe. Nothing changes in Revit until the owner of
that document accepts the request there.

## What it can ask for today

The Revit applier creates point-placed family instances and edits or removes
by id. So columns and (optionally) free-standing instances become proposals;
walls, slabs and stairs are counted and reported, and start proposing the day
the applier learns native creation for them.

## It reconciles, it does not push

Run it again after the model changed and it asks only for the difference. It
can only ever ask to remove what it asked for itself; elements a person made
in Revit are invisible to it. What it made is read back from its own applied
requests - it keeps nothing of its own.

## Units and axes

Records are metres, Z up; proposals are written in Revit's feet. Types are
matched exactly by name; Revit refuses the whole request when one is missing.
`,
  run: sharedRun('frag'),
};

export const ifcToRevit: Recipe<Settings> = {
  ...fragToRevit,
  name: 'ifc-to-revit',
  title: 'IFC to Revit',
  description:
    'Turns an IFC - through the frag the platform converted it into - into change requests for a Revit document.',
  inputs: ['ifc-model'],
  doc: `
## What it does

It reads the .frag your IFC was PROCESSED into (the IFC document's view) and
asks a Revit document for the elements its records describe. Point it at that
frag: a plain IFC import carries only IFC attributes and is refused by name -
the editable converter is what gives an IFC real records.

## What it can ask for today

The Revit applier creates point-placed family instances and edits or removes
by id. So columns and (optionally) free-standing instances become proposals;
walls, slabs and stairs are counted and reported, and start proposing the day
the applier learns native creation for them.

## It reconciles, it does not push

Run it again after a reconversion and it asks only for the difference. It can
only ever ask to remove what it asked for itself. What it made is read back
from its own applied requests - it keeps nothing of its own.

## Units and axes

Records are metres, Z up; proposals are written in Revit's feet. Types are
matched exactly by name; Revit refuses the whole request when one is missing.
`,
  run: sharedRun('ifc'),
};
