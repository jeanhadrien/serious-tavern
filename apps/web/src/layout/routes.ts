import type { ResourceId } from './state.js';

// Existing URLs (toast links, node-panel links) name a resource page. Until the layout
// is encoded in the URL they still work: the shell opens that resource's editor and the
// hosted page reads its own query parameters (`?id=…`, `?workflow=…&edge=…`).
const RESOURCE_PATHS: Record<string, ResourceId> = {
  '/workflows': 'workflows',
  '/presets': 'presets',
  '/characters': 'characters',
  '/personas': 'personas',
  '/settings': 'settings',
};

export function resourceForPath(pathname: string): ResourceId | undefined {
  return RESOURCE_PATHS[pathname];
}

/** Paths the app knows; anything else redirects to the chat. */
export function isKnownPath(pathname: string): boolean {
  return pathname === '/' || pathname in RESOURCE_PATHS;
}
