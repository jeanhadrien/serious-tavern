import type { NodeResources } from '@st/engine';
import type { AppContext } from '../context.js';

/**
 * The repositories nodes load by id (presets, characters, providers, collections, state definitions): the one
 * place the server builds `NodeResources`. Validation, port resolution, edge pruning and chat turns all use it,
 * so a node that resolves its ports from a resource behaves the same everywhere.
 */
export const nodeResources = ({
  presets,
  characters,
  providers,
  collections,
  stateDefinitions,
}: Pick<AppContext, 'presets' | 'characters' | 'providers' | 'collections' | 'stateDefinitions'>): NodeResources => ({
  presets,
  characters,
  providers,
  collections,
  stateDefinitions,
});
