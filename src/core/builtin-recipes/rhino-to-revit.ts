/**
 * A Rhino layer becomes Revit family instances: the built-in form of the one
 * conversion proven end to end (flow, 2026-07-30). Each object of the chosen
 * layer that declares a `Position` asks for an instance of the chosen Revit
 * type where it stands - the porch colonnade: Rhino drives WHERE, Revit owns
 * WHAT.
 */
import { UpToDate, type Recipe, type RecipeContext } from '../recipes';
import { OperationBuilder } from '../op-builder';
import type { FragItem } from '../frag-items';
import {
  FEET_PER_METRE,
  readPickedFrag,
  whatItMadeBefore,
  type PickedFile,
} from './shared';
import { familiesFromShapes } from './shapes-to-families';

/** What each unit name means in metres. Read from the source, never assumed. */
const METRES_PER_UNIT: Record<string, number> = {
  millimeters: 0.001,
  millimetres: 0.001,
  mm: 0.001,
  centimeters: 0.01,
  centimetres: 0.01,
  cm: 0.01,
  meters: 1,
  metres: 1,
  m: 1,
  inches: 0.0254,
  in: 0.0254,
  feet: 0.3048,
  ft: 0.3048,
};

/** A family type of the target, as the target publishes it. */
interface RevitType {
  categoryId: string;
  family: string;
  type: string;
}

interface Settings {
  /** The Rhino layer that drives placement. */
  layer: string;
  /**
   * The Revit type every placed object becomes. Unsaid: each object is made as a family of its own shape (one per
   * shape; a prism, one per profile with its length an instance parameter), standing where Rhino has it.
   */
  instanceType?: RevitType;
}

const NAME = 'rhino-to-revit';
const AUTHOR = `recipe:${NAME}`;

/** `Position` is "x,y,z" in the publisher's own units. */
function positionOf(item: FragItem): [number, number, number] | null {
  const parts = (item.attrs.Position ?? '')
    .split(',')
    .map((part) => Number(part.trim()));
  if (parts.length !== 3 || parts.some((v) => !Number.isFinite(v))) return null;
  return [parts[0], parts[1], parts[2]];
}

