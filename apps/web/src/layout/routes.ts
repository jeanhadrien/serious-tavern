import type { ResourceId } from './state.js';

// Existing URLs (toast links, node-panel links) name a resource page. Until the layout
// is encoded in the URL they still work: the shell shows that resource's list and, when
// the URL names an item, opens its editor; the editor reads the query parameter itself.
const RESOURCE_PATHS: Record<string, ResourceId> = {
  '/workflows': 'workflows',
  '/presets': 'presets',
  '/characters': 'characters',
  '/personas': 'personas',
  '/settings': 'settings',
};

/** Resources already split into list and editor, and the query parameter that names the item to open. */
const ITEM_PARAMS: Partial<Record<ResourceId, string>> = {
  workflows: 'workflow',
  presets: 'id',
};

/** Resources still hosted whole as a wide editor: picking their icon opens the page itself. */
export const isHostedWhole = (resource: ResourceId): boolean => !(resource in ITEM_PARAMS);

/** What a URL asks of the layout: which resource to show, and whether to open its editor. */
export function routeTarget(
  pathname: string,
  search: string,
): { resource: ResourceId; openEditor: boolean } | undefined {
  const resource = RESOURCE_PATHS[pathname];
  if (!resource) return undefined;
  const param = ITEM_PARAMS[resource];
  return { resource, openEditor: param === undefined || new URLSearchParams(search).has(param) };
}

/** Paths the app knows; anything else redirects to the chat. */
export function isKnownPath(pathname: string): boolean {
  return pathname === '/' || pathname in RESOURCE_PATHS;
}
