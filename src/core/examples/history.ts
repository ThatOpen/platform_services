// description: "History and recipes — a project's connected documents (Revit, AutoCAD…), their version timelines, change requests (suggestions), and recipes: scripts that write suggestions in an app's native language."
import { EngineServicesClient } from '../client';
import type { Recipe } from '../recipes';

// The mental model, in three sentences:
// 1. Every connected document (a Revit model, an AutoCAD drawing) has its
//    version history: who synced, when, what changed.
// 2. Nobody writes in somebody else's document. Changes arrive as SUGGESTIONS
//    (create / modify / delete native data) that the owner accepts or
//    dismisses in the native app. That is why running any of this is safe.
// 3. A RECIPE is a script that writes suggestions in an application's own
//    language. Anything that wants to change a Revit document uses a Revit
//    recipe to say it in Revit's words.

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

    // The change requests waiting for the document's owner.
    const pending = await doc.pendingSuggestions();
    console.log(`${pending.length} suggestions pending`);
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
  runtime: 'browser',
  settingsSchema: {
    type: 'object',
    properties: {
      layer: { type: 'string' },
      block: { type: 'string' },
    },
    required: ['layer', 'block'],
  },
  rules: [{ reads: 'input points', proposes: 'one block per point' }],
  async run({ input, settings }) {
    const points = input as { x: number; y: number; z: number }[];
    // Build the suggestion payload (a .frag with envelope revitflow/op@2,
    // one item per change, attributes in the TARGET's own vocabulary).
    // The payload builder lives in the fragments toolkit; omitted here.
    const payload = await buildOpFrag(points, settings);
    return {
      title: `Place ${points.length} ${settings.block} blocks`,
      verb: 'add',
      targets: points.length,
      payload,
      ruleTallies: [{ read: points.length, proposed: points.length }],
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

  // Running is always safe: it only queues a suggestion on the target
  // document. Nothing changes in AutoCAD until its owner applies it there.
  const { suggestion } = await client.recipes.run('points-to-autocad-blocks', {
    projectId,
    target: { source: 'autocad', docId: 'site-plan' },
    input: [{ x: 0, y: 0, z: 0 }],
    settings: { layer: 'DETECTORS', block: 'SIEMENS-FDO181' },
    author: 'recipe:points-to-autocad-blocks',
  });
  console.log(`queued suggestion ${suggestion.opId}`);
}

declare function buildOpFrag(
  points: { x: number; y: number; z: number }[],
  settings: { layer: string; block: string },
): Promise<Blob>;
