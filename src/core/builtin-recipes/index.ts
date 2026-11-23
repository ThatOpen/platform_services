/**
 * The recipes the platform ships with: proof that interoperability works
 * without writing anything, and templates to copy.
 *
 * What is NOT here yet, and why: the way back to the shape modeller waits on its plugin
 * growing an applier (today it only exports and publishes) - a
 * recipe whose payload vocabulary nobody reads would fix a contract blind.
 * a recipe for our drawings to DWG is agreed as optional and comes
 * after. Both land here when their appliers exist.
 */
import type { EngineServicesClient } from '../client';
import type { Recipe } from '../recipes';
import { platformModelToNative, ifcToNative } from './records-to-native';
import { layerToNative } from './layer-to-native';

export { platformModelToNative, ifcToNative } from './records-to-native';
export { layerToNative } from './layer-to-native';

/** The built-in recipes, in catalog order. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any -- a heterogeneous catalog erases its settings types
export const builtinRecipes: Recipe<any>[] = [
  layerToNative,
  ifcToNative,
  platformModelToNative,
];

/** Registers every built-in recipe on the client's registry. */
export function registerBuiltinRecipes(client: EngineServicesClient): void {
  for (const recipe of builtinRecipes) client.recipes.register(recipe);
}
