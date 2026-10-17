import { layoutSearch, parseLayoutUrl, type LayoutUrl } from './url.js';

// Older URLs name a resource page (`/presets?id=…`, `/workflows?workflow=…&edge=…`). Toast links from earlier
// versions, bookmarks and node-ui's "Edit preset", "Edit collection" and "Edit definition" links use them (node-ui
// knows nothing about the layout URL), so they stay as inbound aliases: the layout hook rewrites them to the layout
// URL on arrival.
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
  '/collections': (params) => {
    const rightId = params.get('id') || undefined;
    return { right: 'collections', ...(rightId && { rightId }) };
  },
  '/settings': () => ({ left: 'settings' }),
  '/state-definitions': (params) => {
    const leftId = params.get('id') || undefined;
    return { left: 'stateDefinitions', ...(leftId && { leftId }) };
  },
};

/** The layout query (no leading '?') a legacy path stands for; unknown paths stand for the default layout. */
export function legacySearch(pathname: string, search: string): string {
  const layout = PATH_LAYOUTS[pathname];
  return layout ? layoutSearch(layout(new URLSearchParams(search))) : '';
}

/** The layout an in-app link stands for: a layout URL itself, or a legacy path. */
function layoutOfLink(to: string): LayoutUrl {
  const url = new URL(to, 'http://app');
  return parseLayoutUrl(url.pathname === '/' ? url.search : legacySearch(url.pathname, url.search));
}

/**
 * The collection an in-app link opens in R (`/collections?id=…`, or the layout URL itself), if any. The workflow
 * editor opens such links in place: following the URL would replace the whole layout and close the workflow.
 */
export function collectionLinkId(to: string): string | undefined {
  const layout = layoutOfLink(to);
  return layout.right === 'collections' ? layout.rightId : undefined;
}

/** The state definition an in-app link opens in L (`/state-definitions?id=…` or the layout URL), if any. */
export function stateDefinitionLinkId(to: string): string | undefined {
  const layout = layoutOfLink(to);
  return layout.left === 'stateDefinitions' ? layout.leftId : undefined;
}

/** What a plain click on a link in a node panel opens in place instead of following its URL. */
type PanelLinkTarget = { kind: 'collection' | 'stateDefinition'; id: string };

/** The resource an in-app link from a node panel opens in place, if any (see `collectionLinkId`). */
export function panelLinkTarget(to: string): PanelLinkTarget | undefined {
  const collection = collectionLinkId(to);
  if (collection) return { kind: 'collection', id: collection };
  const definition = stateDefinitionLinkId(to);
  return definition ? { kind: 'stateDefinition', id: definition } : undefined;
}
