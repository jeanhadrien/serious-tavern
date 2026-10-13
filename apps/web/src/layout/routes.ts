import { layoutSearch, type LayoutUrl } from './url.js';

// Older URLs name a resource page (`/presets?id=…`, `/workflows?workflow=…&edge=…`). Toast links from earlier
// versions, bookmarks and node-ui's "Edit preset" link still use them, so they stay as inbound aliases:
// the layout hook rewrites them to the layout URL on arrival.
const PATH_LAYOUTS: Record<string, (params: URLSearchParams) => Partial<LayoutUrl>> = {
  '/workflows': (params) => {
    const wideId = params.get('workflow') || undefined;
    return {
      left: 'workflows',
      ...(wideId && { wide: 'workflows', wideId, edge: params.get('edge') || undefined }),
    };
  },
  '/presets': (params) => {
    const wideId = params.get('id') || undefined;
    return { left: 'presets', ...(wideId && { wide: 'presets', wideId }) };
  },
  '/characters': () => ({ right: 'characters' }),
  '/personas': () => ({ right: 'personas' }),
  '/settings': () => ({ left: 'settings' }),
};

/** The layout query (no leading '?') a legacy path stands for; unknown paths stand for the default layout. */
export function legacySearch(pathname: string, search: string): string {
  const layout = PATH_LAYOUTS[pathname];
  return layout ? layoutSearch(layout(new URLSearchParams(search))) : '';
}
