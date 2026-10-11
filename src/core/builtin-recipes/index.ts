/**
 * The recipes the platform ships with: proof that interoperability works
 * without writing anything, and templates to copy.
 *
 * What is NOT here yet, and why: `revit-to-rhino` waits on the Rhino plugin
 * growing a suggestion applier (today it only exports and publishes) - a
 * recipe whose payload vocabulary nobody reads would fix a contract blind.
 * `frag-to-autocad` (our drawings to DWG) is agreed as optional and comes
 * after. Both land here when their appliers exist.
 */
import type { EngineServicesClient } from '../client';
import type { Recipe } from '../recipes';
import { fragToRevit, ifcToRevit } from './records-to-revit';
import { rhinoToRevit } from './rhino-to-revit';

export { fragToRevit, ifcToRevit } from './records-to-revit';
export { rhinoToRevit } from './rhino-to-revit';

/** The built-in recipes, in catalog order. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any -- a heterogeneous catalog erases its settings types
export const builtinRecipes: Recipe<any>[] = [
  rhinoToRevit,
  ifcToRevit,
  fragToRevit,
];

/** Registers every built-in recipe on the client's registry. */
export function registerBuiltinRecipes(client: EngineServicesClient): void {
  for (const recipe of builtinRecipes) client.recipes.register(recipe);
}