export const rhinoToRevit: Recipe<Settings> = {
  name: NAME,
  title: 'Rhino to Revit',
  description:
    'Places in Revit an instance of a chosen type at each placed object of a Rhino layer.',
  to: 'revit',
  inputs: ['rhino-model'],
  source: { kind: 'project-file', extensions: ['frag'] },
  settingsSchema: {
    type: 'object',
    properties: {
      layer: {
        type: 'string',
        title: 'Rhino layer',
        'x-existing': { of: 'layer', from: 'source' },
      },
      instanceType: {
        type: 'object',
        title: 'Revit type',
        'x-existing': { of: 'family-type', from: 'target' },
      },
    },
    required: ['layer'],
  },
  rules: [
    {
      reads: 'Objects on the chosen layer with no instance yet',
      writes: 'A new instance of the chosen type at each',
    },
    {
      reads: 'Objects whose instance already exists',
      writes: 'That instance moved to where the object is now',
    },
    {
      reads: 'Instances whose object is gone from Rhino',
      writes: 'That instance removed',
    },
    { reads: 'Everything on other layers', writes: 'Nothing' },
  ],
  doc: `
## What it does

It reads a model published from Rhino and places in Revit instances of one
type: one where each placed object of a layer stands. It never touches the
Rhino model. In Revit: That Open > Select recipe, then Update.

## It reconciles, it does not push

Apply it again after the Rhino model changed and it writes only the
difference: new objects become new instances, moved objects move theirs, and
an object that is gone has its instance removed. It only ever removes an
instance it made itself - elements a person made in Revit are invisible to
it. What it made is remembered with the model's That Open data.

## What it assumes

- The Rhino model declares its units. One that does not is refused, not guessed.
- Both models are Z up. A different axis convention is refused.
- The Revit type exists in the target. Revit matches a type exactly and
  refuses the whole apply when one is missing.

## What it does not know

Where an object becomes an instance, Revit decides the level: the nearest one
at or below the point. For a level-based family the level wins over the
point's height.
`,

  async run(context: RecipeContext<Settings>) {
    const { layer, instanceType } = context.settings;
    if (!layer) throw new Error('Choose the layer.');
    const { picked, contents, shapes } = await readPickedFrag(
      context,
      context.input as PickedFile | undefined,
      { shapes: !instanceType },
    );
    if (!instanceType && !shapes)
      throw new Error('Choose the Revit type: this app cannot read the shapes of the Rhino model to make its own families.');

    // Refused rather than guessed: a length read in the wrong unit is off by
    // a thousand and still looks plausible.
    const data = contents.metadata?.data as
      | { units?: unknown; axes?: unknown }
      | undefined;
    const declared = data?.units;
    const metres =
      typeof declared === 'string'
        ? METRES_PER_UNIT[declared.trim().toLowerCase()]
        : undefined;
    if (!metres) {
      throw new Error(
        `"${picked.name}" does not say what units its data is in` +
          `${declared ? ` ("${String(declared)}" is not one this recipe knows)` : ''}, so nothing can be converted from it.`,
      );
    }
    const axes = String(data?.axes ?? 'z-up').toLowerCase();
    if (axes !== 'z-up') {
      throw new Error(
        `"${picked.name}" declares its data as "${axes}"; this recipe only converts Z up.`,
      );
    }
    const scale = metres * FEET_PER_METRE;

    const made = whatItMadeBefore(context);
    const operation = new OperationBuilder({
      project: context.projectId,
      document: context.target.docId ?? '',
      baseCommit: context.target.version ?? 0,
      author: AUTHOR,
    });

    // ORDER IS THE CONTRACT: the ids come back in the order the changes are
    // written, and every change carries the object it answers to.
    let added = 0;
    let moved = 0;
    let elsewhere = 0;
    const seen = new Set<string>();
    const moves: { instance: string; object: string; position: [number, number, number] }[] = [];
    // 🔴 FROM THEIR OWN SHAPES, WHEN NO TYPE IS CHOSEN (VSL 16-11: the architect's 82 façade fins, «as native elements»): the
    // layer's objects made as families of their shape, the same way an IFC's are (`familiesFromShapes`): one per shape, a
    // prism one per profile with its length an instance parameter, each standing at its base where Rhino has it. Kept when
    // what it asks is what it was made from; made again when the object changed.
    if (!instanceType && shapes) {
      const onLayer = new Set(contents.items.filter((it) => it.guid && (it.attrs.Layer ?? '') === layer).map((it) => it.guid!));
      elsewhere = contents.items.filter((it) => it.guid && Object.keys(it.attrs).length && (it.attrs.Layer ?? '') !== layer).length;
      const mine = { geometries: shapes.geometries, elements: new Map([...shapes.elements].filter(([gid]) => onLayer.has(gid))) };
      const prints = new Map<string, string>();
      whatItMadeBefore(context, prints);
      const printOfIt = (attrs: Record<string, string>, at: number[], turn: number) => {
        const text = JSON.stringify({ a: Object.fromEntries(Object.entries(attrs).filter(([k]) => k !== 'Shape' && k !== 'Prism').sort()), p: at.map((v) => Math.round(v * 1e4) / 1e4), r: Math.round(turn * 1e3) / 1e3 });
        let h = 0x811c9dc5;
        for (let i = 0; i < text.length; i++) { h ^= text.charCodeAt(i); h = Math.imul(h, 0x01000193); }
        return (h >>> 0).toString(36);
      };
      const shaped = familiesFromShapes(mine, new Set(), picked.fileId);
      // (A family's shape goes with the first of its instances WRITTEN, whichever that is: its first may be kept.)
      const definition = new Map<string, Record<string, string>>();
      for (const one of shaped) {
        const def: Record<string, string> = {};
        for (const k of ['Shape', 'Prism']) if (one.attrs[k]) def[k] = one.attrs[k];
        if (one.attrs.Family && Object.keys(def).length && !definition.has(one.attrs.Family)) definition.set(one.attrs.Family, def);
      }
      const defined = new Set<string>();
      for (const one of shaped) {
        const object = one.key.split(':')[1] ?? one.key;
        seen.add(object);
        const position: [number, number, number] = [one.at[0] * FEET_PER_METRE, one.at[1] * FEET_PER_METRE, one.at[2] * FEET_PER_METRE];
        const print = printOfIt(one.attrs, position, one.rotationDeg);
        const before = made.get(object);
        if (before && prints.get(object) === print) continue;
        if (before) { operation.remove(before); moved++; }
        const fam = one.attrs.Family;
        const attrs = fam && !defined.has(fam) ? { ...one.attrs, ...(definition.get(fam) ?? {}) } : Object.fromEntries(Object.entries(one.attrs).filter(([k]) => k !== 'Shape' && k !== 'Prism'));
        if (fam) defined.add(fam);
        operation.add({ ...attrs, 'flow:print': print }, { position, rotationDeg: one.rotationDeg, source: object });
        added++;
      }
    } else for (const item of contents.items) {
      if (!item.guid || Object.keys(item.attrs).length === 0) continue;
      if ((item.attrs.Layer ?? '') !== layer) {
        elsewhere++;
        continue;
      }
      const at = positionOf(item);
      if (!at) continue; // something with no position is not placeable
      seen.add(item.guid);
      const position: [number, number, number] = [
        at[0] * scale,
        at[1] * scale,
        at[2] * scale,
      ];
      const instance = made.get(item.guid);
      if (instance) {
        moves.push({ instance, object: item.guid, position });
      } else {
        operation.add(
          {
            CategoryId: instanceType!.categoryId,
            Family: instanceType!.family,
            Type: instanceType!.type,
          },
          { position, source: item.guid },
        );
        added++;
      }
    }
    for (const move of moves) {
      operation.set(move.instance, {}, { position: move.position, source: move.object });
      moved++;
    }
    let removed = 0;
    for (const [object, instance] of made) {
      if (seen.has(object)) continue;
      operation.remove(instance);
      removed++;
    }

    const total = added + moved + removed;
    if (total === 0) {
      throw new UpToDate(
        `Nothing to write: layer "${layer}" of "${picked.name}" has no placed object, and nothing of this recipe is left to remove.`,
      );
    }

    const words = [
      added ? `${added} new` : '',
      moved ? `${moved} moved` : '',
      removed ? `${removed} gone` : '',
    ].filter(Boolean);
    return {
      title: `From Rhino: ${words.join(', ')}`,
      verb: operation.summary,
      targets: total,
      payload: new Blob([(await operation.build(context.opId)) as BlobPart]),
      ruleTallies: [
        { read: added, written: added },
        { read: moved, written: moved },
        { read: removed, written: removed },
        { read: elsewhere, written: 0 },
      ],
    };
  },
};
