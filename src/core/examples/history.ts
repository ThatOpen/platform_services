// description: "History and recipes — a project's connected documents (Revit, AutoCAD…), their version timelines, and recipes: scripts that bring a source into an app, in its native language, applied from inside that app."
import { EngineServicesClient } from '../client';
import type { Recipe } from '../recipes';

// The mental model, in three sentences:
// 1. Every connected document (a Revit model, an AutoCAD drawing) has its
//    version history: who synced, when, what changed.
// 2. A RECIPE is a script that brings a source (an IFC, a Rhino layer…) into
//    an application, in that application's own words: the changes that make
//    the document match the source.
// 3. Recipes are applied from INSIDE the native application, by its plugin,
//    in one go: nothing is queued anywhere. The next sync writes a version
//    whose `origin` names the recipe and the source version it read.

export async function readTheProjectHistory(
  client: EngineServicesClient,
  projectId: string,
) {
  const history = client.history(projectId);

  // Which documents are connected, and from which application.
  const docs = await history.docs();
  for (const { source, docId } of docs) {
    const doc = history.doc(source, docId);

    // The timeline is ordered by the version graph, oldest first, with
    // `ordinal` filled in. The last entry is the head.
    const timeline = await doc.timeline();
    const head = timeline[timeline.length - 1];
    console.log(
      `${source}-${docId}: ${timeline.length} versions, head by ${head?.author}`,
    );

    // A version's geometry: full exports ARE the model file; ordinary
    // versions carry a hidden delta.
    if (head?.deltaId) await doc.delta(head);
    else if (head?.full) await doc.model();

    // Where a version came from, when a recipe made it.
    if (head?.origin)
      console.log(`made by ${head.origin.recipe} from ${head.origin.source.name ?? head.origin.source.fileId} ${head.origin.source.version}`);
  }
}

// A recipe is its manifest plus one function. The settingsSchema is what apps
// render as a form — anything naming an EXISTING thing must be an enum the
// app fills, so people pick instead of typing names.
const pointsToBlocks: Recipe<{ layer: string; block: string }> = {
  name: 'points-to-autocad-blocks',
  description: 'Places an AutoCAD block on every input point.',
  to: 'autocad',
  inputs: ['points'],
  settingsSchema: {
    type: 'object',
    properties: {
      layer: { type: 'string' },
      block: { type: 'string' },
    },
    required: ['layer', 'block'],
  },
  rules: [{ reads: 'input points', writes: 'one block per point' }],
  async run({ input, settings }) {
    const points = input as { x: number; y: number; z: number }[];
    // Build the changes (a .frag with envelope revitflow/op@2,
    // one item per change, attributes in the TARGET's own vocabulary).
    // The payload builder lives in the fragments toolkit; omitted here.
    const payload = await buildOpFrag(points, settings);
    return {
      title: `Place ${points.length} ${settings.block} blocks`,
      verb: 'add',
      targets: points.length,
      payload,
      ruleTallies: [{ read: points.length, written: points.length }],
    };
  },
};

export async function runARecipe(
  client: EngineServicesClient,
  projectId: string,
) {
  client.recipes.register(pointsToBlocks);

  // Catalogs filter by target application: "who can speak autocad?".
  client.recipes.list({ to: 'autocad' });

  // Running only computes the changes; the native application's plugin is
  // what runs it and writes them, handing back what the recipe made before
  // (`made`) so a second run writes only the difference.
  const result = await client.recipes.run('points-to-autocad-blocks', {
    projectId,
    target: { source: 'autocad', docId: 'site-plan' },
    input: [{ x: 0, y: 0, z: 0 }],
    settings: { layer: 'DETECTORS', block: 'SIEMENS-FDO181' },
    made: new Map(),
  });
  console.log(result.title);
}

declare function buildOpFrag(
  points: { x: number; y: number; z: number }[],
  settings: { layer: string; block: string },
): Promise<Blob>;
